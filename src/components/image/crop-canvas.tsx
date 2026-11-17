'use client';

/* eslint-disable @next/next/no-img-element -- object URLs of local files, not optimisable */

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { CHECKERBOARD } from './checker';

/** A crop rectangle in fractions (0–1) of the image's width and height. */
export type NormRect = { x: number; y: number; width: number; height: number };

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Mode = Handle | 'move' | 'new';
type Px = { x: number; y: number; w: number; h: number };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS: Record<Handle, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  n: 'left-1/2 top-0 cursor-ns-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  e: 'left-full top-1/2 cursor-ew-resize',
  se: 'left-full top-full cursor-nwse-resize',
  s: 'left-1/2 top-full cursor-ns-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  w: 'left-0 top-1/2 cursor-ew-resize',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN = 12; // smallest crop box on screen, in CSS pixels

/** The largest rectangle with `aspect` (w/h) centred in a W×H box, as fractions. */
export function centredRect(aspect: number | null, imageAspect: number, scale = 1): NormRect {
  if (!aspect) {
    const m = (1 - scale) / 2;
    return { x: m, y: m, width: scale, height: scale };
  }
  // In fractions, a box with real aspect A has width/height ratio A / imageAspect.
  const r = aspect / imageAspect;
  let w = scale;
  let h = w / r;
  if (h > scale) {
    h = scale;
    w = h * r;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h };
}

function resize(s: Px, mode: Handle, dx: number, dy: number, W: number, H: number, aspect: number | null): Px {
  const x2 = s.x + s.w;
  const y2 = s.y + s.h;
  let { x, y, w, h } = s;
  if (mode.includes('w')) {
    x = clamp(s.x + dx, 0, x2 - MIN);
    w = x2 - x;
  }
  if (mode.includes('e')) w = clamp(s.w + dx, MIN, W - s.x);
  if (mode.includes('n')) {
    y = clamp(s.y + dy, 0, y2 - MIN);
    h = y2 - y;
  }
  if (mode.includes('s')) h = clamp(s.h + dy, MIN, H - s.y);
  if (!aspect) return { x, y, w, h };

  const corner = mode.length === 2;
  if (corner) {
    // Width leads; then fit inside the room the anchored corner leaves.
    const roomW = mode.includes('w') ? x2 : W - s.x;
    const roomH = mode.includes('n') ? y2 : H - s.y;
    h = w / aspect;
    if (h > roomH) {
      h = roomH;
      w = h * aspect;
    }
    if (w > roomW) {
      w = roomW;
      h = w / aspect;
    }
    x = mode.includes('w') ? x2 - w : s.x;
    y = mode.includes('n') ? y2 - h : s.y;
    return { x, y, w, h };
  }
  if (mode === 'e' || mode === 'w') {
    const cy = s.y + s.h / 2;
    const maxH = 2 * Math.min(cy, H - cy);
    h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
      if (mode === 'w') x = x2 - w;
    }
    return { x, y: cy - h / 2, w, h };
  }
  const cx = s.x + s.w / 2;
  const maxW = 2 * Math.min(cx, W - cx);
  w = h * aspect;
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
    if (mode === 'n') y = y2 - h;
  }
  return { x: cx - w / 2, y, w, h };
}

function draw(x0: number, y0: number, x1: number, y1: number, W: number, H: number, aspect: number | null): Px {
  const px = clamp(x1, 0, W);
  const py = clamp(y1, 0, H);
  let w = Math.abs(px - x0);
  let h = Math.abs(py - y0);
  if (aspect) {
    const roomW = px >= x0 ? W - x0 : x0;
    const roomH = py >= y0 ? H - y0 : y0;
    h = w / aspect;
    if (h > roomH) {
      h = roomH;
      w = h * aspect;
    }
    w = Math.min(w, roomW);
    h = w / aspect;
  }
  return { x: px >= x0 ? x0 : x0 - w, y: py >= y0 ? y0 : y0 - h, w, h };
}

/**
 * Interactive crop: drag the box to move it, the handles to resize it, or
 * outside it to draw a new one. Arrow keys move the box; Shift+arrows resize.
 * With `aspect` (width / height in pixels) the box keeps that ratio.
 */
