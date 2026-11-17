import { timingSafeEqual } from 'node:crypto';
import { rollup } from '@/server/analytics';
import { serverConfig } from '@/server/config';
import { getDb } from '@/server/db';
import { error, json } from '@/server/http';

function authorized(req: Request): boolean {
  const secret = serverConfig.cronSecret;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily analytics rollup and cleanup, called by Vercel Cron (vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`. Anything else gets 401.
 */
export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return error(401, 'Unauthorized.');
  const db = await getDb().catch(() => null);
  if (!db) return error(503, 'No database is configured.');
  const result = await rollup(db);
  return json({ ok: true, ...result });
}
