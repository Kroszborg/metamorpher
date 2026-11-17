import { json } from '@/server/http';
import { deleteChat, getSettings, listChats } from '@/server/me';
import { withViewer } from '@/server/session';

export function GET(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const [items, settings] = await Promise.all([listChats(db, viewer.id), getSettings(db, viewer.id)]);
    return json({ items, settings });
  });
}

/** Deletes every synced conversation. */
export function DELETE(req: Request) {
  return withViewer(req, async ({ viewer, db }) => json({ deleted: await deleteChat(db, viewer.id) }));
}
