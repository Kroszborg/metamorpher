'use client';

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * JS side of the motion system (tokens and keyframes live in app/globals.css).
 * Everything here checks reduced motion itself, because Web Animations are not
 * covered by the CSS reduced-motion override.
 */

export const DUR = { 1: 120, 2: 180, 3: 240, 4: 420 } as const;
export const EASE = {
  enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  move: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Collapses a list item out of the flow: fades and slides it a little, then
 * closes the gap it leaves. Resolves when done; call the real removal after.
 * With reduced motion (or no element) it resolves at once.
 */
export function collapseOut(el: HTMLElement | null | undefined, duration: number = DUR[3]): Promise<void> {
  if (!el || prefersReducedMotion() || typeof el.animate !== 'function') return Promise.resolve();
  const cs = getComputedStyle(el);
  const from: Keyframe = {
    height: `${el.offsetHeight}px`,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
    borderTopWidth: cs.borderTopWidth,
    borderBottomWidth: cs.borderBottomWidth,
  };
  el.style.overflow = 'hidden';
  el.style.pointerEvents = 'none';
  const fade = el.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateX(-6px) scale(0.98)' },
    ],
    { duration: duration * 0.6, easing: EASE.exit, fill: 'forwards' },
  );
  const close = el.animate(
    [
      from,
      {
        height: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        marginTop: '0px',
        marginBottom: '0px',
        borderTopWidth: '0px',
        borderBottomWidth: '0px',
      },
    ],
    { duration, delay: duration * 0.35, easing: EASE.move, fill: 'forwards' },
  );
  return Promise.all([fade.finished, close.finished]).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Removes an item from a grid or list so that it fades out and the remaining
 * items glide into their new places (View Transitions). Items in `container`
 * need a stable `data-vt-key`; names are only assigned for the duration of the
 * change, so they never interfere with other transitions (such as the theme
 * reveal). Without View Transitions the item fades out, then `update` runs.
 */
export function removeFromList(
  container: Element | null | undefined,
  item: HTMLElement | null | undefined,
  update: () => void,
): void {
  if (!container || prefersReducedMotion()) {
    update();
    return;
  }
  if (typeof document.startViewTransition !== 'function') {
    if (!item || typeof item.animate !== 'function') return update();
    item
      .animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], {
        duration: DUR[2],
        easing: EASE.exit,
        fill: 'forwards',
      })
      .finished.then(update, update);
    return;
  }
  const named = Array.from(container.querySelectorAll<HTMLElement>('[data-vt-key]'));
  for (const el of named) el.style.viewTransitionName = `vt-${CSS.escape(el.dataset.vtKey ?? '')}`;
  const root = document.documentElement;
  root.classList.add('list-vt');
  const vt = document.startViewTransition(() => flushSync(update));
  vt.finished.finally(() => {
    root.classList.remove('list-vt');
    for (const el of named) el.style.viewTransitionName = '';
  });
}

/**
 * Keeps something mounted for `exitMs` after `open` turns false, so it can play
 * an exit animation. Returns whether to render it and whether it is leaving.
 */
export function usePresence(open: boolean, exitMs: number = DUR[2]): { present: boolean; leaving: boolean } {
  const [prevOpen, setPrevOpen] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setLeaving(!open);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), exitMs);
    return () => clearTimeout(t);
  }, [leaving, exitMs]);
  return { present: open || leaving, leaving: leaving && !open };
}
