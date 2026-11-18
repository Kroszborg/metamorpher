'use client';

import { type RefObject, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * A highlight that slides to the active item of a segmented control or tab
 * list. Returns the indicator element to render as the container's first
 * child; the container must be `relative`, and the active item is found with
 * `selector` (default `[data-indicator-active]`).
 *
 * Positioning is imperative (no re-render per move). Until the first
 * measurement the container has no `data-indicator-ready`, so items keep
 * their own active background (style them with
 * `group-data-[indicator-ready]/<name>:…` to hand over): no flash before
 * hydration, and the first placement does not animate.
 */
export function useSlidingIndicator(
  container: RefObject<HTMLElement | null>,
  /** Anything that changes when the active item changes. */
  key: unknown,
  {
    className,
    selector = '[data-indicator-active]',
    watch = false,
  }: {
    className?: string;
    selector?: string;
    /** Also follow `data-state` changes inside the container (uncontrolled tabs). */
    watch?: boolean;
  } = {},
) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = container.current;
    const ind = ref.current;
    if (!box || !ind) return;
    const place = () => {
      const active = box.querySelector<HTMLElement>(selector);
      if (!active || active.offsetWidth === 0) {
        ind.style.opacity = '0';
        return;
      }
      ind.style.width = `${active.offsetWidth}px`;
      ind.style.height = `${active.offsetHeight}px`;
      ind.style.translate = `${active.offsetLeft}px ${active.offsetTop}px`;
      ind.style.opacity = '1';
      if (!box.hasAttribute('data-indicator-ready')) {
        void ind.offsetWidth; // commit the first position before transitions switch on
        box.setAttribute('data-indicator-ready', '');
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);
    let mo: MutationObserver | undefined;
    if (watch) {
      mo = new MutationObserver(place);
      mo.observe(box, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    }
    return () => {
      ro.disconnect();
      mo?.disconnect();
    };
  }, [container, key, selector, watch]);

  return (
    <span
      ref={ref}
      aria-hidden
      data-slot="sliding-indicator"
      className={cn('pointer-events-none absolute top-0 left-0 rounded-md opacity-0', className)}
    />
  );
}
