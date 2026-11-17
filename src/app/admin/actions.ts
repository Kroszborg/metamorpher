'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/admin';
import { rollup } from '@/server/analytics';
import { type Db, schema } from '@/server/db';

const userId = z.string().min(1).max(64);
export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/** Every action re-checks admin rights itself (requireAdmin 404s anyone else) and validates its input. */
type Target = { error: string } | { error?: undefined; db: Db; user: { id: string; email: string } };

async function target(id: unknown): Promise<Target> {
  const { viewer, db } = await requireAdmin();
  const parsed = userId.safeParse(id);
  if (!parsed.success) return { error: 'Invalid user.' };
  if (parsed.data === viewer.id) return { error: 'You cannot do this to your own account here. Use the account page.' };
  const [u] = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, parsed.data));
  if (!u) return { error: 'That user no longer exists.' };
  return { db, user: u };
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<ActionResult> {
  const t = await target(id);
  if (t.error !== undefined) return { ok: false, message: t.error };
  await t.db.update(schema.user).set({ disabled, updatedAt: new Date() }).where(eq(schema.user.id, t.user.id));
  // Disabling also ends every session at once.
  if (disabled) await t.db.delete(schema.session).where(eq(schema.session.userId, t.user.id));
  revalidatePath('/admin/users');
  return { ok: true, message: disabled ? 'Account disabled and signed out everywhere.' : 'Account enabled.' };
}

export async function revokeUserSessions(id: string): Promise<ActionResult> {
  const t = await target(id);
  if (t.error !== undefined) return { ok: false, message: t.error };
  const res = await t.db.delete(schema.session).where(eq(schema.session.userId, t.user.id)).returning({ id: schema.session.id });
  revalidatePath('/admin/users');
  return { ok: true, message: `Signed out ${res.length} ${res.length === 1 ? 'session' : 'sessions'}.` };
}

export async function deleteUserAccount(id: string): Promise<ActionResult> {
  const t = await target(id);
  if (t.error !== undefined) return { ok: false, message: t.error };
  // Sessions, accounts, settings, tools, history and chats go with it (ON DELETE CASCADE).
  await t.db.delete(schema.user).where(eq(schema.user.id, t.user.id));
  // Pending password-reset tokens point at the user id.
  await t.db.delete(schema.verification).where(eq(schema.verification.value, t.user.id));
  revalidatePath('/admin/users');
  return { ok: true, message: 'Account and all of its data deleted.' };
}

export async function runRollupNow(): Promise<ActionResult> {
  const { db } = await requireAdmin();
  const r = await rollup(db);
  revalidatePath('/admin', 'layout');
  return { ok: true, message: `Rolled up ${r.days.length} ${r.days.length === 1 ? 'day' : 'days'}; removed ${r.purged} old raw events.` };
}
