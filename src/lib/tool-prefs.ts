'use client';

import { useSyncExternalStore } from 'react';

/**
 * Starred tools and recently opened tools, kept in localStorage on this
 * device. Only tool slugs are stored, never file names or contents.
 */
const STARRED_KEY = 'metamorpher:starred';
const RECENT_KEY = 'metamorpher:recent';
const RECENT_MAX = 12;
const EVENT = 'metamorpher:tool-prefs';
const EMPTY: readonly string[] = [];

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, slugs: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(slugs));
  } catch {
    // Unavailable storage: the change lasts until reload.
    memory.set(key, JSON.stringify(slugs));
  }
  window.dispatchEvent(new Event(EVENT));
}

// Fallback for blocked storage, and a cache so snapshots keep a stable identity.
const memory = new Map<string, string>();
const parsed = new Map<string, { raw: string; value: readonly string[] }>();

function snapshot(key: string): readonly string[] {
  const raw = load(key) ?? memory.get(key) ?? '[]';
  const cached = parsed.get(key);
  if (cached?.raw === raw) return cached.value;
  let value: readonly string[] = EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (Array.isArray(data)) value = data.filter((x): x is string => typeof x === 'string');
  } catch {
    value = EMPTY;
  }
  parsed.set(key, { raw, value });
  return value;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useStarred(): readonly string[] {
  return useSyncExternalStore(subscribe, () => snapshot(STARRED_KEY), () => EMPTY);
}

export function useRecent(): readonly string[] {
  return useSyncExternalStore(subscribe, () => snapshot(RECENT_KEY), () => EMPTY);
}

export function toggleStar(slug: string): void {
  const current = snapshot(STARRED_KEY);
  save(STARRED_KEY, current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]);
}

export function recordRecent(slug: string): void {
  const current = snapshot(RECENT_KEY);
  if (current[0] === slug) return;
  save(RECENT_KEY, [slug, ...current.filter((s) => s !== slug)].slice(0, RECENT_MAX));
}

export function clearRecent(): void {
  save(RECENT_KEY, []);
}

/* Account sync (used only when a signed-in user has switched tool sync on). */

export function readToolPrefs(): { starred: string[]; recent: string[] } {
  return { starred: [...snapshot(STARRED_KEY)], recent: [...snapshot(RECENT_KEY)] };
}

export function replaceToolPrefs(next: { starred: readonly string[]; recent: readonly string[] }): void {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(snapshot(STARRED_KEY), next.starred)) save(STARRED_KEY, next.starred);
  if (!same(snapshot(RECENT_KEY), next.recent)) save(RECENT_KEY, next.recent.slice(0, RECENT_MAX));
}

export function onToolPrefsChange(fn: () => void): () => void {
  return subscribe(fn);
}
