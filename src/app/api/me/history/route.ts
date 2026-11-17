import { error, json, readJson } from '@/server/http';
import { addHistory, deleteHistory, getSettings, historyInput, listHistory, slug } from '@/server/me';
import { withViewer } from '@/server/session';

/** GET ?tool=<slug>&before=<ms>: newest first, 50 per page. */
export function GET(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const url = new URL(req.url);
    const tool = url.searchParams.get('tool');
    const before = Number(url.searchParams.get('before'));
    if (tool !== null && !slug.safeParse(tool).success) return error(400, 'Invalid tool.');
    const [page, settings] = await Promise.all([
      listHistory(db, viewer.id, {
        tool: tool ?? undefined,
        before: Number.isFinite(before) && before > 0 ? new Date(before) : undefined,
      }),
      getSettings(db, viewer.id),
    ]);
    return json({ ...page, settings });
  });
}

/** Records one finished run. Ignored unless history is on; file names are kept only when allowed. */
export function POST(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const body = await readJson(req, historyInput, 32 * 1024);
    if (!body.ok) return body.res;
    const stored = await addHistory(db, viewer.id, await getSettings(db, viewer.id), body.data);
    return json({ stored }, { status: stored ? 201 : 200 });
  });
}

/** Clears all history, or one tool's with ?tool=<slug>. */
export function DELETE(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const tool = new URL(req.url).searchParams.get('tool');
    if (tool !== null && !slug.safeParse(tool).success) return error(400, 'Invalid tool.');
    return json({ deleted: await deleteHistory(db, viewer.id, { tool: tool ?? undefined }) });
  });
}
