'use client';

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string; code?: string };

/** Same-origin JSON request to the account API. Never throws. */
export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  init?: { keepalive?: boolean },
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive: init?.keepalive,
    });
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Check your connection and try again.' };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) return { ok: true, status: res.status, data: data as T };
  const d = (data ?? {}) as { message?: string; error?: string; code?: string };
  let message = d.message || d.error || `Request failed (${res.status}).`;
  if (res.status === 429) {
    const wait = Number(res.headers.get('x-retry-after'));
    message = `Too many attempts. Try again in ${Number.isFinite(wait) && wait > 0 ? `${wait} s` : 'a minute'}.`;
  }
  if (res.status === 503) message = d.error || 'Accounts are not available right now.';
  return { ok: false, status: res.status, message, code: d.code };
}
