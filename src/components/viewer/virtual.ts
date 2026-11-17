'use client';

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Browsers cap element heights (Firefox near 17.9 million px, Chrome near
 * 33.5 million), so content taller than this is scrolled through a shorter
 * spacer: the scrollbar maps proportionally and the wheel moves by real pixels.
 */
const MAX_SPACER = 8_000_000;

export type VirtualScroll = {
  /** Scroll position in content pixels. */
  top: number;
  left: number;
  width: number;
  height: number;
  /** Height to give the spacer inside the scroll element. */
  spacer: number;
  /**
   * Add to a content y to position an element inside the spacer (0 unless the
   * content is taller than the spacer).
   */
  shift: number;
  /** Scrolls so that content pixel `y` is at the top. */
  scrollTo: (y: number) => void;
};

type State = { top: number; left: number; width: number; height: number; shift: number };

/**
 * Tracks a scroll container showing `contentHeight` pixels of virtual content.
 * Children are positioned at `y + shift` inside a spacer of height `spacer`.
 */
export function useVirtualScroll(ref: RefObject<HTMLElement | null>, contentHeight: number): VirtualScroll {
  const [state, setState] = useState<State>({ top: 0, left: 0, width: 0, height: 0, shift: 0 });
  const virtualTop = useRef(0);
  const ours = useRef(false);
  const height = state.height;
  const spacer = Math.min(contentHeight, MAX_SPACER);
  const scale =
    contentHeight > MAX_SPACER && height > 0 ? Math.max(1, (contentHeight - height) / Math.max(1, MAX_SPACER - height)) : 1;
  const scaleRef = useRef(scale);
  const maxTop = Math.max(0, contentHeight - height);
  const maxRef = useRef(maxTop);

  const publish = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = Math.min(virtualTop.current, maxRef.current);
    const next: State = {
      top,
      left: el.scrollLeft,
      width: el.clientWidth,
      height: el.clientHeight,
      shift: el.scrollTop - top,
    };
    setState((s) =>
      s.top === next.top && s.left === next.left && s.width === next.width && s.height === next.height && s.shift === next.shift
        ? s
        : next,
    );
  }, [ref]);

  useLayoutEffect(() => {
    const changed = scaleRef.current !== scale || maxRef.current !== maxTop;
    scaleRef.current = scale;
    maxRef.current = maxTop;
    const el = ref.current;
    if (changed && el) {
      virtualTop.current = Math.min(maxTop, scale > 1 ? virtualTop.current : el.scrollTop);
      publish();
    }
  }, [scale, maxTop, ref, publish]);

  const scrollTo = useCallback(
    (y: number) => {
      const el = ref.current;
      if (!el) return;
      virtualTop.current = Math.max(0, Math.min(maxRef.current, y));
      const target = virtualTop.current / scaleRef.current;
      if (Math.abs(el.scrollTop - target) >= 0.5) {
        ours.current = true;
        el.scrollTop = target;
      }
      publish();
    },
    [ref, publish],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (ours.current) ours.current = false;
      else virtualTop.current = Math.min(maxRef.current, el.scrollTop * scaleRef.current);
      publish();
    };
    const onWheel = (e: WheelEvent) => {
      if (scaleRef.current <= 1 || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? el.clientHeight : 1;
      scrollTo(virtualTop.current + e.deltaY * unit);
    };
    const ro = new ResizeObserver(() => publish());
    ro.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    publish();
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
    };
  }, [ref, publish, scrollTo]);

  return { ...state, spacer, scrollTo };
}
