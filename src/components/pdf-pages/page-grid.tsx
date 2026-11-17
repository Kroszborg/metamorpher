'use client';

import { Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import * as React from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { PdfPreview } from '@/engines/pdf';
import { isAbortError } from '@/engines';
import { cn } from '@/lib/utils';
import { cachedThumbnail, requestThumbnail, type Thumbnail } from './thumbnails';

/** One tile in the grid. */
export type GridPage = {
  /** Stable and unique within the grid (React key, selection key, drag id). */
  key: string;
  /** The open document to draw the thumbnail from (null shows a placeholder). */
  preview: PdfPreview | null;
  /** 0-based page index in that document. */
  index: number;
  /** Extra clockwise rotation to show, in degrees (a multiple of 90). */
  rotation?: number;
  /** Mirror the thumbnail as the output will be. */
  flip?: 'horizontal' | 'vertical';
  /** Caption under the tile. Default: the page number. */
  label?: React.ReactNode;
  /** 'danger' marks pages that will be removed; 'muted' pages that are left out. */
  tone?: 'default' | 'muted' | 'danger';
  /** A short tag in the tile's bottom-left corner, such as "Part 2" where a part starts. */
  badge?: React.ReactNode;
};

export type PageGridProps = {
  pages: readonly GridPage[];
  /** Selected keys. Selection is enabled when `onSelectedChange` is given. */
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Enables drag-to-reorder and Alt+arrow keys. Positions are indexes into `pages`. */
  onMove?: (from: number, to: number) => void;
  /** Small buttons shown on hover/focus in the tile's top-right corner. */
  actions?: (page: GridPage, position: number) => React.ReactNode;
  /** Drawn over the page area, sized to the page as displayed (use percentages). */
  overlay?: (page: GridPage, position: number) => React.ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
};

const RootContext = createContext<React.RefObject<HTMLElement | null> | null>(null);

const norm = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

/**
 * A lazily rendered page thumbnail. It renders only while near the visible
 * part of the grid, and a render is cancelled when the tile scrolls away.
 */
/** Memoised: grids re-render often (selection, progress) while most tiles stay the same. */
export const PageThumb = React.memo(PageThumbImpl);

function PageThumbImpl({
  preview,
  index,
  rotation = 0,
  flip,
  overlay,
  className,
}: {
  preview: PdfPreview | null;
  index: number;
  rotation?: number;
  flip?: 'horizontal' | 'vertical';
  overlay?: React.ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const root = useContext(RootContext);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<{ preview: PdfPreview; index: number; thumb: Thumbnail } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { root: root?.current ?? null, rootMargin: '240px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  const cached = preview ? cachedThumbnail(preview, index) : undefined;
  const thumb = cached ?? (loaded && loaded.preview === preview && loaded.index === index ? loaded.thumb : null);

  useEffect(() => {
    if (!visible || !preview || thumb) return;
    const controller = new AbortController();
    requestThumbnail(preview, index, controller.signal).then(
      (t) => setLoaded({ preview, index, thumb: t }),
      (err: unknown) => {
        if (!isAbortError(err) && !controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [visible, preview, index, thumb]);

  let content: React.ReactNode = null;
  if (thumb) {
    const r = norm(rotation);
    const sideways = r % 180 !== 0;
    const dw = sideways ? thumb.height : thumb.width;
    const dh = sideways ? thumb.width : thumb.height;
    // The tile is 3:4. Scale so the page as displayed fits with a small inset.
    const s = Math.min(3 / dw, 4 / dh) * 0.9;
    const pct = (v: number) => `${v * 100}%`;
    const mirror = flip === 'horizontal' ? 'scaleX(-1) ' : flip === 'vertical' ? 'scaleY(-1) ' : '';
    content = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb.url}
          alt=""
          draggable={false}
          className="absolute top-1/2 left-1/2 max-w-none bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-150"
          style={{
            width: pct((s * thumb.width) / 3),
            height: pct((s * thumb.height) / 4),
            transform: `translate(-50%, -50%) ${mirror}rotate(${r}deg)`,
          }}
        />
        {overlay ? (
          <div
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: pct((s * dw) / 3), height: pct((s * dh) / 4) }}
          >
            {overlay}
          </div>
        ) : null}
      </>
    );
  } else if (failed) {
    content = (
      <span className="absolute inset-0 grid place-items-center text-[0.65rem] text-muted-foreground">
        No preview
      </span>
    );
  } else {
    content = <span className="absolute inset-[8%_14%] animate-pulse rounded-sm bg-muted" />;
  }

  return (
    <div ref={box} className={cn('relative aspect-[3/4] w-full', className)}>
      {content}
    </div>
  );
}

/**
 * Page thumbnails in a responsive grid, for one or several documents.
 *
 * - Thumbnails render lazily (only near the visible area, newest request first),
 *   so a 500-page PDF does not block the tab.
 * - Click toggles a page, Shift+click selects a range; Space/Enter and
 *   Shift+Space do the same from the keyboard; arrows move focus; Ctrl+A selects all.
 * - With `onMove`: drag tiles, or Alt+arrow keys, to reorder.
 */
export const PageGrid = React.memo(PageGridImpl, (prev, next) => {
  // While a run is in progress the grid is inert, so progress ticks (which
  // re-render the whole tool) need not re-render hundreds of tiles.
  if (!prev.disabled || !next.disabled || prev.pages !== next.pages) return false;
  const a = prev.selected;
  const b = next.selected;
  if (a === b) return true;
  return !!a && !!b && a.size === b.size && [...a].every((k) => b.has(k));
});

function PageGridImpl({
  pages,
  selected,
  onSelectedChange,
  onMove,
  actions,
  overlay,
  disabled = false,
  'aria-label': ariaLabel = 'Pages',
  className,
}: PageGridProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const anchor = useRef<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [focusPos, setFocusPos] = useState(0);
  const [dropAt, setDropAt] = useState<{ pos: number; after: boolean } | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const selectable = Boolean(onSelectedChange);
  const canMove = Boolean(onMove) && !disabled;
  const current = Math.min(focusPos, Math.max(0, pages.length - 1));

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const el = listRef.current?.children[target];
    if (el instanceof HTMLElement) el.focus();
  });

  const focusCell = (pos: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, pos));
    setFocusPos(clamped);
    pendingFocus.current = clamped;
  };

  const toggle = (pos: number, range: boolean) => {
    if (!onSelectedChange || disabled) return;
    const page = pages[pos];
    if (!page) return;
    const next = new Set(selected);
    if (range && anchor.current !== null) {
      const [a, b] = anchor.current < pos ? [anchor.current, pos] : [pos, anchor.current];
      for (let i = a; i <= b; i += 1) {
        const k = pages[i]?.key;
        if (k) next.add(k);
      }
    } else {
      if (next.has(page.key)) next.delete(page.key);
      else next.add(page.key);
      anchor.current = pos;
    }
    onSelectedChange(next);
  };

  const columns = () => {
    const kids = listRef.current?.children;
    if (!kids || kids.length === 0) return 1;
    const top = (kids[0] as HTMLElement).offsetTop;
    let n = 0;
    while (n < kids.length && (kids[n] as HTMLElement).offsetTop === top) n += 1;
    return Math.max(1, n);
  };

  const move = (from: number, to: number) => {
    if (!onMove || from === to || to < 0 || to >= pages.length) return;
    onMove(from, to);
    focusCell(to);
  };

  const onKeyDown = (e: React.KeyboardEvent, pos: number) => {
    const step =
      e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns() : e.key === 'ArrowUp' ? -columns() : 0;
    if (step !== 0) {
      e.preventDefault();
      if (e.altKey && canMove) move(pos, Math.max(0, Math.min(pages.length - 1, pos + step)));
      else focusCell(pos + step);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusCell(e.key === 'Home' ? 0 : pages.length - 1);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle(pos, e.shiftKey);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && onSelectedChange && !disabled) {
      e.preventDefault();
      onSelectedChange(new Set(pages.map((p) => p.key)));
    }
  };

  return (
    <RootContext.Provider value={listRef}>
      <ul
        ref={listRef}
        role="listbox"
        aria-label={`${ariaLabel}${canMove ? '. Drag, or use Alt with the arrow keys, to reorder.' : ''}`}
        aria-multiselectable={selectable || undefined}
        className={cn(
          'grid max-h-[36rem] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] content-start gap-1.5 overflow-y-auto p-1',
          disabled && 'pointer-events-none opacity-60',
          className,
        )}
      >
        {pages.map((page, pos) => {
          const isSelected = selected?.has(page.key) ?? false;
          const label = page.label ?? page.index + 1;
          return (
            <li
              key={page.key}
              role="option"
              aria-selected={selectable ? isSelected : undefined}
              aria-label={`Page ${typeof label === 'string' || typeof label === 'number' ? label : page.index + 1}`}
              tabIndex={pos === current ? 0 : -1}
              draggable={canMove}
              onFocus={() => setFocusPos(pos)}
              onClick={(e) => {
                setFocusPos(pos);
                toggle(pos, e.shiftKey);
              }}
              onKeyDown={(e) => onKeyDown(e, pos)}
              onDragStart={(e) => {
                dragFrom.current = pos;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(pos));
              }}
              onDragOver={(e) => {
                if (dragFrom.current === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > rect.left + rect.width / 2;
                if (dropAt?.pos !== pos || dropAt.after !== after) setDropAt({ pos, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                const at = dropAt;
                dragFrom.current = null;
                setDropAt(null);
                if (from === null || !at) return;
                let to = at.after ? at.pos + 1 : at.pos;
                if (to > from) to -= 1;
                move(from, to);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDropAt(null);
              }}
              className={cn(
                'group relative flex min-w-0 cursor-default flex-col gap-1 rounded-lg p-1 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40',
                selectable && 'cursor-pointer',
                canMove && 'active:cursor-grabbing',
              )}
            >
              {dropAt?.pos === pos ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1 bottom-6 w-0.5 rounded-full bg-primary',
                    dropAt.after ? '-right-1' : '-left-1',
                  )}
                />
              ) : null}
              <div
                className={cn(
                  'relative overflow-hidden rounded-md border bg-muted/40 transition-colors',
                  isSelected && 'border-primary ring-2 ring-primary/70',
                  page.tone === 'danger' && 'bg-destructive/10',
                  !isSelected && selectable && 'group-hover:border-foreground/25',
                )}
              >
                <PageThumb
                  preview={page.preview}
                  index={page.index}
                  rotation={page.rotation}
                  flip={page.flip}
                  overlay={overlay?.(page, pos)}
                  className={cn(page.tone === 'muted' && 'opacity-40', page.tone === 'danger' && 'opacity-45')}
                />
                {page.badge ? (
                  <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded-[4px] bg-primary px-1 py-px text-[0.6rem] font-medium text-primary-foreground shadow-sm">
                    {page.badge}
                  </span>
                ) : null}
                {page.tone === 'danger' ? (
                  <span aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklch,var(--destructive),transparent_82%)_6px_8px)]" />
                ) : null}
                {selectable ? (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1.5 left-1.5 grid size-4 place-items-center rounded-[4px] border bg-background/90 transition-colors',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    {isSelected ? <HugeiconsIcon icon={Tick02Icon} strokeWidth={3} className="size-3" /> : null}
                  </span>
                ) : null}
                {actions && !disabled ? (
                  <div
                    className="absolute top-1 right-1 flex gap-0.5 rounded-md bg-background/90 p-0.5 opacity-0 shadow-sm ring-1 ring-border transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {actions(page, pos)}
                  </div>
                ) : null}
              </div>
              <span className="truncate text-center font-mono text-[0.7rem] text-muted-foreground tabular-nums">
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </RootContext.Provider>
  );
}
