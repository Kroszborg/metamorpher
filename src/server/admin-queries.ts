import 'server-only';
import { and, count, desc, eq, gte, ilike, lte, max, or, sql } from 'drizzle-orm';
import journal from '../../drizzle/meta/_journal.json';
import { addDays, DURATION_EDGES, rollup, utcDay } from './analytics';
import { configWarnings, isAdminEmail, mailConfigured, mailProvider, serverConfig } from './config';
import { type Db, schema } from './db';

const d = schema.analyticsDaily;
const n = (v: unknown) => Number(v ?? 0);

export type Period = { from: string; to: string };

export function periods(days: number): { cur: Period; prev: Period; days: string[] } {
  const to = utcDay();
  const from = addDays(to, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const list: string[] = [];
  for (let i = 0; i < days; i++) list.push(addDays(from, i));
  return { cur: { from, to }, prev: { from: prevFrom, to: prevTo }, days: list };
}

const inPeriod = (p: Period) => and(gte(d.day, p.from), lte(d.day, p.to));

/** Brings the aggregates up to date: today always, everything pending if the cron has not run lately. */
export async function freshen(db: Db) {
  const [last] = await db.select({ at: max(schema.analyticsRollup.rolledAt) }).from(schema.analyticsRollup);
  const stale = !last?.at || Date.now() - new Date(last.at).getTime() > 26 * 3600 * 1000;
  await rollup(db, { onlyToday: !stale });
}

async function totals(db: Db, p: Period) {
  const rows = await db
    .select({ kind: d.kind, sub: d.sub, c: sql<number>`sum(${d.count})`, v: sql<number>`sum(${d.visitors})` })
    .from(d)
    .where(and(inPeriod(p), sql`${d.kind} in ('total', 'tool')`))
    .groupBy(d.kind, d.sub);
  const get = (kind: string, sub: string) => rows.find((r) => r.kind === kind && r.sub === sub);
  const success = n(get('tool', 'run_success')?.c);
  const failed = n(get('tool', 'run_fail')?.c);
  const [signups] = await db
    .select({ c: count() })
    .from(schema.user)
    .where(
      and(
        gte(schema.user.createdAt, new Date(`${p.from}T00:00:00Z`)),
        lte(schema.user.createdAt, new Date(`${p.to}T23:59:59.999Z`)),
      ),
    );
  return {
    visitors: n(get('total', '')?.v),
    pageviews: n(get('total', '')?.c),
    runs: n(get('tool', 'run_start')?.c),
    success,
    failed,
    successRate: success + failed ? success / (success + failed) : null,
    signups: n(signups?.c),
  };
}

export async function overview(db: Db, days: number) {
  await freshen(db);
  const { cur, prev, days: list } = periods(days);
  const [now, before] = await Promise.all([totals(db, cur), totals(db, prev)]);
  const daily = await db
    .select({ day: d.day, kind: d.kind, sub: d.sub, c: d.count, v: d.visitors })
    .from(d)
    .where(and(inPeriod(cur), or(eq(d.kind, 'total'), and(eq(d.kind, 'tool'), eq(d.sub, 'run_start')))));
  const series = list.map((day) => {
    const t = daily.find((r) => r.day === day && r.kind === 'total');
    const runs = daily.filter((r) => r.day === day && r.kind === 'tool').reduce((s, r) => s + r.c, 0);
    return { day, pageviews: t?.c ?? 0, visitors: t?.v ?? 0, runs };
  });
  return { now, before, series };
}

/** Approximate median from the duration histogram (bucket i holds values below DURATION_EDGES[i]). */
function medianFromBuckets(buckets: Map<number, number>): number | null {
  const total = [...buckets.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  let seen = 0;
  for (let i = 0; i <= DURATION_EDGES.length; i++) {
    const c = buckets.get(i) ?? 0;
    if (seen + c >= total / 2) {
      const lo = i === 0 ? 0 : DURATION_EDGES[i - 1]!;
      const hi = DURATION_EDGES[i] ?? lo * 2;
      return lo + ((total / 2 - seen) / c) * (hi - lo);
    }
    seen += c;
  }
  return null;
}

export type ToolRow = {
  tool: string;
  opens: number;
  runs: number;
  success: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  medianMs: number | null;
  errors: { code: string; count: number }[];
};

export async function toolsTable(db: Db, days: number, only?: string): Promise<ToolRow[]> {
  await freshen(db);
  const { cur } = periods(days);
  const rows = await db
    .select({ kind: d.kind, key: d.key, sub: d.sub, c: sql<number>`sum(${d.count})` })
    .from(d)
    .where(
      and(
        inPeriod(cur),
        sql`${d.kind} in ('tool', 'tool_error', 'tool_duration')`,
        only ? eq(d.key, only) : undefined,
      ),
    )
    .groupBy(d.kind, d.key, d.sub);
  const by = new Map<string, ToolRow & { buckets: Map<number, number> }>();
  const row = (tool: string) => {
    let r = by.get(tool);
    if (!r) {
      r = { tool, opens: 0, runs: 0, success: 0, failed: 0, cancelled: 0, successRate: null, medianMs: null, errors: [], buckets: new Map() };
      by.set(tool, r);
    }
    return r;
  };
  for (const x of rows) {
    const r = row(x.key);
    const c = n(x.c);
    if (x.kind === 'tool') {
      if (x.sub === 'tool_open') r.opens += c;
      else if (x.sub === 'run_start') r.runs += c;
      else if (x.sub === 'run_success') r.success += c;
      else if (x.sub === 'run_fail') r.failed += c;
      else if (x.sub === 'run_cancel') r.cancelled += c;
    } else if (x.kind === 'tool_error') r.errors.push({ code: x.sub, count: c });
    else r.buckets.set(Number(x.sub), c);
  }
  return [...by.values()]
    .map(({ buckets, ...r }) => ({
      ...r,
      successRate: r.success + r.failed ? r.success / (r.success + r.failed) : null,
      medianMs: medianFromBuckets(buckets),
      errors: r.errors.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.runs - a.runs || b.opens - a.opens);
}

export async function toolTrend(db: Db, tool: string, days: number) {
  const { cur, days: list } = periods(days);
  const rows = await db
    .select({ day: d.day, sub: d.sub, c: d.count })
    .from(d)
    .where(and(inPeriod(cur), eq(d.kind, 'tool'), eq(d.key, tool)));
  return list.map((day) => {
    const get = (sub: string) => rows.find((r) => r.day === day && r.sub === sub)?.c ?? 0;
    return { day, opens: get('tool_open'), runs: get('run_start'), success: get('run_success'), failed: get('run_fail') };
  });
}

export const AUDIENCE_KINDS = ['browser', 'os', 'device', 'country', 'referrer', 'page'] as const;

export async function audience(db: Db, days: number) {
  await freshen(db);
  const { cur } = periods(days);
  const rows = await db
    .select({ kind: d.kind, key: d.key, c: sql<number>`sum(${d.count})`, v: sql<number>`sum(${d.visitors})` })
    .from(d)
    .where(and(inPeriod(cur), sql`${d.kind} in ('browser', 'os', 'device', 'country', 'referrer', 'page')`))
    .groupBy(d.kind, d.key);
  const out = Object.fromEntries(AUDIENCE_KINDS.map((k) => [k, [] as { key: string; views: number; visitors: number }[]]));
  for (const r of rows) out[r.kind]?.push({ key: r.key, views: n(r.c), visitors: n(r.v) });
  for (const k of AUDIENCE_KINDS) out[k]!.sort((a, b) => b.views - a.views);
  return out as Record<(typeof AUDIENCE_KINDS)[number], { key: string; views: number; visitors: number }[]>;
}

export const USERS_PAGE = 50;

export async function users(db: Db, q: string, page: number) {
  const term = q.trim().slice(0, 100);
  const where = term
    ? or(ilike(schema.user.email, `%${term.replace(/[%_\\]/g, '\\$&')}%`), ilike(schema.user.name, `%${term.replace(/[%_\\]/g, '\\$&')}%`))
    : undefined;
  const runs = db
    .select({ userId: schema.runHistory.userId, runs: count().as('runs') })
    .from(schema.runHistory)
    .groupBy(schema.runHistory.userId)
    .as('runs');
  const sessions = db
    .select({ userId: schema.session.userId, sessions: count().as('sessions') })
    .from(schema.session)
    .where(gte(schema.session.expiresAt, new Date()))
    .groupBy(schema.session.userId)
    .as('sessions');
  const rows = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      name: schema.user.name,
      emailVerified: schema.user.emailVerified,
      disabled: schema.user.disabled,
      createdAt: schema.user.createdAt,
      lastSeenAt: schema.user.lastSeenAt,
      runs: runs.runs,
      sessions: sessions.sessions,
    })
    .from(schema.user)
    .leftJoin(runs, eq(runs.userId, schema.user.id))
    .leftJoin(sessions, eq(sessions.userId, schema.user.id))
    .where(where)
    .orderBy(desc(schema.user.createdAt))
    .limit(USERS_PAGE + 1)
    .offset(page * USERS_PAGE);
  const [total] = await db.select({ c: count() }).from(schema.user).where(where);
  return {
    items: rows.slice(0, USERS_PAGE).map((r) => ({
      ...r,
      runs: n(r.runs),
      sessions: n(r.sessions),
      admin: isAdminEmail(r.email),
    })),
    more: rows.length > USERS_PAGE,
    total: n(total?.c),
  };
}

const TABLES = [
  ['user', schema.user],
  ['session', schema.session],
  ['account', schema.account],
  ['verification', schema.verification],
  ['rate_limit', schema.rateLimit],
  ['user_settings', schema.userSettings],
  ['user_tools', schema.userTools],
  ['run_history', schema.runHistory],
  ['chat_conversation', schema.chatConversation],
  ['analytics_event', schema.analyticsEvent],
  ['analytics_daily', schema.analyticsDaily],
  ['analytics_salt', schema.analyticsSalt],
  ['analytics_rollup', schema.analyticsRollup],
] as const;

export async function system(db: Db) {
  const t0 = performance.now();
  let dbOk = true;
  let dbError: string | null = null;
  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    dbOk = false;
    dbError = err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
  }
  const latencyMs = Math.round(performance.now() - t0);
  let applied: number | null = null;
  try {
    const r = await db.execute<{ c: number }>(sql`select count(*)::int as c from drizzle.__drizzle_migrations`);
    applied = n(r.rows[0]?.c);
  } catch {
    applied = null;
  }
  const counts = dbOk
    ? await Promise.all(
        TABLES.map(async ([name, table]) => {
          const [r] = await db.select({ c: count() }).from(table);
          return { name, rows: n(r?.c) };
        }),
      )
    : [];
  const [last] = dbOk
    ? await db
        .select({ day: schema.analyticsRollup.day, at: schema.analyticsRollup.rolledAt, events: schema.analyticsRollup.events })
        .from(schema.analyticsRollup)
        .orderBy(desc(schema.analyticsRollup.rolledAt))
        .limit(1)
    : [];
  return {
    driver: serverConfig.databaseUrl ? 'Neon (serverless HTTP)' : 'PGlite (local development)',
    dbOk,
    dbError,
    latencyMs,
    mailConfigured,
    mailMode: mailConfigured ? mailProvider : serverConfig.isDev ? 'Console (development)' : 'Off',
    warnings: configWarnings(),
    migrations: { applied, expected: journal.entries.length, latest: journal.entries.at(-1)?.tag ?? null },
    lastRollup: last ? { day: last.day, at: last.at, events: last.events } : null,
    counts,
    adminCount: serverConfig.adminEmails.length,
  };
}
