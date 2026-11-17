import { json, readJson } from '@/server/http';
import { settingsPatch, updateSettings } from '@/server/me';
import { withViewer } from '@/server/session';

export function PATCH(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const body = await readJson(req, settingsPatch, 4096);
    if (!body.ok) return body.res;
    return json({ settings: await updateSettings(db, viewer.id, body.data) });
  });
}
