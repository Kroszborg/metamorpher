// Document scanning maths, no imports: find the page in a photo, flatten it
// with a perspective transform, clean it up. Plain arrays, so it runs in a
// worker and under node tests.

export type Point = [number, number];
/** Corners in image pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
export type Filter = 'original' | 'enhance' | 'gray' | 'bw';

export type Rgba = { data: Uint8ClampedArray; width: number; height: number };

// ── Detection ────────────────────────────────────────────────────────────

function luminance(img: Rgba): Float32Array {
  const out = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0; i < out.length; i += 1) out[i] = 0.299 * (d[i * 4] ?? 0) + 0.587 * (d[i * 4 + 1] ?? 0) + 0.114 * (d[i * 4 + 2] ?? 0);
  return out;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y += 1) {
    let acc = 0;
    for (let x = -r; x <= r; x += 1) acc += src[y * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
    for (let x = 0; x < w; x += 1) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += (src[y * w + Math.min(w - 1, x + r + 1)] ?? 0) - (src[y * w + Math.max(0, x - r)] ?? 0);
    }
  }
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let y = -r; y <= r; y += 1) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x] ?? 0;
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += (tmp[Math.min(h - 1, y + r + 1) * w + x] ?? 0) - (tmp[Math.max(0, y - r) * w + x] ?? 0);
    }
  }
  return out;
}

function otsu(values: Float32Array): number {
  const hist = new Float64Array(256);
  for (const v of values) {
    const b = Math.max(0, Math.min(255, v | 0));
    hist[b] = (hist[b] ?? 0) + 1;
  }
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * (hist[i] ?? 0);
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t] ?? 0;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Convex hull (monotone chain). */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const pt = p[i] as Point;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i += 1) {
    const [x0, y0] = q[i] as Point;
    const [x1, y1] = q[(i + 1) % 4] as Point;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/** Orders four points as top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(pts: Point[]): Quad {
  const by = (f: (p: Point) => number, max: boolean) => pts.reduce((best, p) => ((max ? f(p) > f(best) : f(p) < f(best)) ? p : best));
  return [by((p) => p[0] + p[1], false), by((p) => p[0] - p[1], true), by((p) => p[0] + p[1], true), by((p) => p[0] - p[1], false)];
}

/** The largest-area quadrilateral with corners on the hull (starts from the extreme points, then improves one corner at a time). */
function bestQuad(h: Point[]): Quad {
  let q = orderQuad(h);
  let area = quadArea(q);
  for (let round = 0; round < 6; round += 1) {
    let improved = false;
    for (let c = 0; c < 4; c += 1) {
      for (const p of h) {
        const trial = [...q] as Quad;
        trial[c] = p;
        const a = quadArea(orderQuad(trial));
        if (a > area + 1e-6) {
          area = a;
          q = orderQuad(trial);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return q;
}

export type Detection = { quad: Quad; found: boolean; method?: 'edges' | 'brightness'; score?: number };

// ── Edges: page borders as straight lines ─────────────────────────────────
// A page is found by its four borders, whatever its brightness: colour and
// brightness gradients (Sobel on a blurred copy), straight lines through the
// strongest gradients (Hough transform), and the quadrilateral of two
// near-horizontal and two near-vertical lines whose sides are best covered by
// edges. Works for dark pages on light tables and pages close in brightness
// to their background, as long as the border shows as an edge.

type EdgeMap = { w: number; h: number; edge: Uint8Array; gx: Float32Array; gy: Float32Array };

/** `blur`: blur radius as a fraction of the short side; `pct`/`floor`: edge threshold (percentile of gradient strength, minimum). */
export function edgeMap(img: Rgba, side: number, blurFrac = 1 / 120, pct = 0.88, floor = 6): { map: EdgeMap; scale: number } {
  const k = Math.min(1, side / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * k));
  const h = Math.max(8, Math.round(img.height * k));
  // Three channels: luminance and two colour differences, area-sampled.
  const ch = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = Math.floor(x * sx);
      const y0 = Math.floor(y * sy);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let yy = y0; yy < y1; yy += Math.max(1, ((y1 - y0) / 3) | 0)) {
        for (let xx = x0; xx < x1; xx += Math.max(1, ((x1 - x0) / 3) | 0)) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i] ?? 0;
          g += img.data[i + 1] ?? 0;
          b += img.data[i + 2] ?? 0;
          n += 1;
        }
      }
      r /= n;
      g /= n;
      b /= n;
      const i = y * w + x;
      (ch[0] as Float32Array)[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      (ch[1] as Float32Array)[i] = (r - g) * 0.7;
      (ch[2] as Float32Array)[i] = (b - (r + g) / 2) * 0.7;
    }
  }
  const radius = Math.max(1, Math.round(Math.min(w, h) * blurFrac));
  const blur = ch.map((c) => boxBlur(c, w, h, radius));
  // Differences across the blur width: a step keeps its full height (4 × the step) however wide the blur.
  const sp = radius;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = sp; y < h - sp; y++) {
    for (let x = sp; x < w - sp; x++) {
      let bx = 0;
      let by = 0;
      let best = -1;
      for (const c of blur) {
        const at = (dx: number, dy: number) => c[(y + dy) * w + x + dx] ?? 0;
        const vx = at(sp, -sp) + 2 * at(sp, 0) + at(sp, sp) - at(-sp, -sp) - 2 * at(-sp, 0) - at(-sp, sp);
        const vy = at(-sp, sp) + 2 * at(0, sp) + at(sp, sp) - at(-sp, -sp) - 2 * at(0, -sp) - at(sp, -sp);
        const m2 = vx * vx + vy * vy;
        if (m2 > best) {
          best = m2;
          bx = vx;
          by = vy;
        }
      }
      const i = y * w + x;
      gx[i] = bx;
      gy[i] = by;
      mag[i] = Math.sqrt(best);
    }
  }
  // Edge pixels: the strongest gradients (a threshold between the 88th percentile and Otsu-like split), thinned along the gradient.
  const sorted = Float32Array.from(mag).sort();
  const t = Math.max(sorted[Math.floor(sorted.length * pct)] ?? 0, floor);
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i] as number;
      if (m < t) continue;
      const ax = Math.abs(gx[i] as number);
      const ay = Math.abs(gy[i] as number);
      const step = ax > ay ? 1 : w;
      if (m >= (mag[i - step] ?? 0) && m >= (mag[i + step] ?? 0)) edge[i] = 1;
    }
  }
  return { map: { w, h, edge, gx, gy }, scale: k };
}

