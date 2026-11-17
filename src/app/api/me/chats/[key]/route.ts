import { error, json, readJson } from '@/server/http';
import { chatInput, deleteChat, docKey, getChat, getSettings, putChat } from '@/server/me';
import { withViewer } from '@/server/session';

type Ctx = { params: Promise<{ key: string }> };

async function keyOf(ctx: Ctx) {
  const k = docKey.safeParse((await ctx.params).key);
  return k.success ? k.data : null;
}

export function GET(req: Request, ctx: Ctx) {
  return withViewer(req, async ({ viewer, db }) => {
    const key = await keyOf(ctx);
    if (!key) return error(400, 'Invalid conversation key.');
    const chat = await getChat(db, viewer.id, key);
    return chat ? json({ chat }) : error(404, 'Not found.');
  });
}

/** Saves a conversation (questions, answers, citations; never the document). Needs chat sync on. */
export function PUT(req: Request, ctx: Ctx) {
  return withViewer(req, async ({ viewer, db }) => {
    const key = await keyOf(ctx);
    if (!key) return error(400, 'Invalid conversation key.');
    const body = await readJson(req, chatInput, 1024 * 1024);
    if (!body.ok) return body.res;
    if (!(await getSettings(db, viewer.id)).syncChats) return error(409, 'Chat sync is switched off.');
    await putChat(db, viewer.id, key, body.data);
    return json({ saved: true });
  });
}

export function DELETE(req: Request, ctx: Ctx) {
  return withViewer(req, async ({ viewer, db }) => {
    const key = await keyOf(ctx);
    if (!key) return error(400, 'Invalid conversation key.');
    const deleted = await deleteChat(db, viewer.id, key);
    return deleted ? json({ deleted }) : error(404, 'Not found.');
  });
}
