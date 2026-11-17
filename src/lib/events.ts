'use client';

/**
 * In-page event bus for usage events. Tools and the shell emit; the optional
 * background services (anonymous statistics, account history sync) listen.
 * Nothing leaves the page from here: each listener decides what, if anything,
 * to send. File names are carried only for the signed-in user's own history
 * and only reach the server when that user has switched file names on.
 */
export type RunOutcome = 'success' | 'failed' | 'cancelled';

export type AppEvent =
  | { type: 'pageview'; path: string }
  | { type: 'tool_open'; tool: string }
  | { type: 'run_start'; tool: string; files: number; bytes: number }
  | {
      type: 'run_end';
      tool: string;
      outcome: RunOutcome;
      files: number;
      bytes: number;
      durationMs: number;
      errorCode?: string;
      names: string[];
    };

type Listener = (e: AppEvent) => void;

const listeners = new Set<Listener>();
// Events from before a listener loaded (the services start after idle) are replayed to it.
const backlog: AppEvent[] = [];
const BACKLOG_MAX = 50;

const recent = new Map<string, number>();

export function emit(e: AppEvent): void {
  if (typeof window === 'undefined') return;
  // Page views and tool opens fire from effects; drop an immediate repeat
  // (React strict mode runs effects twice in development).
  if (e.type === 'pageview' || e.type === 'tool_open') {
    const key = e.type === 'pageview' ? `p:${e.path}` : `t:${e.tool}`;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < 1000) return;
    recent.set(key, now);
  }
  backlog.push(e);
  if (backlog.length > BACKLOG_MAX) backlog.shift();
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      // A listener must never break the page.
    }
  }
}

export function listen(l: Listener, { replay = true } = {}): () => void {
  listeners.add(l);
  if (replay) for (const e of backlog) l(e);
  return () => listeners.delete(l);
}

/** The tool slug of the current page, from /tools/<slug>. */
export function currentToolSlug(): string | null {
  if (typeof window === 'undefined') return null;
  return /^\/tools\/([a-z0-9-]+)/.exec(window.location.pathname)?.[1] ?? null;
}

/** A short, content-free code for a failure: never the message itself. */
export function errorCode(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (name === 'AbortError') return 'aborted';
  if (/password|encrypt/.test(msg)) return 'encrypted';
  if (/memory|allocation|out of bounds|too large|array buffer/.test(msg) || name === 'RangeError') return 'too_large';
  if (/not supported|unsupported|no decoder|no encoder|codec/.test(msg)) return 'unsupported';
  if (/corrupt|invalid|damaged|malformed|parse|could not read|cannot read/.test(msg)) return 'invalid_input';
  if (/network|fetch|load failed|offline/.test(msg)) return 'network';
  if (/timeout|timed out/.test(msg)) return 'timeout';
  if (/worker/.test(msg)) return 'worker';
  if (name === 'TypeError') return 'type_error';
  return 'error';
}
