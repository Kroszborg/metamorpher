/** Whiteboard elements, geometry helpers, SVG output and the IndexedDB autosave. */
import { getStroke } from 'perfect-freehand';

export type Tool = 'select' | 'pan' | 'pen' | 'highlighter' | 'eraser' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'note';

type Base = { id: string; color: string; width: number };
export type Stroke = Base & { type: 'stroke' | 'highlight'; points: [number, number, number][] };
export type Box = Base & { type: 'rect' | 'ellipse' | 'text' | 'note' | 'image'; x: number; y: number; w: number; h: number; text?: string; fill?: string; src?: string };
export type Segment = Base & { type: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number };
export type El = Stroke | Box | Segment;
export type View = { x: number; y: number; zoom: number };
export type Board = { elements: El[]; view: View; background?: string };

/** The two neutral inks. They swap when the board flips between dark and light, so old strokes stay visible. */
export const INK_DARK = '#1c1c1c';
export const INK_LIGHT = '#f5f5f5';
export const BOARD_DARK = '#0b0b0c';
export const BOARD_LIGHT = '#ffffff';

/** True when a #rrggbb colour is dark enough to need light ink on top of it. */
export function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 128;
}

/** Elements with the neutral ink that would vanish on `background` swapped for the other one. Notes keep their own ink. */
export function reinkFor(els: El[], background: string): El[] {
  const from = isDark(background) ? INK_DARK : INK_LIGHT;
  const to = isDark(background) ? INK_LIGHT : INK_DARK;
  return els.some((e) => e.type !== 'note' && e.color === from) ? els.map((e) => (e.type !== 'note' && e.color === from ? { ...e, color: to } : e)) : els;
}

export const NOTE_COLORS = ['#fff3a3', '#ffd6e0', '#cdeefd', '#d7f5c9'] as const;

export function isStroke(e: El): e is Stroke {
  return e.type === 'stroke' || e.type === 'highlight';
}

export function isSeg(e: El): e is Segment {
  return e.type === 'line' || e.type === 'arrow';
}

