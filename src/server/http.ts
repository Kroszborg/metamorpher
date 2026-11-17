import 'server-only';
import type { z } from 'zod';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { ...init, headers: { ...NO_STORE, ...init?.headers } });
}

export const error = (status: number, message: string) => json({ error: message }, { status });

export const accountsOff = () =>
  error(503, 'Accounts are not available on this site right now (no database is configured).');

/**
 * CSRF defence for cookie-authenticated mutations, on top of SameSite=Lax
 * cookies: the request must come from this origin.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (!origin) return site === 'same-origin';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads a JSON body of at most `maxBytes` and validates it. Returns a Response on failure. */
export async function readJson<T extends z.ZodType>(
  req: Request,
  schema: T,
  maxBytes = 64 * 1024,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > maxBytes) return { ok: false, res: error(413, 'Request body is too large.') };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, res: error(400, 'Could not read the request body.') };
  }
  if (text.length > maxBytes) return { ok: false, res: error(413, 'Request body is too large.') };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, res: error(400, 'Request body must be JSON.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: error(400, 'Invalid request.') };
  return { ok: true, data: parsed.data };
}
