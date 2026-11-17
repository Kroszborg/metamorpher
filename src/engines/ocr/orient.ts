/**
 * Page orientation and skew for OCR, on the grey PGM images the OCR worker
 * renders. Pure functions (no DOM): projection profiles of the dark pixels
 * tell horizontal from vertical text lines and measure the skew; images are
 * turned in quarter turns exactly, and by small angles with bilinear
 * sampling. Recognition boxes are mapped back to the unturned image.
 */
import type { OcrBox, OcrResult } from './types';

export type Gray = { width: number; height: number; data: Uint8Array };

export function parsePgm(bytes: Uint8Array): Gray {
  const head = new TextDecoder().decode(bytes.subarray(0, 40));
  const m = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(head);
  if (!m) throw new Error('Not a PGM image.');
  const width = Number(m[1]);
  const height = Number(m[2]);
  return { width, height, data: bytes.subarray(m[0].length, m[0].length + width * height) };
}

export function toPgm(g: Gray): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(`P5\n${g.width} ${g.height}\n255\n`);
  const out = new Uint8Array(header.length + g.width * g.height);
  out.set(header, 0);
  out.set(g.data.subarray(0, g.width * g.height), header.length);
  return out;
}

/** Otsu threshold of a grey image. */
function otsu(data: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i] as number;
    hist[v] = (hist[v] as number) + 1;
  }
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (hist[i] as number);
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] as number;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] as number);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Dark pixels of a downscaled copy (about `side` px on the long side): their coordinates. */
function darkPoints(g: Gray, side = 900): { xs: Float32Array; ys: Float32Array; n: number; w: number; h: number } {
  const step = Math.max(1, Math.round(Math.max(g.width, g.height) / side));
  const w = Math.floor(g.width / step);
  const h = Math.floor(g.height / step);
  const small = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = g.data[y * step * g.width + x * step] as number;
  const t = Math.min(otsu(small), 200);
  // Ignore a frame of 3 % (scanner edges, punch holes).
  const mx = Math.floor(w * 0.03);
  const my = Math.floor(h * 0.03);
  let n = 0;
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) if ((small[y * w + x] as number) < t) n += 1;
  const keep = Math.max(1, Math.ceil(n / 150000));
  const xs = new Float32Array(Math.ceil(n / keep) + 1);
  const ys = new Float32Array(xs.length);
  let k = 0;
  let i = 0;
  for (let y = my; y < h - my; y++) {
    for (let x = mx; x < w - mx; x++) {
      if ((small[y * w + x] as number) >= t) continue;
      if (i++ % keep === 0) {
        xs[k] = x;
        ys[k] = y;
        k += 1;
      }
    }
  }
  return { xs, ys, n: k, w, h };
}

/** How sharply the dark pixels gather into lines along `angle` (degrees), rows (or columns when `vertical`). */
function profileScore(p: { xs: Float32Array; ys: Float32Array; n: number; w: number; h: number }, angle: number, vertical: boolean): number {
  const t = Math.tan((angle * Math.PI) / 180);
  const len = (vertical ? p.w : p.h) + Math.ceil(Math.abs(t) * (vertical ? p.h : p.w)) + 2;
  // v = y − x·t (rows) runs from min(0, −t·w) up: shift it to start at 1.
  const off = (t > 0 ? Math.ceil(t * (vertical ? p.h : p.w)) : 0) + 1;
  const bins = new Float64Array(len);
  for (let i = 0; i < p.n; i++) {
    const x = p.xs[i] as number;
    const y = p.ys[i] as number;
    const v = vertical ? x - y * t : y - x * t;
    const b = Math.max(0, Math.min(len - 1, Math.round(v) + off));
    bins[b] = (bins[b] as number) + 1;
  }
  let s = 0;
  for (let i = 0; i < len; i++) s += (bins[i] as number) * (bins[i] as number);
  // 1 = evenly spread; text lines give several times that.
  return p.n > 0 ? (s * (vertical ? p.w : p.h)) / (p.n * p.n) : 0;
}

export type Layout = { vertical: boolean; skew: number; score: number; ink: number };

/**
 * Text direction (lines horizontal or vertical) and skew in degrees
 * (positive: lines run downhill to the right in the image), within ±15°.
 */