type Line = { theta: number; rho: number; votes: number };

export function houghLines(map: EdgeMap, count: number): Line[] {
  const { w, h, edge } = map;
  const diag = Math.ceil(Math.hypot(w, h));
  const steps = 180;
  const cos = new Float32Array(steps);
  const sin = new Float32Array(steps);
  for (let t = 0; t < steps; t++) {
    cos[t] = Math.cos((t * Math.PI) / steps);
    sin[t] = Math.sin((t * Math.PI) / steps);
  }
  const acc = new Int32Array(steps * (2 * diag + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edge[y * w + x]) continue;
      for (let t = 0; t < steps; t++) {
        const r = Math.round(x * (cos[t] as number) + y * (sin[t] as number)) + diag;
        acc[t * (2 * diag + 1) + r] = (acc[t * (2 * diag + 1) + r] as number) + 1;
      }
    }
  }
  const lines: Line[] = [];
  const minVotes = Math.min(w, h) * 0.15;
  for (let k = 0; k < count * 4 && lines.length < count; k++) {
    let best = -1;
    let at = -1;
    for (let i = 0; i < acc.length; i++) {
      if ((acc[i] as number) > best) {
        best = acc[i] as number;
        at = i;
      }
    }
    if (best < minVotes) break;
    const t = Math.floor(at / (2 * diag + 1));
    const r = (at % (2 * diag + 1)) - diag;
    lines.push({ theta: (t * Math.PI) / steps, rho: r, votes: best });
    // Suppress the neighbourhood (near-duplicate lines).
    for (let dt = -8; dt <= 8; dt++) {
      const tt = (t + dt + steps) % steps;
      const flip = t + dt < 0 || t + dt >= steps;
      for (let dr = -Math.ceil(diag * 0.03); dr <= Math.ceil(diag * 0.03); dr++) {
        const rr = (flip ? -r : r) + dr + diag;
        if (rr >= 0 && rr <= 2 * diag) acc[tt * (2 * diag + 1) + rr] = 0;
      }
    }
  }
  return lines;
}

