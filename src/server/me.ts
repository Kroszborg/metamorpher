import 'server-only';
import { and, count, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, schema } from './db';

/* ------------------------------------------------------------ inputs */

export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const docKey = z.string().regex(/^[a-f0-9]{64}$/);
const errorCode = z.string().regex(/^[a-z0-9_]{1,32}$/);
/** A file name as shown to the user: no path, no control characters. */
const fileName = z
  .string()
  .min(1)
  .max(255)
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^.*[\\/]/, ''));

export const settingsPatch = z
  .object({
    syncTools: z.boolean(),
    syncHistory: z.boolean(),
    historyFileNames: z.boolean(),
    syncChats: z.boolean(),
  })
  .partial()
  .strict();

export const toolsInput = z
  .object({ starred: z.array(slug).max(200), recent: z.array(slug).max(12) })
  .strict();

export const historyInput = z
  .object({
    tool: slug,
    fileCount: z.number().int().min(0).max(10_000),
    totalBytes: z.number().int().min(0).max(1e13),
    durationMs: z.number().int().min(0).max(24 * 3600 * 1000),
    outcome: z.enum(['success', 'failed', 'cancelled']),
    errorCode: errorCode.optional(),
    fileNames: z.array(fileName).max(50).optional(),
  })
  .strict();

const chatSource = z
  .object({
    n: z.number().int().min(0).max(10_000),
    docName: z.string().max(255),
    unit: z.enum(['page', 'section']),
    page: z.number().int().min(0).max(100_000),
  })
  .strict();

export const chatInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    turns: z
      .array(
        z
          .object({
            question: z.string().max(4_000),
            answer: z.string().max(40_000),
            sources: z.array(chatSource).max(50),
            via: z.string().max(120),
            at: z.number().int().min(0),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

/* ---------------------------------------------------------- settings */

export type SyncSettings = {
  syncTools: boolean;
  syncHistory: boolean;
  historyFileNames: boolean;
  syncChats: boolean;
};

const DEFAULTS: SyncSettings = { syncTools: false, syncHistory: false, historyFileNames: false, syncChats: false };

export async function getSettings(db: Db, userId: string): Promise<SyncSettings> {
  const [row] = await db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).limit(1);
  if (!row) return { ...DEFAULTS };
  return {
    syncTools: row.syncTools,
    syncHistory: row.syncHistory,
    historyFileNames: row.historyFileNames,
    syncChats: row.syncChats,
  };
}

export async function updateSettings(db: Db, userId: string, patch: Partial<SyncSettings>): Promise<SyncSettings> {
  const next = { ...(await getSettings(db, userId)), ...patch };
  await db
    .insert(schema.userSettings)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.userSettings.userId, set: { ...next, updatedAt: new Date() } });
  // Turning file names off also removes the names already stored.
  if (patch.historyFileNames === false) {
    await db.update(schema.runHistory).set({ fileNames: null }).where(eq(schema.runHistory.userId, userId));
  }
  return next;
}

/* ------------------------------------------------------------- tools */

export async function getTools(db: Db, userId: string) {
  const [row] = await db.select().from(schema.userTools).where(eq(schema.userTools.userId, userId)).limit(1);
  return row ? { starred: row.starred, recent: row.recent, updatedAt: row.updatedAt.getTime() } : null;
}

export async function putTools(db: Db, userId: string, input: z.infer<typeof toolsInput>) {
  const dedupe = (xs: string[]) => [...new Set(xs)];
  const value = { starred: dedupe(input.starred), recent: dedupe(input.recent).slice(0, 12), updatedAt: new Date() };
  await db
    .insert(schema.userTools)
    .values({ userId, ...value })
    .onConflictDoUpdate({ target: schema.userTools.userId, set: value });
  return { starred: value.starred, recent: value.recent, updatedAt: value.updatedAt.getTime() };
}

/* ----------------------------------------------------------- history */

export const HISTORY_PAGE = 50;
const HISTORY_MAX = 5_000;

export async function listHistory(db: Db, userId: string, opts: { tool?: string; before?: Date }) {
  const where = and(
    eq(schema.runHistory.userId, userId),
    opts.tool ? eq(schema.runHistory.tool, opts.tool) : undefined,
    opts.before ? lt(schema.runHistory.at, opts.before) : undefined,
  );
  const rows = await db
    .select({
      id: schema.runHistory.id,
      tool: schema.runHistory.tool,
      at: schema.runHistory.at,
      fileCount: schema.runHistory.fileCount,
      totalBytes: schema.runHistory.totalBytes,
      durationMs: schema.runHistory.durationMs,
      outcome: schema.runHistory.outcome,
      errorCode: schema.runHistory.errorCode,
      fileNames: schema.runHistory.fileNames,
    })
    .from(schema.runHistory)
    .where(where)
    .orderBy(desc(schema.runHistory.at))
    .limit(HISTORY_PAGE + 1);
  const tools = await db
    .select({ tool: schema.runHistory.tool, n: count() })
    .from(schema.runHistory)
    .where(eq(schema.runHistory.userId, userId))
    .groupBy(schema.runHistory.tool);
  return {
    items: rows.slice(0, HISTORY_PAGE).map((r) => ({ ...r, at: r.at.getTime() })),
    more: rows.length > HISTORY_PAGE,
    tools: tools.map((t) => ({ tool: t.tool, count: Number(t.n) })).sort((a, b) => b.count - a.count),
  };
}