export function analyse(g: Gray): Layout {
  const p = darkPoints(g);
  const ink = p.n / Math.max(1, p.w * p.h);
  if (p.n < 200) return { vertical: false, skew: 0, score: 0, ink };
  const best = (vertical: boolean) => {
    let angle = 0;
    let score = -1;
    for (let a = -15; a <= 15; a += 0.5) {
      const s = profileScore(p, a, vertical);
      if (s > score) {
        score = s;
        angle = a;
      }
    }
    for (let a = Math.max(-15, angle - 0.5); a <= Math.min(15, angle + 0.5); a += 0.05) {
      const s = profileScore(p, a, vertical);
      if (s > score) {
        score = s;
        angle = a;
      }
    }
    return { angle, score };
  };
  const h = best(false);
  const v = best(true);
  const vertical = v.score > h.score * 1.15;
  return { vertical, skew: vertical ? v.angle : h.angle, score: Math.max(h.score, v.score), ink };
}

/** Turns an image clockwise by `deg` (any angle; quarter turns are exact). White fills the corners. */
export function rotate(g: Gray, deg: number): Gray {
  const d = ((deg % 360) + 360) % 360;
  const { width: w, height: h, data } = g;
  if (d === 0) return g;
  if (d === 90 || d === 270 || d === 180) {
    const nw = d === 180 ? w : h;
    const nh = d === 180 ? h : w;
    const out = new Uint8Array(nw * nh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = data[y * w + x] as number;
        if (d === 90) out[x * nw + (h - 1 - y)] = v;
        else if (d === 270) out[(w - 1 - x) * nw + y] = v;
        else out[(h - 1 - y) * nw + (w - 1 - x)] = v;
      }
    }
    return { width: nw, height: nh, data: out };
  }
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const nw = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
  const nh = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  const out = new Uint8Array(nw * nh).fill(255);
  const cx = w / 2;
  const cy = h / 2;
  const ncx = nw / 2;
  const ncy = nh / 2;
  for (let y = 0; y < nh; y++) {
    const dy = y - ncy;
    for (let x = 0; x < nw; x++) {
      const dx = x - ncx;
      // Inverse rotation: where this output pixel comes from.
      const sx = dx * cos + dy * sin + cx;
      const sy = -dx * sin + dy * cos + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * w + x0;
      const top = (data[i] as number) * (1 - fx) + (data[i + 1] as number) * fx;
      const bottom = (data[i + w] as number) * (1 - fx) + (data[i + w + 1] as number) * fx;
      out[y * nw + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return { width: nw, height: nh, data: out };
}

/** The rows of an image with the most ink: a band of `fraction` of its height (to recognise quickly). */
export function inkBand(g: Gray, fraction: number): Gray {
  const band = Math.max(20, Math.floor(g.height * fraction));
  const t = otsu(g.data);
  const rows = new Float64Array(g.height);
  for (let y = 0; y < g.height; y++) {
    let n = 0;
    for (let x = 0; x < g.width; x += 2) if ((g.data[y * g.width + x] as number) < t) n += 1;
    rows[y] = n;
  }
  let sum = 0;
  for (let y = 0; y < band; y++) sum += rows[y] as number;
  let best = sum;
  let at = 0;
  for (let y = band; y < g.height; y++) {
    sum += (rows[y] as number) - (rows[y - band] as number);
    if (sum > best) {
      best = sum;
      at = y - band + 1;
    }
  }
  return { width: g.width, height: band, data: g.data.slice(at * g.width, (at + band) * g.width) };
}

/**
 * Boxes recognised on an image that was turned clockwise by `deg` (with
 * `rotate`) → boxes on the original `width` × `height` image.
 */
export function unrotateResult(result: OcrResult, deg: number, width: number, height: number): OcrResult {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const ncx = result.width / 2;
  const ncy = result.height / 2;
  const back = (x: number, y: number): [number, number] => {
    const dx = x - ncx;
    const dy = y - ncy;
    return [dx * cos + dy * sin + width / 2, -dx * sin + dy * cos + height / 2];
  };
  const box = (b: OcrBox): OcrBox => {
    const pts = [back(b[0], b[1]), back(b[2], b[1]), back(b[2], b[3]), back(b[0], b[3])];
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  };
  const seg = (b: OcrBox): OcrBox => {
    const [x0, y0] = back(b[0], b[1]);
    const [x1, y1] = back(b[2], b[3]);
    return [x0, y0, x1, y1];
  };
  return {
    ...result,
    width,
    height,
    lines: result.lines.map((l) => ({
      box: box(l.box),
      baseline: l.baseline ? seg(l.baseline) : null,
      words: l.words.map((w) => ({ ...w, box: box(w.box) })),
    })),
  };
}

/** A recognition result's weight as evidence: characters of confident words. */
export function evidence(result: OcrResult): number {
  let n = 0;
  for (const l of result.lines) for (const w of l.words) if (w.confidence >= 60) n += w.text.replace(/[\s\p{P}\p{S}]/gu, '').length;
  return n;
}
