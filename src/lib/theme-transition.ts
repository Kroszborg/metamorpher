'use client';

import { flushSync } from 'react-dom';
import { DUR, prefersReducedMotion } from './motion';
import { syncThemeColor } from './theme-color';

type Resolved = 'light' | 'dark';
type Origin = Element | { x: number; y: number } | null | undefined;

/**
 * Animated light/dark switching on top of next-themes.
 *
 * next-themes only applies the `.dark` class in an effect after `setTheme`, so
 * this applies it synchronously itself (next-themes re-applying the same class
 * later is a no-op). Three paths:
 *   View Transitions  the new theme is revealed as a circle growing from the
 *                     toggle (or the given origin); nothing else transitions
 *                     meanwhile because the new view is live.
 *   No VT support     a short colour cross-fade, scoped to the switch only.
 *   Reduced motion    an instant, clean swap.
 */

const resolve = (theme: string): Resolved =>
  theme === 'dark' || theme === 'light'
    ? theme
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';

function applyClass(theme: Resolved) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

function originPoint(origin: Origin): { x: number; y: number } {
  let el: Element | null = null;
  if (origin && 'getBoundingClientRect' in origin) el = origin;
  else if (origin) return origin as { x: number; y: number };
  else {
    // From the command palette or settings: grow from the visible header toggle.
    el =
      Array.from(document.querySelectorAll('[data-theme-toggle]')).find(
        (e) => e.getBoundingClientRect().width > 0,
      ) ?? null;
  }
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth - 48, y: 28 };
}

const removeLater = (classes: string[], ms: number) =>
  window.setTimeout(() => document.documentElement.classList.remove(...classes), ms);

/** Adds the scoped cross-fade for a theme change that happens right after this call. */
export function crossFadeNextThemeChange(): void {
  if (prefersReducedMotion()) return;
  document.documentElement.classList.add('theme-fade', 'theme-anim');
  removeLater(['theme-fade', 'theme-anim'], DUR[3] + 140);
}

export function switchTheme(next: string, setTheme: (theme: string) => void, origin?: Origin): void {
  const root = document.documentElement;
  const target = resolve(next);
  const current: Resolved = root.classList.contains('dark') ? 'dark' : 'light';

  const commit = () => {
    applyClass(target);
    syncThemeColor();
    flushSync(() => setTheme(next));
  };

  if (target === current) {
    setTheme(next);
    return;
  }

  if (prefersReducedMotion()) {
    root.classList.add('theme-switching');
    commit();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    return;
  }

  if (typeof document.startViewTransition !== 'function') {
    crossFadeNextThemeChange();
    commit();
    return;
  }

  const { x, y } = originPoint(origin);
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.classList.add('theme-switching', 'theme-anim');
  const vt = document.startViewTransition(commit);
  vt.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: DUR[4],
          easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    .catch(() => {});
  vt.finished.finally(() => root.classList.remove('theme-switching', 'theme-anim'));
}
