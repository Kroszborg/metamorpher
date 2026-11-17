'use client';

import { type AppEvent, listen } from '@/lib/events';
import { onStatsSwitch, statsAllowed } from './prefs';

/**
 * First-party, cookieless usage statistics. Sends page paths and tool events
 * (opened, run started/succeeded/failed/cancelled) to /api/e with
 * navigator.sendBeacon, batched after the page is idle. No identifiers are
 * created or stored in the browser; no file names, contents or exact sizes
 * are sent (sizes only as a coarse bucket). Failures are dropped silently.
 */
type Wire = { t: string; p?: string; tl?: string; e?: string; d?: number; s?: string; r?: string };

const MAX_BATCH = 20;
let queue: Wire[] = [];
let timer: number | undefined;
let stop: (() => void) | null = null;
let sentReferrer = false;
let everStarted = false;

function sizeBucket(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb < 1) return 'lt1mb';
  if (mb < 10) return '1-10mb';
  if (mb < 100) return '10-100mb';
  if (mb < 1024) return '100mb-1gb';
  return 'gt1gb';
}

function referrerHost(): string | undefined {
  if (sentReferrer) return undefined;
  sentReferrer = true;
  try {
    if (!document.referrer) return undefined;
    const host = new URL(document.referrer).hostname;
    return host && host !== location.hostname ? host : undefined;
  } catch {
    return undefined;
  }
}

function toWire(e: AppEvent): Wire | null {
  switch (e.type) {
    case 'pageview':
      if (e.path.startsWith('/admin')) return null;
      return { t: 'pageview', p: e.path, r: referrerHost() };
    case 'tool_open':
      return { t: 'tool_open', tl: e.tool };
    case 'run_start':
      return { t: 'run_start', tl: e.tool, s: sizeBucket(e.bytes) };
    case 'run_end':
      return {
        t: e.outcome === 'success' ? 'run_success' : e.outcome === 'failed' ? 'run_fail' : 'run_cancel',
        tl: e.tool,
        s: sizeBucket(e.bytes),
        d: Math.round(e.durationMs / 100) * 100,
        e: e.outcome === 'failed' ? e.errorCode : undefined,
      };
  }
}

function flush() {
  timer = undefined;
  if (!queue.length) return;
  if (!statsAllowed()) {
    queue = [];
    return;
  }
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const body = new Blob([JSON.stringify(batch)], { type: 'text/plain' });
    if (!navigator.sendBeacon?.('/api/e', body)) {
      void fetch('/api/e', { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => undefined);
    }
  } catch {
    // Dropped: statistics are best-effort.
  }
  if (queue.length) schedule();
}

function schedule() {
  if (timer !== undefined) return;
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  timer = ric ? ric(flush, { timeout: 5000 }) : window.setTimeout(flush, 2000);
}

function onHide() {
  if (document.visibilityState === 'hidden') flush();
}

export function startAnalytics(): void {
  if (stop || !statsAllowed()) return;
  // Events from before start (this page load) are replayed once; a restart after
  // the switch is turned back on only counts what happens from then on.
  const replay = !everStarted;
  everStarted = true;
  const unlisten = listen((e) => {
    if (!statsAllowed()) return;
    const w = toWire(e);
    if (!w) return;
    queue.push(w);
    if (queue.length > 100) queue = queue.slice(-100);
    schedule();
  }, { replay });
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  const unswitch = onStatsSwitch(() => {
    if (!statsAllowed()) stopAnalytics();
  });
  stop = () => {
    unlisten();
    unswitch();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
  };
}

export function stopAnalytics(): void {
  queue = [];
  stop?.();
  stop = null;
}
