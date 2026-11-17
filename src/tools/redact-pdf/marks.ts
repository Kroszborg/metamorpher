import type { Matrix, QuadPoints } from '@/engines/mupdf';

/** A redaction area in PDF user space (bottom-left origin), normalised so x0 < x1 and y0 < y1. */
export type Mark = {
  id: string;
  page: number;
  box: [number, number, number, number];
  /** Search term that produced it, or null for a drawn box. */
  term: string | null;
};

let next = 1;
export const markId = () => `m${next++}`;

export function invert([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c || 1;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] {
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Bounding box of points. */
export function boundsOf(points: readonly (readonly [number, number])[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A search-hit quad (MuPDF page space) as a user-space box, through the inverse page transform. */
export function quadToUserBox(quad: QuadPoints, pageToUser: Matrix): [number, number, number, number] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i += 2) pts.push(apply(pageToUser, quad[i] ?? 0, quad[i + 1] ?? 0));
  return boundsOf(pts);
}