export function CropCanvas({
  src,
  width,
  height,
  rect,
  aspect,
  onChange,
  rotate = 0,
  flipHorizontal = false,
  flipVertical = false,
  className,
}: {
  src: string;
  /** Size of the image as displayed, after `rotate` (its aspect ratio is what matters). */
  width: number;
  height: number;
  rect: NormRect;
  aspect: number | null;
  onChange: (rect: NormRect) => void;
  /** Clockwise quarter turn applied to `src` for display, then the flips (the engine's order). */
  rotate?: 0 | 90 | 180 | 270;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; start: Px; x: number; y: number; W: number; H: number } | null>(null);
  const imageAspect = width / height;
  const quarter = rotate === 90 || rotate === 270;

  const toNorm = (p: Px, W: number, H: number): NormRect => ({ x: p.x / W, y: p.y / H, width: p.w / W, height: p.h / H });

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const target = e.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as Mode | undefined;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    drag.current = {
      mode: handle ?? 'new',
      start: { x: rect.x * r.width, y: rect.y * r.height, w: rect.width * r.width, h: rect.height * r.height },
      x,
      y,
      W: r.width,
      H: r.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const dx = x - d.x;
    const dy = y - d.y;
    let next: Px;
    if (d.mode === 'move') {
      next = { ...d.start, x: clamp(d.start.x + dx, 0, d.W - d.start.w), y: clamp(d.start.y + dy, 0, d.H - d.start.h) };
    } else if (d.mode === 'new') {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      next = draw(d.x, d.y, x, y, d.W, d.H, aspect);
      if (next.w < MIN || next.h < MIN) return;
    } else {
      next = resize(d.start, d.mode, dx, dy, d.W, d.H, aspect);
    }
    onChange(toNorm(next, d.W, d.H));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = 0.01;
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const k = keys[e.key];
    if (!k) return;
    e.preventDefault();
    const [dx, dy] = k;
    if (e.shiftKey) {
      // Resize from the bottom-right corner (keeping the ratio when locked).
      if (!aspect) {
        onChange({
          ...rect,
          width: clamp(rect.width + dx, 0.02, 1 - rect.x),
          height: clamp(rect.height + dy, 0.02, 1 - rect.y),
        });
        return;
      }
      const ratio = aspect / imageAspect; // width / height in fractions
      let w = clamp(rect.width + (dx || dy), 0.02, 1 - rect.x);
      let h = w / ratio;
      if (rect.y + h > 1) {
        h = 1 - rect.y;
        w = h * ratio;
      }
      onChange({ ...rect, width: w, height: h });
    } else {
      onChange({
        ...rect,
        x: clamp(rect.x + dx, 0, 1 - rect.width),
        y: clamp(rect.y + dy, 0, 1 - rect.height),
      });
    }
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border p-2', className)} style={CHECKERBOARD}>
      <div
        ref={box}
        className="relative mx-auto touch-none select-none"
        style={{
          aspectRatio: `${width} / ${height}`,
          width: '100%',
          maxWidth: `calc(min(62vh, 600px) * ${imageAspect})`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
          style={{
            // Sized as the unrotated image, then turned and flipped about the centre.
            width: `${(quarter ? height / width : 1) * 100}%`,
            height: `${(quarter ? width / height : 1) * 100}%`,
            transform: `translate(-50%, -50%) scale(${flipHorizontal ? -1 : 1}, ${flipVertical ? -1 : 1}) rotate(${rotate}deg)`,
          }}
        />
        <div
          data-handle="move"
          role="group"
          tabIndex={0}
          aria-label="Crop area. Arrow keys move it; Shift and the arrow keys resize it."
          onKeyDown={onKeyDown}
          className="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
          }}
        >
          <div className="pointer-events-none absolute inset-0 border border-white/90" />
          {/* Rule-of-thirds guides */}
          <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/35" />
          <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/35" />
          <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/35" />
          <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/35" />
          {HANDLES.map((h) => (
            <span
              key={h}
              data-handle={h}
              className={cn(
                'absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-black/40 bg-white shadow',
                HANDLE_POS[h],
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
