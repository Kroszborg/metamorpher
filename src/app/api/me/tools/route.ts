import { error, json, readJson } from '@/server/http';
import { getSettings, putTools, toolsInput } from '@/server/me';
import { withViewer } from '@/server/session';

/** Replaces the synced starred and recent lists (the client merges first). */
export function PUT(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const body = await readJson(req, toolsInput, 32 * 1024);
    if (!body.ok) return body.res;
    if (!(await getSettings(db, viewer.id)).syncTools) return error(409, 'Tool sync is switched off.');
    return json({ tools: await putTools(db, viewer.id, body.data) });
  });
}