export async function addHistory(
  db: Db,
  userId: string,
  settings: SyncSettings,
  input: z.infer<typeof historyInput>,
): Promise<boolean> {
  if (!settings.syncHistory) return false;
  await db.insert(schema.runHistory).values({
    userId,
    tool: input.tool,
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    durationMs: input.durationMs,
    outcome: input.outcome,
    errorCode: input.outcome === 'failed' ? (input.errorCode ?? 'error') : null,
    fileNames: settings.historyFileNames && input.fileNames?.length ? input.fileNames : null,
  });
  // Keep the newest entries only.
  await db.execute(sql`
    delete from ${schema.runHistory}
    where ${schema.runHistory.userId} = ${userId}
      and ${schema.runHistory.id} in (
        select ${schema.runHistory.id} from ${schema.runHistory}
        where ${schema.runHistory.userId} = ${userId}
        order by ${schema.runHistory.at} desc
        offset ${HISTORY_MAX}
      )`);
  return true;
}

export async function deleteHistory(db: Db, userId: string, opts: { id?: string; tool?: string }) {
  const res = await db
    .delete(schema.runHistory)
    .where(
      and(
        eq(schema.runHistory.userId, userId),
        opts.id ? eq(schema.runHistory.id, opts.id) : undefined,
        opts.tool ? eq(schema.runHistory.tool, opts.tool) : undefined,
      ),
    )
    .returning({ id: schema.runHistory.id });
  return res.length;
}

/* ------------------------------------------------------------- chats */

export async function listChats(db: Db, userId: string) {
  const rows = await db
    .select({
      docKey: schema.chatConversation.docKey,
      title: schema.chatConversation.title,
      turns: sql<number>`jsonb_array_length(${schema.chatConversation.turns})`,
      updatedAt: schema.chatConversation.updatedAt,
    })
    .from(schema.chatConversation)
    .where(eq(schema.chatConversation.userId, userId))
    .orderBy(desc(schema.chatConversation.updatedAt))
    .limit(500);
  return rows.map((r) => ({ ...r, turns: Number(r.turns), updatedAt: r.updatedAt.getTime() }));
}

export async function getChat(db: Db, userId: string, key: string) {
  const [row] = await db
    .select()
    .from(schema.chatConversation)
    .where(and(eq(schema.chatConversation.userId, userId), eq(schema.chatConversation.docKey, key)))
    .limit(1);
  return row
    ? { docKey: row.docKey, title: row.title, turns: row.turns, updatedAt: row.updatedAt.getTime() }
    : null;
}

export async function putChat(db: Db, userId: string, key: string, input: z.infer<typeof chatInput>) {
  if (input.turns.length === 0) {
    await deleteChat(db, userId, key);
    return;
  }
  const now = new Date();
  await db
    .insert(schema.chatConversation)
    .values({ userId, docKey: key, title: input.title, turns: input.turns, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.chatConversation.userId, schema.chatConversation.docKey],
      set: { title: input.title, turns: input.turns, updatedAt: now },
    });
}

export async function deleteChat(db: Db, userId: string, key?: string) {
  const res = await db
    .delete(schema.chatConversation)
    .where(
      and(eq(schema.chatConversation.userId, userId), key ? eq(schema.chatConversation.docKey, key) : undefined),
    )
    .returning({ id: schema.chatConversation.id });
  return res.length;
}

/* ------------------------------------------------------------ export */

export async function exportAll(db: Db, userId: string) {
  const [u] = await db
    .select({
      name: schema.user.name,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
      lastSeenAt: schema.user.lastSeenAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const sessions = await db
    .select({
      createdAt: schema.session.createdAt,
      expiresAt: schema.session.expiresAt,
      device: schema.session.userAgent,
    })
    .from(schema.session)
    .where(eq(schema.session.userId, userId));
  const history = await db
    .select({
      tool: schema.runHistory.tool,
      at: schema.runHistory.at,
      fileCount: schema.runHistory.fileCount,
      totalBytes: schema.runHistory.totalBytes,
      durationMs: schema.runHistory.durationMs,
      outcome: schema.runHistory.outcome,
      errorCode: schema.runHistory.errorCode,
      fileNames: schema.runHistory.fileNames,
    })
    .from(schema.runHistory)
    .where(eq(schema.runHistory.userId, userId))
    .orderBy(desc(schema.runHistory.at));
  const chats = await db
    .select({
      title: schema.chatConversation.title,
      docKey: schema.chatConversation.docKey,
      turns: schema.chatConversation.turns,
      createdAt: schema.chatConversation.createdAt,
      updatedAt: schema.chatConversation.updatedAt,
    })
    .from(schema.chatConversation)
    .where(eq(schema.chatConversation.userId, userId));
  return {
    exportedAt: new Date().toISOString(),
    note: 'Everything Metamorpher stores for this account. Files are never uploaded, so none are included.',
    profile: u ?? null,
    settings: await getSettings(db, userId),
    tools: await getTools(db, userId),
    sessions,
    history,
    chats,
  };
}
