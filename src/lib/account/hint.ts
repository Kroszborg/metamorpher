'use client';

import { useSyncExternalStore } from 'react';

/**
 * A local note that this browser has signed in, so the top bar can show the
 * account menu without asking the server on every page. It holds a display
 * initial and name only; the session itself is an httpOnly cookie, and every
 * request is checked on the server. Signed-out visitors have no hint and the
 * site makes no account requests for them.
 */
export type AccountHint = { name: string; initial: string; admin: boolean };

const KEY = 'metamorpher:account';
const EVENT = 'metamorpher:account';

let cache: { raw: string | null; value: AccountHint | null } = { raw: null, value: null };

export function readHint(): AccountHint | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cache.raw) return cache.value;
  let value: AccountHint | null = null;
  try {
    const d = raw ? (JSON.parse(raw) as Partial<AccountHint>) : null;
    if (d && typeof d.name === 'string' && typeof d.initial === 'string') {
      value = { name: d.name, initial: d.initial, admin: d.admin === true };
    }
  } catch {
    value = null;
  }
  cache = { raw, value };
  return value;
}

export function setHint(user: { name: string; email: string }, admin: boolean): void {
  const label = user.name.trim() || user.email;
  const hint: AccountHint = { name: label, initial: (label[0] ?? '?').toUpperCase(), admin };
  try {
    if (localStorage.getItem(KEY) === JSON.stringify(hint)) return;
    localStorage.setItem(KEY, JSON.stringify(hint));
  } catch {
    // Storage blocked: the menu falls back to "Sign in" on the next page load.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearHint(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** undefined until hydrated (server render and first client render), then the hint or null. */
export function useAccountHint(): AccountHint | null | undefined {
  return useSyncExternalStore<AccountHint | null | undefined>(subscribe, readHint, () => undefined);
}

export function onHintChange(fn: () => void): () => void {
  return subscribe(fn);
}
