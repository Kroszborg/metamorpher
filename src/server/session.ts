import 'server-only';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { getAuth } from './auth';
import { type Db, getDb, schema } from './db';
import { accountsOff, error, isSameOrigin } from './http';

export type Viewer = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: Date;
  sessionId: string;
};

const SEEN_EVERY_MS = 5 * 60 * 1000;

/** The signed-in user for these request headers, or null. Disabled users count as signed out. */
export async function getViewer(headers: Headers): Promise<Viewer | null> {
  const auth = await getAuth();
  if (!auth) return null;
  const s = await auth.api.getSession({ headers });
  if (!s || s.user.disabled) return null;
  const viewer: Viewer = {
    id: s.user.id,
    email: s.user.email,
    name: s.user.name,
    emailVerified: s.user.emailVerified,
    createdAt: new Date(s.user.createdAt),
    sessionId: s.session.id,
  };
  const seen = s.user.lastSeenAt ? new Date(s.user.lastSeenAt).getTime() : 0;
  if (Date.now() - seen > SEEN_EVERY_MS) {
    const db = await getDb();
    const cutoff = new Date(Date.now() - SEEN_EVERY_MS);
    await db
      ?.update(schema.user)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(schema.user.id, viewer.id), or(isNull(schema.user.lastSeenAt), lt(schema.user.lastSeenAt, cutoff))))
      .catch(() => undefined);
  }
  return viewer;
}

/**
 * Runs a route handler for the signed-in user. Mutating methods must come from
 * this origin. The user id always comes from the session, never the request.
 */
export async function withViewer(
  req: Request,
  handler: (ctx: { viewer: Viewer; db: Db }) => Promise<Response>,
): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req)) {
    return error(403, 'Cross-site request refused.');
  }
  const db = await getDb().catch(() => null);
  if (!db || !(await getAuth())) return accountsOff();
  const viewer = await getViewer(req.headers);
  if (!viewer) return error(401, 'Sign in to use this.');
  return handler({ viewer, db });
}
