import { beaconBody, ingest, optedOut } from '@/server/analytics';
import { analyticsEnabled } from '@/server/config';
import { getDb } from '@/server/db';
import { error, isSameOrigin } from '@/server/http';

const ok = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/**
 * Anonymous usage beacon. Accepts small batches from this site's pages only;
 * drops bots and browsers that send Do Not Track or Global Privacy Control.
 * Always answers 204 for accepted or dropped batches, so nothing is learned
 * from the response.
 */
export async function POST(req: Request): Promise<Response> {
  if (!analyticsEnabled) return error(503, 'Usage statistics are not enabled on this site.');
  if (!isSameOrigin(req)) return error(403, 'Cross-site request refused.');
  if (optedOut(req.headers)) return ok();
  const text = await req.text().catch(() => '');
  if (!text || text.length > 8192) return ok();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return ok();
  }
  const parsed = beaconBody.safeParse(raw);
  if (!parsed.success) return ok();
  try {
    const db = await getDb();
    if (db) await ingest(db, req.headers, parsed.data);
  } catch (err) {
    console.error('[analytics] ingest failed:', err instanceof Error ? err.message : 'unknown error');
  }
  return ok();
}
