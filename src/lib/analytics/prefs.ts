'use client';

import { useSyncExternalStore } from 'react';
import { ANALYTICS_ENABLED } from '@/lib/account/flags';

/**
 * The visitor's "Usage statistics" switch, kept in this browser. It is a
 * preference, not an identifier. Do Not Track and Global Privacy Control
 * always win over it.
 */
const KEY = 'metamorpher:usage-stats';
const EVENT = 'metamorpher:usage-stats';

export function browserOptedOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = window as Window & { doNotTrack?: string };
  return n.globalPrivacyControl === true || n.doNotTrack === '1' || w.doNotTrack === '1' || n.msDoNotTrack === '1';
}

export function statsSwitchOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setStatsSwitch(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // Blocked storage: the change lasts for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Whether this page may send anonymous usage statistics right now. */
export function statsAllowed(): boolean {
  if (!ANALYTICS_ENABLED || typeof window === 'undefined') return false;
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return false;
  return !browserOptedOut() && statsSwitchOn();
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', fn);
  };
}

export function onStatsSwitch(fn: () => void): () => void {
  return subscribe(fn);
}

/** [switch on, blocked by the browser]; undefined before hydration. */
export function useStatsSwitch(): { on: boolean; blocked: boolean } | undefined {
  const on = useSyncExternalStore(subscribe, statsSwitchOn, () => null);
  const blocked = useSyncExternalStore(subscribe, browserOptedOut, () => null);
  if (on === null || blocked === null) return undefined;
  return { on, blocked };
}