function intersect(a: Line, b: Line): Point | null {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta);
  if (Math.abs(det) < 1e-6) return null;
  const x = (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det;
  const y = (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det;
  return [x, y];
}

/** Share of points along each side that sit on an edge whose gradient crosses the side; the weakest side counts. */
export function sideSupport(map: EdgeMap, q: Quad): number {
  const { w, h, edge, gx, gy } = map;
  let worst = 1;
  for (let s = 0; s < 4; s++) {
    const [x0, y0] = q[s] as Point;
    const [x1, y1] = q[(s + 1) % 4] as Point;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 4) return 0;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const n = Math.max(12, Math.round(len / 3));
    let hit = 0;
    let inside = 0;
    for (let k = 1; k < n; k++) {
      const px = x0 + ((x1 - x0) * k) / n;
      const py = y0 + ((y1 - y0) * k) / n;
      if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
      inside += 1;
      for (let d = -3; d <= 3; d++) {
        const x = Math.round(px + nx * d);
        const y = Math.round(py + ny * d);
        const i = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h || !edge[i]) continue;
        const g = Math.hypot(gx[i] as number, gy[i] as number) || 1;
        if (Math.abs(((gx[i] as number) * nx + (gy[i] as number) * ny) / g) > 0.7) {
          hit += 1;
          break;
        }
      }
    }
    // A side outside the picture (the page runs off the frame) cannot be checked: count it as half.
    const share = inside >= n * 0.3 ? hit / inside : 0.5;
    worst = Math.min(worst, share);
  }
  return worst;
}

function convex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i] as Point;
    const [bx, by] = q[(i + 1) % 4] as Point;
    const [cx, cy] = q[(i + 2) % 4] as Point;
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (z === 0) return false;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** The page as the quadrilateral of border lines best covered by edges, in image pixels (null when none is convincing). */
/** Two scales: fine (sharp borders, busy backgrounds) and coarse (text blurred into the page, faint borders). */
const EDGE_SCALES: [number, number, number][] = [
  [1 / 120, 0.88, 6],
  [1 / 45, 0.6, 16],
];

export function detectByEdges(img: Rgba): { quad: Quad; score: number } | null {
  let best: { quad: Quad; score: number } | null = null;
  for (const [blurFrac, pct, floor] of EDGE_SCALES) {
    const found = edgesAtScale(img, blurFrac, pct, floor);
    if (found && (!best || found.score > best.score)) best = found;
  }
  return best;
}

function edgesAtScale(img: Rgba, blurFrac: number, pct: number, floor: number): { quad: Quad; score: number } | null {
  const { map, scale } = edgeMap(img, 420, blurFrac, pct, floor);
  const lines = houghLines(map, 14);
  const horiz = lines.filter((l) => Math.abs(l.theta - Math.PI / 2) < (40 * Math.PI) / 180);
  const vert = lines.filter((l) => l.theta < (40 * Math.PI) / 180 || l.theta > (140 * Math.PI) / 180);
  const area = map.w * map.h;
  let best: { quad: Quad; score: number } | null = null;
  let largest: { quad: Quad; score: number; area: number } | null = null;
  for (let a = 0; a < horiz.length; a++) {
    for (let b = a + 1; b < horiz.length; b++) {
      for (let c = 0; c < vert.length; c++) {
        for (let d = c + 1; d < vert.length; d++) {
          const pts = [
            intersect(horiz[a] as Line, vert[c] as Line),
            intersect(horiz[a] as Line, vert[d] as Line),
            intersect(horiz[b] as Line, vert[c] as Line),
            intersect(horiz[b] as Line, vert[d] as Line),
          ];
          if (pts.some((p) => !p)) continue;
          const q = orderQuad(pts as Point[]);
          if (!convex(q)) continue;
          // Corners may run a little off the picture, not far.
          if (q.some(([x, y]) => x < -map.w * 0.08 || y < -map.h * 0.08 || x > map.w * 1.08 || y > map.h * 1.08)) continue;
          const qa = quadArea(q);
          if (qa < area * 0.12 || qa > area * 1.02) continue;
          const support = sideSupport(map, q);
          const score = support * (0.85 + 0.15 * Math.sqrt(qa / area));
          if (!best || score > best.score) best = { quad: q, score };
          // Of the well-supported outlines, the largest: the page rather than its block of text or a picture on it.
          if (support >= 0.72 && (!largest || qa > largest.area)) largest = { quad: q, score, area: qa };
        }
      }
    }
  }
  if (largest) best = { quad: largest.quad, score: largest.score };
  if (!best || best.score < 0.45) return null;
  const quad = best.quad.map(([x, y]) => [Math.min(img.width, Math.max(0, x / scale)), Math.min(img.height, Math.max(0, y / scale))] as Point) as Quad;
  return { quad, score: best.score };
}

/**
 * Finds the page in a photo. Two methods: its four border lines (gradients
 * and a Hough transform; any brightness), and the largest bright region
 * (Otsu threshold, hull, largest quadrilateral). The edges win when their
 * borders are well supported; `found` is false when nothing page-like was
 * seen (the quad is then the whole image).
 */
