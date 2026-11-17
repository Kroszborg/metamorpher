import { getAuth } from '@/server/auth';
import { accountsOff } from '@/server/http';

/** Better Auth endpoints (sign-up, sign-in, sessions, password, verification). */
async function handle(req: Request): Promise<Response> {
  const auth = await getAuth().catch((err: unknown) => {
    console.error('[auth] could not start:', err instanceof Error ? err.message : err);
    return null;
  });
  if (!auth) return accountsOff();
  const res = await auth.handler(req);
  try {
    res.headers.set('Cache-Control', 'no-store');
  } catch {
    // Immutable headers (a redirect): nothing to add.
  }
  return res;
}

export const GET = handle;
export const POST = handle;
