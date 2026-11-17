'use client';

import { listen } from '@/lib/events';
import { onToolPrefsChange, readToolPrefs, replaceToolPrefs } from '@/lib/tool-prefs';
import { api } from './api';
import { clearHint, setHint } from './hint';

/**
 * Account sync for a signed-in browser. Loaded only when the account hint is
 * present, so signed-out visitors never download or run it. Every feature
 * follows the user's switches on /account, all off by default.
 */
export type SyncSettings = {
  syncTools: boolean;
  syncHistory: boolean;
  historyFileNames: boolean;
  syncChats: boolean;
};
type Tools = { starred: string[]; recent: string[]; updatedAt: number } | null;
export type Me = {
  user: { name: string; email: string; emailVerified: boolean; createdAt: number };
  admin: boolean;
  settings: SyncSettings;
  tools: Tools;
};

const BASE_KEY = 'metamorpher:sync-base';
const SETTINGS_EVENT = 'metamorpher:account-settings';

let started: Promise<Me | null> | null = null;
let me: Me | null = null;
const stops: (() => void)[] = [];

type Lists = { starred: string[]; recent: string[] };

function readBase(): Lists | null {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    const d = raw ? (JSON.parse(raw) as Lists) : null;
    return d && Array.isArray(d.starred) && Array.isArray(d.recent) ? d : null;
  } catch {
    return null;
  }
}

function writeBase(l: Lists | null) {
  try {
    if (l) localStorage.setItem(BASE_KEY, JSON.stringify(l));
    else localStorage.removeItem(BASE_KEY);
  } catch {
    // ignore
  }
}

const dedupe = (xs: string[]) => [...new Set(xs)];

/**
 * Three-way merge of this device's lists with the account's, against the
 * state both last agreed on (the base). Without a base (first sync on this
 * device) the lists are combined.
 */
export function mergeLists(local: Lists, server: Lists, base: Lists | null): Lists {
  if (!base) {
    return {
      starred: dedupe([...local.starred, ...server.starred]),
      recent: dedupe([...local.recent, ...server.recent]).slice(0, 12),
    };
  }
  const removed = new Set(base.starred.filter((s) => !local.starred.includes(s)));
  const added = local.starred.filter((s) => !base.starred.includes(s));
  const starred = dedupe([...server.starred.filter((s) => !removed.has(s)), ...added]);

  let recent: string[];
  if (local.recent.length === 0 && base.recent.length > 0) recent = [];
  else {
    const anchor = base.recent[0];
    const cut = anchor ? local.recent.indexOf(anchor) : -1;
    const fresh = cut >= 0 ? local.recent.slice(0, cut) : local.recent;
    recent = dedupe([...fresh, ...server.recent]).slice(0, 12);
  }
  return { starred, recent };
}

async function syncTools(server: Tools): Promise<void> {
  const local = readToolPrefs();
  const merged = mergeLists(local, server ?? { starred: [], recent: [] }, readBase());
  replaceToolPrefs(merged);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!server || !same(server.starred, merged.starred) || !same(server.recent, merged.recent)) {
    const r = await api('PUT', '/api/me/tools', merged);
    if (!r.ok) return;
  }
  writeBase(merged);
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePush() {
  if (!me?.settings.syncTools) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (!me?.settings.syncTools) return;
    const lists = readToolPrefs();
    const r = await api('PUT', '/api/me/tools', lists, { keepalive: true });
    if (r.ok) writeBase(lists);
  }, 1200);
}

async function load(): Promise<Me | null> {
  const r = await api<Me>('GET', '/api/me');
  if (!r.ok) {
    if (r.status === 401) clearHint();
    return null;
  }
  me = r.data;
  setHint(me.user, me.admin);
  if (me.settings.syncTools) await syncTools(me.tools);
  return me;
}

/** Starts sync once per page load. Resolves to the account, or null when signed out. */
export function startSync(): Promise<Me | null> {
  if (started) return started;
  // Listen before loading so a change made while the account loads is not missed.
  let changedEarly = false;
  const offEarly = onToolPrefsChange(() => {
    changedEarly = true;
  });
  started = load().then((m) => {
    offEarly();
    if (!m) {
      started = null;
      return null;
    }
    stops.push(onToolPrefsChange(schedulePush));
    if (changedEarly) schedulePush();
    stops.push(
      listen((e) => {
        if (e.type !== 'run_end' || !me?.settings.syncHistory) return;
        void api('POST', '/api/me/history', {
          tool: e.tool,
          fileCount: e.files,
          totalBytes: e.bytes,
          durationMs: e.durationMs,
          outcome: e.outcome,
          errorCode: e.errorCode,
          // File names go only to the user's own history, and only when they asked for that.
          ...(me.settings.historyFileNames ? { fileNames: e.names.slice(0, 50).map((n) => n.slice(0, 255)) } : {}),
        });
      }, { replay: false }),
    );
    const onSettings = (ev: Event) => {
      const next = (ev as CustomEvent<SyncSettings>).detail;
      if (!me || !next) return;
      const toolsTurnedOn = next.syncTools && !me.settings.syncTools;
      me = { ...me, settings: next };
      if (toolsTurnedOn) void api<{ tools: Tools; settings: SyncSettings }>('GET', '/api/me').then((r) => {
        if (r.ok) void syncTools(r.data.tools);
      });
    };
    window.addEventListener(SETTINGS_EVENT, onSettings);
    stops.push(() => window.removeEventListener(SETTINGS_EVENT, onSettings));
    return m;
  });
  return started;
}

/** Called after sign-out or account deletion. Local data stays; the sync link is cut. */
export function stopSync(): void {
  for (const s of stops.splice(0)) s();
  clearTimeout(pushTimer);
  started = null;
  me = null;
  writeBase(null);
}

/** Tell the running sync (if any) that the switches changed. */
export function announceSettings(settings: SyncSettings): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
}

export async function currentSettings(): Promise<SyncSettings | null> {
  const m = await startSync();
  return m ? m.settings : null;
}
