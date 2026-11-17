'use client';

import type * as React from 'react';
import { useRef } from 'react';
import type { Placement } from '@/engines/pdf-stamp/geometry';
import { cn } from '@/lib/utils';
import type { StageView } from './stage';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: { id: Corner; sx: 1 | -1; sy: 1 | -1; className: string }[] = [
  { id: 'nw', sx: -1, sy: -1, className: '-left-1.5 -top-1.5 cursor-nwse-resize' },
  { id: 'ne', sx: 1, sy: -1, className: '-right-1.5 -top-1.5 cursor-nesw-resize' },
  { id: 'sw', sx: -1, sy: 1, className: '-left-1.5 -bottom-1.5 cursor-nesw-resize' },
  { id: 'se', sx: 1, sy: 1, className: '-right-1.5 -bottom-1.5 cursor-nwse-resize' },
];

type Gesture =
  | { kind: 'move'; x: number; y: number; cx: number; cy: number }
  | { kind: 'resize'; x: number; y: number; cx: number; cy: number; w: number; h: number; sx: number; sy: number }
  | { kind: 'rotate' };

export type StageItemProps = {
  view: StageView;
  placement: Placement;
  onChange: (next: Placement) => void;
  selected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  /** Keep the width/height ratio while resizing. Default true. */
  lockAspect?: boolean;
  /** Smallest side in points. Default 8. */
  minSize?: number;
  /** Accessible name, such as "Signature". */
  label: string;
  children: React.ReactNode;
};

/**
 * An overlay on a `PdfStage` page that can be dragged, resized from its
 * corners and rotated from the top handle. Its `placement` is in PDF user
 * space (centre) and reader-upright points (size), so it maps directly to
 * `placementMatrix` when the output is written. Arrow keys nudge it by 1 pt
 * (10 with Shift); Delete removes it.
 */
export function StageItem({
  view,
  placement: p,
  onChange,
  selected,
  onSelect,
  onDelete,
  lockAspect = true,
  minSize = 8,
  label,
  children,
}: StageItemProps) {
  const gesture = useRef<Gesture | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const s = view.scale;
  const [px, py] = view.toView(p.cx, p.cy);
  const w = p.width * s;
  const h = p.height * s;

  const start = (e: React.PointerEvent, g: Gesture) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect?.();
    gesture.current = g;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    e.preventDefault();
    if (g.kind === 'move') {
      const [cx, cy] = view.toUser(g.cx + e.clientX - g.x, g.cy + e.clientY - g.y);
      onChange({ ...p, cx, cy });
    } else if (g.kind === 'resize') {
      const rad = (p.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      // Pointer delta in the item's own (unrotated) axes.
      const lx = cos * dx + sin * dy;
      const ly = -sin * dx + cos * dy;
      const min = minSize * s;
      let nw: number;
      let nh: number;
      if (lockAspect) {
        const k = Math.max(
          min / Math.min(g.w, g.h),
          1 + (g.sx * lx * g.w + g.sy * ly * g.h) / (g.w * g.w + g.h * g.h),
        );
        nw = g.w * k;
        nh = g.h * k;
      } else {
        nw = Math.max(min, g.w + g.sx * lx);
        nh = Math.max(min, g.h + g.sy * ly);
      }
      // Keep the opposite corner where it was.
      const ox = (g.sx * (nw - g.w)) / 2;
      const oy = (g.sy * (nh - g.h)) / 2;
      const [cx, cy] = view.toUser(g.cx + cos * ox - sin * oy, g.cy + sin * ox + cos * oy);
      onChange({ ...p, cx, cy, width: nw / s, height: nh / s });
    } else {
      const r = el.current?.parentElement?.getBoundingClientRect();
      if (!r) return;
      const angle = (Math.atan2(e.clientY - (r.top + py), e.clientX - (r.left + px)) * 180) / Math.PI + 90;
      let rotation = ((angle % 360) + 540) % 360 - 180;
      const snap = Math.round(rotation / 15) * 15;
      if (e.shiftKey || Math.abs(rotation - snap) < 3) rotation = snap;
      onChange({ ...p, rotation: Math.round(rotation * 10) / 10 });
    }
  };

  const end = (e: React.PointerEvent) => {
    if (!gesture.current) return;
    gesture.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete?.();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    const [cx, cy] = view.toUser(px + delta[0] * s, py + delta[1] * s);
    onChange({ ...p, cx, cy });
  };

  return (
    <div
      ref={el}
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => start(e, { kind: 'move', x: e.clientX, y: e.clientY, cx: px, cy: py })}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className={cn(
        'absolute cursor-move touch-none outline-none select-none',
        selected ? 'ring-2 ring-primary' : 'ring-1 ring-primary/40 hover:ring-primary/70',
      )}
      style={{ left: px - w / 2, top: py - h / 2, width: w, height: h, transform: `rotate(${p.rotation}deg)` }}
      data-stage-item=""
    >
      <div className="pointer-events-none size-full">{children}</div>
      {selected ? (
        <>
          {CORNERS.map((c) => (
            <span
              key={c.id}
              aria-hidden="true"
              data-handle={c.id}
              onPointerDown={(e) =>
                start(e, { kind: 'resize', x: e.clientX, y: e.clientY, cx: px, cy: py, w, h, sx: c.sx, sy: c.sy })
              }
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className={cn('absolute size-3 rounded-sm border-2 border-primary bg-background', c.className)}
            />
          ))}
          <span aria-hidden="true" className="absolute -top-5 left-1/2 h-5 w-px bg-primary" />
          <span
            aria-hidden="true"
            data-handle="rotate"
            onPointerDown={(e) => start(e, { kind: 'rotate' })}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute -top-7 left-1/2 size-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-primary bg-background"
          />
        </>
      ) : null}
    </div>
  );
}
