import { z } from 'zod';
import { error, json } from '@/server/http';
import { deleteHistory } from '@/server/me';
import { withViewer } from '@/server/session';

export function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withViewer(req, async ({ viewer, db }) => {
    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) return error(400, 'Invalid id.');
    // Scoped to the session's user: an id that belongs to someone else deletes nothing.
    const deleted = await deleteHistory(db, viewer.id, { id: id.data });
    return deleted ? json({ deleted }) : error(404, 'Not found.');
  });
}