export function detectPage(img: Rgba): Detection {
  const bright = detectBright(img);
  let edges: { quad: Quad; score: number } | null = null;
  try {
    edges = detectByEdges(img);
  } catch {
    edges = null;
  }
  if (edges) {
    // The bright region agrees with the edges, or the edges are clearly better supported.
    const brightScore = bright.found
      ? Math.max(
          ...EDGE_SCALES.map(([b, p, f]) => {
            const { map } = edgeMap(img, 420, b, p, f);
            const k = map.w / img.width;
            return sideSupport(map, bright.quad.map(([x, y]) => [x * k, y * k] as Point) as Quad) * (0.85 + 0.15 * Math.sqrt(quadArea(bright.quad) / (img.width * img.height)));
          }),
        )
      : 0;
    if (!bright.found || edges.score >= brightScore - 0.05) {
      const cx = edges.quad.reduce((n, p) => n + p[0], 0) / 4;
      const cy = edges.quad.reduce((n, p) => n + p[1], 0) / 4;
      const inset = edges.quad.map(([x, y]) => [x + (cx - x) * 0.008, y + (cy - y) * 0.008] as Point) as Quad;
      return { quad: inset, found: quadArea(edges.quad) < img.width * img.height * 0.985, method: 'edges', score: edges.score };
    }
  }
  return { ...bright, method: 'brightness' };
}

export function detectBright(img: Rgba): Detection {
  const { width: w, height: h } = img;
  const whole: Quad = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  if (w < 16 || h < 16) return { quad: whole, found: false };
  const blurred = boxBlur(luminance(img), w, h, Math.max(1, Math.round(Math.min(w, h) / 150)));
  const t = otsu(blurred);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i += 1) mask[i] = (blurred[i] ?? 0) > t ? 1 : 0;
  // Largest bright 4-connected component.
  const label = new Int32Array(w * h).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  const stack = new Int32Array(w * h);
  let n = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = n;
    let size = 0;
    while (top > 0) {
      const i = stack[--top] ?? 0;
      size += 1;
      const x = i % w;
      const y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && mask[j] && label[j] === -1) {
          label[j] = n;
          stack[top++] = j;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = n;
    }
    n += 1;
  }
  if (bestLabel < 0 || bestSize < w * h * 0.15) return { quad: whole, found: false };
  // Boundary points of the component (leftmost and rightmost per row are enough for the hull).
  const pts: Point[] = [];
  for (let y = 0; y < h; y += 1) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < w; x += 1) {
      if (label[y * w + x] === bestLabel) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 >= 0) pts.push([x0, y], [x1 + 1, y]);
  }
  const quad = bestQuad(hull(pts));
  const area = quadArea(quad);
  // A page covering almost the whole frame with no background: keep the frame.
  if (area < w * h * 0.15) return { quad: whole, found: false };
  // Pull the corners 0.6% towards the centre so no background sliver is left at the edges.
  const cx = quad.reduce((n, p) => n + p[0], 0) / 4;
  const cy = quad.reduce((n, p) => n + p[1], 0) / 4;
  const inset = quad.map(([x, y]) => [x + (cx - x) * 0.012, y + (cy - y) * 0.012] as Point) as Quad;
  return { quad: inset, found: area < w * h * 0.985 };
}

// ── Perspective ──────────────────────────────────────────────────────────

/** Homography mapping the unit square corners (0,0),(1,0),(1,1),(0,1) to `q`. */
function squareToQuad(q: Quad): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (sx * dy2 - dx2 * sy) / den;
  const hh = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Output size for a quad: the longer of each pair of opposite edges, capped at `maxSide`. */
export function flatSize(q: Quad, maxSide: number): { width: number; height: number } {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  return { width: w, height: h };
}