let counter = 0;
export function uid(): string {
  counter += 1;
  return `w${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Outline of a pressure-sensitive stroke as an SVG path. */
export function strokePath(s: Stroke): string {
  const outline = getStroke(s.points, {
    size: s.type === 'highlight' ? s.width * 3.2 : s.width,
    thinning: s.type === 'highlight' ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: s.points.every((p) => p[2] === 0.5),
    last: true,
  });
  if (!outline.length) return '';
  const d = outline.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length] as [number, number];
      acc.push(x0 as number, y0 as number, ((x0 as number) + x1) / 2, ((y0 as number) + y1) / 2);
      return acc;
    },
    ['M', ...(outline[0] as [number, number]), 'Q'],
  );
  return `${d.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(' ')} Z`;
}

export function bounds(e: El): { x: number; y: number; w: number; h: number } {
  if (isStroke(e)) {
    const xs = e.points.map((p) => p[0]);
    const ys = e.points.map((p) => p[1]);
    const pad = (e.type === 'highlight' ? e.width * 1.6 : e.width / 2) + 1;
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  }
  if (isSeg(e)) {
    const x = Math.min(e.x1, e.x2);
    const y = Math.min(e.y1, e.y2);
    return { x: x - 4, y: y - 4, w: Math.abs(e.x2 - e.x1) + 8, h: Math.abs(e.y2 - e.y1) + 8 };
  }
  return { x: Math.min(e.x, e.x + e.w), y: Math.min(e.y, e.y + e.h), w: Math.abs(e.w), h: Math.abs(e.h) };
}

export function unionBounds(els: El[]): { x: number; y: number; w: number; h: number } | null {
  if (!els.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const e of els) {
    const b = bounds(e);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Whether a world point touches an element (within `tol` world units). */
export function hit(e: El, x: number, y: number, tol: number): boolean {
  if (isStroke(e)) {
    const r = (e.type === 'highlight' ? e.width * 1.6 : e.width / 2) + tol;
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1] as [number, number, number];
      const b = e.points[i] as [number, number, number];
      if (distToSegment(x, y, a[0], a[1], b[0], b[1]) <= r) return true;
    }
    return e.points.length === 1 && Math.hypot(x - (e.points[0]?.[0] ?? 0), y - (e.points[0]?.[1] ?? 0)) <= r;
  }
  if (isSeg(e)) return distToSegment(x, y, e.x1, e.y1, e.x2, e.y2) <= e.width / 2 + tol;
  const b = bounds(e);
  if (e.type === 'rect' && !e.fill) {
    const inside = x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    const deep = x > b.x + tol && x < b.x + b.w - tol && y > b.y + tol && y < b.y + b.h - tol;
    return inside && !deep;
  }
  if (e.type === 'ellipse' && !e.fill) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const d = Math.hypot((x - cx) / (b.w / 2 || 1), (y - cy) / (b.h / 2 || 1));
    return Math.abs(d - 1) * Math.min(b.w, b.h) / 2 <= tol + e.width;
  }
  return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
}

/** Moves an element by (dx, dy). */
export function moved(e: El, dx: number, dy: number): El {
  if (isStroke(e)) return { ...e, points: e.points.map(([x, y, p]) => [x + dx, y + dy, p]) };
  if (isSeg(e)) return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
  return { ...e, x: e.x + dx, y: e.y + dy };
}

/** Scales an element from bounding box `from` into box `to`. */
export function resized(e: El, from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number; w: number; h: number }): El {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const mx = (v: number) => to.x + (v - from.x) * sx;
  const my = (v: number) => to.y + (v - from.y) * sy;
  if (isStroke(e)) return { ...e, points: e.points.map(([x, y, p]) => [mx(x), my(y), p]) };
  if (isSeg(e)) return { ...e, x1: mx(e.x1), y1: my(e.y1), x2: mx(e.x2), y2: my(e.y2) };
  return { ...e, x: mx(e.x), y: my(e.y), w: e.w * sx, h: e.h * sy };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

export const FONT = '"mm-hand-caveat", "Segoe Print", "Comic Sans MS", cursive';

/** SVG markup of one element (used by the canvas and the exports alike). */
export function elementSvg(e: El): string {
  switch (e.type) {
    case 'stroke':
      return `<path d="${strokePath(e)}" fill="${e.color}"/>`;
    case 'highlight':
      return `<path d="${strokePath(e)}" fill="${e.color}" fill-opacity="0.35"/>`;
    case 'rect':
      return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="6" fill="${e.fill ?? 'none'}" stroke="${e.color}" stroke-width="${e.width}"/>`;
    case 'ellipse':
      return `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${Math.abs(e.w / 2)}" ry="${Math.abs(e.h / 2)}" fill="${e.fill ?? 'none'}" stroke="${e.color}" stroke-width="${e.width}"/>`;
    case 'line':
      return `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.color}" stroke-width="${e.width}" stroke-linecap="round"/>`;
    case 'arrow': {
      const a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
      const l = 10 + e.width * 3;
      const p = (k: number) => `${e.x2 - l * Math.cos(a + k)},${e.y2 - l * Math.sin(a + k)}`;
      return `<g stroke="${e.color}" stroke-width="${e.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"/><polyline points="${p(0.45)} ${e.x2},${e.y2} ${p(-0.45)}"/></g>`;
    }
    case 'text':
    case 'note': {
      const size = e.type === 'note' ? 20 : Math.max(12, e.width * 6);
      const lines = (e.text ?? '').split('\n');
      const pad = e.type === 'note' ? 12 : 0;
      const bg = e.type === 'note' ? `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="4" fill="${e.fill ?? NOTE_COLORS[0]}" filter="url(#mm-note-shadow)"/>` : '';
      const tspans = lines.map((l, i) => `<tspan x="${e.x + pad}" dy="${i === 0 ? size : size * 1.2}">${esc(l) || ' '}</tspan>`).join('');
      return `${bg}<text x="${e.x + pad}" y="${e.y + pad}" font-family='${FONT}' font-size="${size}" fill="${e.color}">${tspans}</text>`;
    }
    case 'image':
      return `<image href="${e.src}" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" preserveAspectRatio="none"/>`;
  }
}

export const DEFS = `<defs><filter id="mm-note-shadow" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.18"/></filter></defs>`;

/** A standalone SVG of every element, cropped to the drawing plus a margin. */
export function boardSvg(els: El[], background = '#ffffff', pad = 32): { svg: string; w: number; h: number } | null {
  const b = unionBounds(els);
  if (!b) return null;
  const x = b.x - pad;
  const y = b.y - pad;
  const w = Math.ceil(b.w + 2 * pad);
  const h = Math.ceil(b.h + 2 * pad);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">${DEFS}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${background}"/>${els.map(elementSvg).join('')}</svg>`;
  return { svg, w, h };
}

// ── IndexedDB autosave ──────────────────────────────────────────────────────

const DB = 'metamorpher-whiteboard';
const STORE = 'boards';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadBoard(): Promise<Board | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get('default');
      r.onsuccess = () => resolve((r.result as Board | undefined) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveBoard(b: Board): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(b, 'default');
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
    });
  } catch {
    // Private mode or blocked storage: the board lasts until the tab closes.
  }
}

export async function clearBoard(): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).delete('default');
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
