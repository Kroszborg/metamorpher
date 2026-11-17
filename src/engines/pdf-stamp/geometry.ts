/**
 * Page geometry shared by the stamping worker and the on-screen stage. Pure
 * math, no DOM: safe to import from workers and server-rendered modules.
 *
 * Coordinate systems:
 * - user space: the PDF's own coordinates (points, y up), where content is drawn.
 * - reader frame: the visible page as a reader sees it after /Rotate, in points,
 *   origin at the bottom-left of the visible (crop) box, y up. Size `width` × `height`.
 * - view: CSS pixels on screen, origin top-left of the displayed page, y down.
 */

export type Box = { x: number; y: number; width: number; height: number };
export type PageRotation = 0 | 90 | 180 | 270;
/** A PDF transformation matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function normalizeRotation(deg: number): PageRotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as PageRotation;
}

/** A box with positive width and height, whatever order the corners came in. */
export function normalizeBox(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function intersectBoxes(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  // Broken files can have a crop box outside the media box; fall back to the media box.
  if (x2 <= x || y2 <= y) return b;
  return { x, y, width: x2 - x, height: y2 - y };
}

/** Applies `first`, then `then`. */
export function concat(first: Matrix, then: Matrix): Matrix {
  const [a, b, c, d, e, f] = first;
  const [A, B, C, D, E, F] = then;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertMatrix(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

/** Counter-clockwise rotation (PDF convention, y up). */
export function rotationCcw(deg: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const cos = Math.round(Math.cos(r) * 1e12) / 1e12;
  const sin = Math.round(Math.sin(r) * 1e12) / 1e12;
  return [cos, sin, -sin, cos, 0, 0];
}

/** Axis-aligned bounds of a box after a transform. */
export function transformBox(m: Matrix, box: Box): Box {
  const pts = [
    applyMatrix(m, box.x, box.y),
    applyMatrix(m, box.x + box.width, box.y),
    applyMatrix(m, box.x, box.y + box.height),
    applyMatrix(m, box.x + box.width, box.y + box.height),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return normalizeBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/** The visible page as the reader sees it. */
export type PageFrame = {
  /** Visible box (crop box ∩ media box) in user space. */
  box: Box;
  rotation: PageRotation;
  /** Reader-frame size in points (swapped for 90° and 270° pages). */
  width: number;
  height: number;
  /** Reader frame → user space. Concatenate it (cm) to draw in reader coordinates. */
  matrix: Matrix;
};

export function pageFrame(box: Box, rotation: number): PageFrame {
  const r = normalizeRotation(rotation);
  const { x, y, width: w, height: h } = box;
  const matrix: Matrix =
    r === 0
      ? [1, 0, 0, 1, x, y]
      : r === 90
        ? [0, 1, -1, 0, x + w, y]
        : r === 180
          ? [-1, 0, 0, -1, x + w, y + h]
          : [0, -1, 1, 0, x, y + h];
  const sideways = r === 90 || r === 270;
  return { box, rotation: r, width: sideways ? h : w, height: sideways ? w : h, matrix };
}

/**
 * Something placed on a page: centre in user space, size in points as the
 * reader sees it (upright), and a clockwise rotation as the reader sees it.
 */
export type Placement = {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
};

/**
 * Local box → user space for a placement. The local box spans [0, width] ×
 * [0, height] with y up; content drawn there (after `cm` with this matrix)
 * appears upright to the reader, rotated by `placement.rotation`, whatever the
 * page's /Rotate.
 */
export function placementMatrix(p: Placement, pageRotation: number): Matrix {
  const local = concat(translation(-p.width / 2, -p.height / 2), rotationCcw(-p.rotation));
  const toUser = concat(local, rotationCcw(normalizeRotation(pageRotation)));
  return concat(toUser, translation(p.cx, p.cy));
}

/** Reader frame (points, y up) → view pixels (y down) at `scale` CSS px per point. */
export function frameToView(frame: PageFrame, scale: number): Matrix {
  return [scale, 0, 0, -scale, 0, frame.height * scale];
}

/** User space → view pixels. */
export function userToView(frame: PageFrame, scale: number): Matrix {
  return concat(invertMatrix(frame.matrix), frameToView(frame, scale));
}

/** View pixels → user space. */
export function viewToUser(frame: PageFrame, scale: number): Matrix {
  return invertMatrix(userToView(frame, scale));
}