/** Flattens the quad `q` of `src` into a `width × height` image (bilinear sampling). */
export function warp(src: Rgba, q: Quad, width: number, height: number): Rgba {
  const H = squareToQuad(q);
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const d = src.data;
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const z = (H[6] ?? 0) * u + (H[7] ?? 0) * v + 1;
      const fx = ((H[0] ?? 0) * u + (H[1] ?? 0) * v + (H[2] ?? 0)) / z - 0.5;
      const fy = ((H[3] ?? 0) * u + (H[4] ?? 0) * v + (H[5] ?? 0)) / z - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const ax = Math.max(0, Math.min(1, fx - x0));
      const ay = Math.max(0, Math.min(1, fy - y0));
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const p00 = d[(y0 * sw + x0) * 4 + c] ?? 0;
        const p10 = d[(y0 * sw + x1) * 4 + c] ?? 0;
        const p01 = d[(y1 * sw + x0) * 4 + c] ?? 0;
        const p11 = d[(y1 * sw + x1) * 4 + c] ?? 0;
        out[o + c] = (p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

// ── Filters ──────────────────────────────────────────────────────────────

/**
 * The paper's brightness under every pixel: the brightest values of coarse
 * blocks (text is dark, so it drops out), spread to neighbouring blocks,
 * smoothed and interpolated back to full size.
 */
function paperLevel(lum: Float32Array, w: number, h: number): Float32Array {
  const B = Math.max(8, Math.round(Math.min(w, h) / 40));
  const gw = Math.ceil(w / B);
  const gh = Math.ceil(h / B);
  const soft = boxBlur(lum, w, h, 1);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let m = 0;
      for (let y = gy * B; y < Math.min(h, (gy + 1) * B); y += 1) {
        for (let x = gx * B; x < Math.min(w, (gx + 1) * B); x += 1) m = Math.max(m, soft[y * w + x] ?? 0);
      }
      grid[gy * gw + gx] = m;
    }
  }
  // Blocks covered by ink or pictures take their brightest neighbour, then a gentle smoothing.
  const dil = new Float32Array(grid.length);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) m = Math.max(m, grid[Math.min(gh - 1, Math.max(0, gy + dy)) * gw + Math.min(gw - 1, Math.max(0, gx + dx))] ?? 0);
      dil[gy * gw + gx] = m;
    }
  }
  const smooth = boxBlur(dil, gw, gh, 1);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / B - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x += 1) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / B - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const top = (smooth[y0 * gw + x0] ?? 0) * (1 - tx) + (smooth[y0 * gw + x1] ?? 0) * tx;
      const bot = (smooth[y1 * gw + x0] ?? 0) * (1 - tx) + (smooth[y1 * gw + x1] ?? 0) * tx;
      out[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

/**
 * Cleans the flattened page in place. Every look first divides out the
 * paper's uneven lighting (shadows, gradients), so the paper turns white:
 * 'enhance' keeps colour, 'gray' is greyscale with firmer ink, 'bw' is a
 * threshold of that evened-out page (crisp black text, Otsu-chosen level).
 */
export function applyFilter(img: Rgba, filter: Filter): void {
  if (filter === 'original') return;
  const { width: w, height: h, data: d } = img;
  const lum = luminance(img);
  const paper = paperLevel(lum, w, h);
  const norm = new Float32Array(lum.length);
  for (let i = 0; i < lum.length; i += 1) norm[i] = Math.min(255, ((lum[i] ?? 0) * 255) / Math.max(30, (paper[i] ?? 255) * 0.96));
  if (filter === 'bw') {
    const t = Math.min(200, Math.max(110, otsu(norm)));
    for (let i = 0; i < norm.length; i += 1) {
      const v = (norm[i] ?? 255) < t ? 0 : 255;
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
    }
    return;
  }
  for (let i = 0; i < lum.length; i += 1) {
    const gain = 255 / Math.max(30, (paper[i] ?? 255) * 0.96);
    if (filter === 'gray') {
      // A gentle curve: paper stays white, ink gets darker.
      const v = norm[i] ?? 255;
      const s = 255 * (v / 255) ** 1.6;
      d[i * 4] = s;
      d[i * 4 + 1] = s;
      d[i * 4 + 2] = s;
    } else {
      for (let c = 0; c < 3; c += 1) {
        const v = Math.min(255, (d[i * 4 + c] ?? 0) * gain);
        d[i * 4 + c] = 255 * (v / 255) ** 1.25;
      }
    }
  }
}

/** Rotates an image by a multiple of 90° clockwise. */
export function rotate(img: Rgba, quarter: 0 | 1 | 2 | 3): Rgba {
  if (quarter === 0) return img;
  const { width: w, height: h, data: d } = img;
  const W = quarter === 2 ? w : h;
  const H = quarter === 2 ? h : w;
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [nx, ny] = quarter === 1 ? [h - 1 - y, x] : quarter === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const s = (y * w + x) * 4;
      const t = (ny * W + nx) * 4;
      out[t] = d[s] ?? 0;
      out[t + 1] = d[s + 1] ?? 0;
      out[t + 2] = d[s + 2] ?? 0;
      out[t + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}
