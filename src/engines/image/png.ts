/**
 * A fast PNG writer in TypeScript (fflate's deflate, adaptive row filters,
 * palette / grayscale / RGB / RGBA chosen from the pixels) and an APNG writer
 * built on it. Pure functions; no DOM.
 *
 * oxipng (WebAssembly) still writes the smallest PNGs, but it takes over a
 * minute for a 48-megapixel photo; this writer takes a few seconds, streams
 * its output, and reports progress.
 */
import { Zlib } from 'fflate';

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i += 1) c = (CRC_TABLE[(c ^ (p[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One chunk: length, type, data, CRC. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc([out.subarray(4, 8 + data.length)]));
  return out;
}

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** How pixels are stored: palette (≤256 colours), grayscale, RGB or RGBA, 8 bits per sample. */
type Layout =
  | { type: 3; palette: Map<number, number> }
  | { type: 0 }
  | { type: 2 }
  | { type: 6 };

const BPP: Record<Layout['type'], number> = { 3: 1, 0: 1, 2: 3, 6: 4 };

/** Picks the smallest lossless layout for every pixel in `frames`. */
function chooseLayout(frames: readonly Uint8ClampedArray[]): Layout {
  const palette = new Map<number, number>();
  let paletteOk = true;
  let opaque = true;
  let gray = true;
  for (const data of frames) {
    const px = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    for (let i = 0; i < px.length; i += 1) {
      const v = px[i] ?? 0;
      if (paletteOk && !palette.has(v)) {
        if (palette.size >= 256) paletteOk = false;
        else palette.set(v, palette.size);
      }
      if (v >>> 24 !== 255) opaque = false;
      const r = v & 0xff;
      if (gray && (r !== ((v >> 8) & 0xff) || r !== ((v >> 16) & 0xff))) gray = false;
      if (!paletteOk && !opaque && !gray) break;
    }
  }
  if (paletteOk) {
    // Opaque entries last keeps tRNS short.
    const sorted = [...palette.keys()].sort((a, b) => (a >>> 24) - (b >>> 24));
    return { type: 3, palette: new Map(sorted.map((v, i) => [v, i])) };
  }
  if (opaque && gray) return { type: 0 };
  return opaque ? { type: 2 } : { type: 6 };
}

function headerChunks(width: number, height: number, layout: Layout): Uint8Array[] {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, layout.type, 0, 0, 0], 8);
  const out = [pngChunk('IHDR', ihdr)];
  if (layout.type === 3) {
    const entries = [...layout.palette.keys()];
    const plte = new Uint8Array(entries.length * 3);
    let alphas = 0;
    entries.forEach((c, i) => {
      plte[i * 3] = c & 0xff;
      plte[i * 3 + 1] = (c >> 8) & 0xff;
      plte[i * 3 + 2] = (c >> 16) & 0xff;
      if (c >>> 24 !== 255) alphas = i + 1;
    });
    out.push(pngChunk('PLTE', plte));
    if (alphas) out.push(pngChunk('tRNS', new Uint8Array(entries.slice(0, alphas).map((c) => c >>> 24))));
  }
  return out;
}

/** Packs one row of RGBA into the layout's bytes. */
function packRow(data: Uint8ClampedArray, rowStart: number, width: number, layout: Layout, out: Uint8Array) {
  const px = new Uint32Array(data.buffer, data.byteOffset + rowStart * 4, width);
  switch (layout.type) {
    case 3:
      for (let x = 0; x < width; x += 1) out[x] = layout.palette.get(px[x] ?? 0) ?? 0;
      break;
    case 0:
      for (let x = 0; x < width; x += 1) out[x] = (px[x] ?? 0) & 0xff;
      break;
    case 2:
      for (let x = 0, o = 0; x < width; x += 1, o += 3) {
        const v = px[x] ?? 0;
        out[o] = v & 0xff;
        out[o + 1] = (v >> 8) & 0xff;
        out[o + 2] = (v >> 16) & 0xff;
      }
      break;
    case 6:
      out.set(new Uint8Array(data.buffer, data.byteOffset + rowStart * 4, width * 4));
      break;
  }
}

/**
 * A zlib stream: the browser's native deflate (CompressionStream, several
 * times faster than JavaScript) where available, fflate otherwise.
 */
function zlibStream(): { push(data: Uint8Array): Promise<void>; finish(last: Uint8Array): Promise<Uint8Array> } {
  if (typeof CompressionStream === 'function') {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    const collected = new Response(stream.readable).arrayBuffer();
    return {
      async push(data) {
        await writer.write(data.slice());
      },
      async finish(last) {
        if (last.length) await writer.write(last.slice());
        await writer.close();
        return new Uint8Array(await collected);
      },
    };
  }
  const chunks: Uint8Array[] = [];
  const z = new Zlib({ level: 6, mem: 8 }, (chunk) => chunks.push(chunk));
  return {
    async push(data) {
      z.push(data);
    },
    async finish(last) {
      z.push(last, true);
      return concat(chunks);
    },
  };
}

/** Predictor of PNG filter `f` for byte i (a = left, b = up, c = up-left). */
function predict(f: number, a: number, b: number, c: number): number {
  switch (f) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    default: {
      const p = a + b - c;
      const pa = p > a ? p - a : a - p;
      const pb = p > b ? p - b : b - p;
      const pc = p > c ? p - c : c - p;
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
  }
}

/**
 * The usual filter-choice heuristic (sum of absolute signed filtered bytes),
 * sampled every `step` bytes: choosing costs a fraction of filtering a row.
 * `prev` is all zeros for the first row.
 */
function filterScore(f: number, cur: Uint8Array, prev: Uint8Array, bpp: number, step: number): number {
  let s = 0;
  for (let i = 0; i < cur.length; i += step) {
    const a = i >= bpp ? (cur[i - bpp] ?? 0) : 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    const v = ((cur[i] ?? 0) - predict(f, a, prev[i] ?? 0, c)) & 255;
    s += v < 128 ? v : 256 - v;
  }
  return s;
}

/** Writes the filter type byte at out[at] and the filtered row after it. */
function applyFilter(f: number, cur: Uint8Array, prev: Uint8Array, bpp: number, out: Uint8Array, at: number): void {
  const n = cur.length;
  out[at] = f;
  const o = at + 1;
  let i = 0;
  for (; i < bpp && i < n; i += 1) out[o + i] = (cur[i] ?? 0) - predict(f, 0, prev[i] ?? 0, 0);
  switch (f) {
    case 0:
      out.set(cur, o);
      break;
    case 1:
      for (; i < n; i += 1) out[o + i] = (cur[i] ?? 0) - (cur[i - bpp] ?? 0);
      break;
    case 2:
      for (; i < n; i += 1) out[o + i] = (cur[i] ?? 0) - (prev[i] ?? 0);
      break;
    case 3:
      for (; i < n; i += 1) out[o + i] = (cur[i] ?? 0) - (((cur[i - bpp] ?? 0) + (prev[i] ?? 0)) >> 1);
      break;
    default:
      for (; i < n; i += 1) {
        const a = cur[i - bpp] ?? 0;
        const b = prev[i] ?? 0;
        const c = prev[i - bpp] ?? 0;
        const p = a + b - c;
        const pa = p > a ? p - a : a - p;
        const pb = p > b ? p - b : b - p;
        const pc = p > c ? p - c : c - p;
        out[o + i] = (cur[i] ?? 0) - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
  }
}

/**
 * Filters and deflates rows of a (sub)image into zlib data. `rect` selects a
 * region of the RGBA canvas (APNG frames); progress is reported per row band.
 */
async function compressRows(
  img: RgbaImage,
  layout: Layout,
  rect: { x: number; y: number; w: number; h: number },
  onProgress?: (f: number) => void,
): Promise<Uint8Array> {
  const bpp = BPP[layout.type];
  const rowBytes = rect.w * bpp;
  const z = zlibStream();
  let prev = new Uint8Array(rowBytes);
  let cur = new Uint8Array(rowBytes);
  // Rows are batched into ~1 MB pushes.
  const batchRows = Math.max(1, Math.floor((1 << 20) / (rowBytes + 1)));
  let batch = new Uint8Array(batchRows * (rowBytes + 1));
  let filled = 0;
  // Palette rows are left unfiltered (as libpng does); others pick the best filter per row.
  const adaptive = layout.type !== 3;
  const step = rowBytes > 1024 ? 5 : 1;
  for (let y = 0; y < rect.h; y += 1) {
    packRow(img.data, (rect.y + y) * img.width + rect.x, rect.w, layout, cur);
    let best = 0;
    if (adaptive) {
      let bestScore = Infinity;
      for (let f = 0; f < 5; f += 1) {
        const score = filterScore(f, cur, prev, bpp, step);
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
      }
    }
    applyFilter(best, cur, prev, bpp, batch, filled * (rowBytes + 1));
    filled += 1;
    if (filled === batchRows) {
      await z.push(batch);
      batch = new Uint8Array(batchRows * (rowBytes + 1));
      filled = 0;
      onProgress?.((y + 1) / rect.h);
    }
    [prev, cur] = [cur, prev];
  }
  const out = await z.finish(batch.subarray(0, filled * (rowBytes + 1)));
  onProgress?.(1);
  return out;
}

/** Lossless PNG from RGBA, quickly (zlib level 6, adaptive filters, smallest pixel layout). */
export async function encodePngFast(img: RgbaImage, onProgress?: (f: number) => void): Promise<Uint8Array> {
  const layout = chooseLayout([img.data]);
  const idat = await compressRows(img, layout, { x: 0, y: 0, w: img.width, h: img.height }, onProgress);
  return concat([PNG_SIGNATURE, ...headerChunks(img.width, img.height, layout), ...idatChunks('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]);
}

/** Splits zlib data into IDAT (or fdAT, with sequence numbers) chunks of at most 1 MB. */
function idatChunks(type: 'IDAT' | 'fdAT', data: Uint8Array, seq?: () => number): Uint8Array[] {
  const out: Uint8Array[] = [];
  const MAX = 1 << 20;
  for (let o = 0; o < data.length || o === 0; o += MAX) {
    const part = data.subarray(o, Math.min(data.length, o + MAX));
    if (type === 'IDAT') out.push(pngChunk('IDAT', part));
    else {
      const body = new Uint8Array(4 + part.length);
      new DataView(body.buffer).setUint32(0, seq?.() ?? 0);
      body.set(part, 4);
      out.push(pngChunk('fdAT', body));
    }
    if (!data.length) break;
  }
  return out;
}

/**
 * Animated PNG from full-canvas RGBA frames. Each frame after the first
 * stores only the rectangle that changed (replacing those pixels), so static
 * backgrounds cost nothing.
 */
export async function encodeApng(
  frames: readonly { data: Uint8ClampedArray; delay: number }[],
  width: number,
  height: number,
  plays: number,
  onProgress?: (f: number) => void,
): Promise<Uint8Array> {
  const layout = chooseLayout(frames.map((f) => f.data));
  const parts: Uint8Array[] = [PNG_SIGNATURE, ...headerChunks(width, height, layout)];
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, plays);
  parts.splice(2, 0, pngChunk('acTL', actl));
  let seq = 0;
  const next = () => seq++;
  let prev: Uint32Array | null = null;
  for (const [i, frame] of frames.entries()) {
    const px = new Uint32Array(frame.data.buffer, frame.data.byteOffset, width * height);
    const rect = prev ? changedRect(prev, px, width, height) : { x: 0, y: 0, w: width, h: height };
    // Delays as a fraction: milliseconds over 1000, reduced to fit 16 bits.
    let num = Math.max(0, Math.round(frame.delay));
    let den = 1000;
    while (num > 0xffff) {
      num = Math.round(num / 10);
      den /= 10;
    }
    if (den < 1) den = 1;
    const fctl = new Uint8Array(26);
    const v = new DataView(fctl.buffer);
    v.setUint32(0, next());
    v.setUint32(4, rect.w);
    v.setUint32(8, rect.h);
    v.setUint32(12, rect.x);
    v.setUint32(16, rect.y);
    v.setUint16(20, num);
    v.setUint16(22, den);
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source (the rectangle replaces what was there)
    parts.push(pngChunk('fcTL', fctl));
    const data = await compressRows({ data: frame.data, width, height }, layout, rect);
    parts.push(...(i === 0 ? idatChunks('IDAT', data) : idatChunks('fdAT', data, next)));
    prev = px;
    onProgress?.((i + 1) / frames.length);
  }
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

/** The bounding box of pixels that differ (at least 1×1 at the origin when none do). */
export function changedRect(a: Uint32Array, b: Uint32Array, width: number, height: number) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let first = -1;
    for (let x = 0; x < width; x += 1) {
      if (a[row + x] !== b[row + x]) {
        first = x;
        break;
      }
    }
    if (first < 0) continue;
    let last = first;
    for (let x = width - 1; x > first; x -= 1) {
      if (a[row + x] !== b[row + x]) {
        last = x;
        break;
      }
    }
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
    if (y0 === height) y0 = y;
    y1 = y;
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
