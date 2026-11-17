import { isAdminEmail } from '@/server/config';
import { json } from '@/server/http';
import { getSettings, getTools } from '@/server/me';
import { withViewer } from '@/server/session';

/** The signed-in user's profile, sync switches and synced tools: one request on page load. */
export function GET(req: Request) {
  return withViewer(req, async ({ viewer, db }) => {
    const [settings, tools] = await Promise.all([getSettings(db, viewer.id), getTools(db, viewer.id)]);
    return json({
      user: {
        name: viewer.name,
        email: viewer.email,
        emailVerified: viewer.emailVerified,
        createdAt: viewer.createdAt.getTime(),
      },
      admin: isAdminEmail(viewer.email),
      settings,
      tools,
    });
  });
}
