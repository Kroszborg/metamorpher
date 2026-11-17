import { exportAll } from '@/server/me';
import { withViewer } from '@/server/session';

/** Everything stored for this account, as a JSON download. */
export function GET(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const data = await exportAll(db, viewer.id);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="metamorpher-account-${day}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
