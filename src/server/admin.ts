import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isAdminEmail } from './config';
import { type Db, getDb } from './db';
import { getViewer, type Viewer } from './session';

/**
 * Gate for every admin page and action: the signed-in user's email must be in
 * ADMIN_EMAILS. Anyone else gets a 404, so the panel's existence is not
 * revealed. Call it at the top of each page and each server action, not only
 * in the layout.
 */
export async function requireAdmin(): Promise<{ viewer: Viewer; db: Db }> {
  const db = await getDb().catch(() => null);
  if (!db) notFound();
  const viewer = await getViewer(await headers());
  if (!viewer || !isAdminEmail(viewer.email)) notFound();
  return { viewer, db };
}

export const RANGES = [1, 7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export function parseRange(v: string | string[] | undefined): Range {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : 7;
}
