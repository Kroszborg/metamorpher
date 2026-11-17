/**
 * GIF in plain TypeScript: a decoder (LZW, disposal and transparency, for
 * browsers without the WebCodecs ImageDecoder) and an encoder on top of
 * gifenc. Pure functions over bytes; no DOM.
 *
 * Encoding keeps a frame's exact colours when it has at most 255 of them
 * (true of almost every GIF, so GIF → GIF does not lose colour) and otherwise
 * quantises with gifenc's PNN quantiser, dithered (Floyd–Steinberg for a still
 * image, ordered for animations so static areas do not shimmer). Fully opaque
 * animations only store the pixels that changed since the previous frame.
 */
import { GIFEncoder, quantize } from 'gifenc';

export type RgbaFrame = { data: Uint8ClampedArray; width: number; height: number };

// ── Decoding ──────────────────────────────────────────────────────────────

/** GIF LZW → colour indices (at most `count`; a short stream leaves zeros). */
function lzw(minSize: number, data: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  if (minSize < 2 || minSize > 11) return out;
  const clear = 1 << minSize;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i += 1) suffix[i] = i;
  let size = minSize + 1;
  let mask = (1 << size) - 1;
  let avail = clear + 2;
  let old = -1;
  let first = 0;
  let datum = 0;
  let bits = 0;
  let at = 0;
  let op = 0;
  outer: while (op < count) {
    while (bits < size) {
      if (at >= data.length) break outer;
      datum |= (data[at] ?? 0) << bits;
      at += 1;
      bits += 8;
    }
    let code = datum & mask;
    datum >>>= size;
    bits -= size;
    if (code === clear) {
      size = minSize + 1;
      mask = (1 << size) - 1;
      avail = clear + 2;
      old = -1;
      continue;
    }
    if (code === eoi) break;
    if (old === -1) {
      if (code >= clear) break; // corrupt: first code after a clear must be a root
      out[op] = code;
      op += 1;
      old = code;
      first = code;
      continue;
    }
    const inCode = code;
    let top = 0;
    if (code >= avail) {
      if (code > avail) break; // corrupt
      stack[top] = first;
      top += 1;
      code = old;
    }
    while (code > clear) {
      stack[top] = suffix[code] ?? 0;
      top += 1;
      code = prefix[code] ?? 0;
    }
    first = suffix[code] ?? 0;
    stack[top] = first;
    top += 1;
    if (avail < 4096) {
      prefix[avail] = old;
      suffix[avail] = first;
      avail += 1;
      if ((avail & mask) === 0 && avail < 4096) {
        size += 1;
        mask += avail;
      }
    }
    old = inCode;
    while (top > 0 && op < count) {
      top -= 1;
      out[op] = stack[top] ?? 0;
      op += 1;
    }
  }
  return out;
}

/** Rows of an interlaced image in storage order. */
function interlacedRows(h: number): number[] {
  const rows: number[] = [];
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const) {
    for (let y = start; y < h; y += step) rows.push(y);
  }
  return rows;
}

/**
 * Decodes every frame of a GIF as the full composited canvas (RGBA,
 * transparent background, as browsers show it) and hands each to `sink`.
 */
export async function decodeGif(
  b: Uint8Array,
  sink: (frame: RgbaFrame, index: number) => Promise<void> | void,
): Promise<number> {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const W = view.getUint16(6, true);
  const H = view.getUint16(8, true);
  const flags = b[10] ?? 0;
  let o = 13;
  let globalPalette: Uint8Array | null = null;
  if (flags & 0x80) {
    const n = 3 * (1 << ((flags & 7) + 1));
    globalPalette = b.subarray(o, o + n);
    o += n;
  }
  const canvas = new Uint8ClampedArray(W * H * 4);
  let disposal = 0;
  let transparent = -1;
  let prev: { disposal: number; x: number; y: number; w: number; h: number } | null = null;
  let saved: Uint8ClampedArray | null = null;
  let index = 0;
  const subBlocks = (start: number): [Uint8Array, number] => {
    let x = start;
    let total = 0;
    while (x < b.length && b[x] !== 0) {
      total += b[x] ?? 0;
      x += (b[x] ?? 0) + 1;
    }
    const data = new Uint8Array(total);
    let y = start;
    let at = 0;
    while (y < b.length && b[y] !== 0) {
      const n = b[y] ?? 0;
      data.set(b.subarray(y + 1, y + 1 + n), at);
      at += n;
      y += n + 1;
    }
    return [data, x + 1];
  };

  while (o < b.length) {
    const intro = b[o];
    if (intro === 0x21) {
      if (b[o + 1] === 0xf9 && b[o + 2] === 4) {
        const packed = b[o + 3] ?? 0;
        disposal = (packed >> 2) & 7;
        transparent = packed & 1 ? (b[o + 6] ?? 0) : -1;
      }
      [, o] = subBlocks(o + 2);
    } else if (intro === 0x2c) {
      const x = view.getUint16(o + 1, true);
      const y = view.getUint16(o + 3, true);
      const w = view.getUint16(o + 5, true);
      const h = view.getUint16(o + 7, true);
      const f = b[o + 9] ?? 0;
      o += 10;
      let palette = globalPalette;
      if (f & 0x80) {
        const n = 3 * (1 << ((f & 7) + 1));
        palette = b.subarray(o, o + n);
        o += n;
      }
      const minSize = b[o] ?? 8;
      const [data, next] = subBlocks(o + 1);
      o = next;

      // The previous frame's disposal happens before this one is drawn.
      if (prev?.disposal === 2) {
        for (let yy = Math.max(0, prev.y); yy < Math.min(H, prev.y + prev.h); yy += 1) {
          const x0 = Math.max(0, prev.x);
          const x1 = Math.min(W, prev.x + prev.w);
          if (x1 > x0) canvas.fill(0, (yy * W + x0) * 4, (yy * W + x1) * 4);
        }
      } else if (prev?.disposal === 3 && saved) {
        canvas.set(saved);
      }
      saved = disposal === 3 ? canvas.slice() : null;

      const indices = lzw(minSize, data, w * h);
      const rows = f & 0x40 ? interlacedRows(h) : null;
      if (palette) {
        for (let r = 0; r < h; r += 1) {
          const cy = y + (rows ? (rows[r] ?? r) : r);
          if (cy >= H) continue;
          for (let c = 0; c < w; c += 1) {
            const cx = x + c;
            if (cx >= W) break;
            const idx = indices[r * w + c] ?? 0;
            if (idx === transparent) continue;
            const p = (cy * W + cx) * 4;
            canvas[p] = palette[idx * 3] ?? 0;
            canvas[p + 1] = palette[idx * 3 + 1] ?? 0;
            canvas[p + 2] = palette[idx * 3 + 2] ?? 0;
            canvas[p + 3] = 255;
          }
        }
      }
      await sink({ data: canvas.slice(), width: W, height: H }, index);
      index += 1;
      prev = { disposal, x, y, w, h };
      disposal = 0;
      transparent = -1;
    } else {
      break; // trailer (0x3b) or garbage
    }
  }
  return index;
}

// ── Encoding ──────────────────────────────────────────────────────────────

type Palette = number[][];

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Nearest palette entry with a 15-bit cache (photos map millions of pixels to few keys). */
function nearestFinder(palette: Palette) {
  const cache = new Int16Array(32768).fill(-1);
  return (r: number, g: number, b: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key] ?? -1;
    if (hit >= 0) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      const p = palette[i] ?? [0, 0, 0];
      const dr = r - (p[0] ?? 0);
      const dg = g - (p[1] ?? 0);
      const db = b - (p[2] ?? 0);
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };
}

export type GifOptions = {
  /** Colours per frame, 2–256 (the transparent slot included). Default 256. */
  colours?: number;
  /** 0 = loop forever, 1 = play once, n = play n times. */
  plays: number;
  /** Any frame has transparent pixels: frames are then stored whole and cleared between frames. */
  transparent: boolean;
  /** Dithering for frames with more colours than fit: Floyd–Steinberg for stills, ordered for animations. */
  dither: 'fs' | 'ordered' | 'none';
};

/**
 * Builds a GIF one frame at a time (all frames the same size). Keeps only the
 * previous frame, so memory does not grow with the number of frames.
 */
export class GifWriter {
  #enc = GIFEncoder();
  #prev: Uint8ClampedArray | null = null;
  #count = 0;
  #o: Required<GifOptions>;

  constructor(
    readonly width: number,
    readonly height: number,
    options: GifOptions,
  ) {
    if (width > 65535 || height > 65535) throw new Error('GIF images can be at most 65535 pixels wide or high.');
    this.#o = { ...options, colours: options.colours ?? 256 };
  }

  add(data: Uint8ClampedArray, delayMs: number): void {
    const { width, height } = this;
    const n = width * height;
    const o = this.#o;
    const px = new Uint32Array(data.buffer, data.byteOffset, n);
    const prev = this.#prev ? new Uint32Array(this.#prev.buffer, this.#prev.byteOffset, n) : null;
    const colours = Math.max(2, Math.min(256, o.colours));
    // Exact colours of the stored pixels, or null when there are more than `limit`.
    const exactColours = (keep: (i: number) => boolean, limit: number) => {
      const exact = new Map<number, number>();
      for (let i = 0; i < n; i += 1) {
        if (!keep(i)) continue;
        const v = px[i] ?? 0;
        if (v >>> 24 < 128) continue;
        const rgb = v & 0xffffff;
        if (!exact.has(rgb)) {
          if (exact.size >= limit) return null;
          exact.set(rgb, exact.size);
        }
      }
      return exact;
    };
    // Opaque animations store only changed pixels; the rest are transparent.
    let diff = !o.transparent && prev !== null;
    let keep = (i: number) => !diff || px[i] !== prev?.[i];
    let needsTransparent = o.transparent;
    if (diff) {
      for (let i = 0; i < n; i += 1) {
        if (!keep(i)) {
          needsTransparent = true;
          break;
        }
      }
    }
    let limit = colours - (needsTransparent ? 1 : 0);
    let exact = exactColours(keep, limit);
    if (!exact && diff && needsTransparent) {
      // A whole frame with exactly `colours` colours beats a quantised partial one.
      const whole = exactColours(() => true, colours);
      if (whole) {
        diff = false;
        keep = () => true;
        needsTransparent = false;
        limit = colours;
        exact = whole;
      }
    }

    const indices = new Uint8Array(n);
    let palette: Palette;
    let transparentIndex = -1;
    if (exact) {
      palette = [...exact.keys()].map((v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]);
      if (needsTransparent) transparentIndex = palette.length;
      for (let i = 0; i < n; i += 1) {
        const v = px[i] ?? 0;
        indices[i] = !keep(i) || v >>> 24 < 128 ? transparentIndex : (exact.get(v & 0xffffff) ?? 0);
      }
    } else {
      // Quantise the pixels this frame stores (opaque ones only).
      let count = 0;
      for (let i = 0; i < n; i += 1) if (keep(i) && (px[i] ?? 0) >>> 24 >= 128) count += 1;
      const sample = new Uint32Array(count);
      for (let i = 0, k = 0; i < n; i += 1) {
        const v = px[i] ?? 0;
        if (keep(i) && v >>> 24 >= 128) {
          sample[k] = v | 0xff000000;
          k += 1;
        }
      }
      palette = quantize(new Uint8Array(sample.buffer), limit, { format: 'rgb565' }).map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0]);
      if (needsTransparent) transparentIndex = palette.length;
      this.#map(data, indices, palette, keep, transparentIndex);
    }
    if (needsTransparent) palette.push([0, 0, 0]);
    if (palette.length < 2) palette.push([0, 0, 0]);

    this.#enc.writeFrame(indices, width, height, {
      palette,
      delay: delayMs,
      repeat: o.plays === 0 ? 0 : o.plays === 1 ? -1 : o.plays - 1,
      transparent: needsTransparent,
      transparentIndex: Math.max(0, transparentIndex),
      // 1 = keep (so unchanged pixels show through), 2 = clear before the next frame.
      dispose: o.transparent ? 2 : 1,
    });
    this.#prev = o.transparent ? null : data;
    this.#count += 1;
  }

  /** Palette mapping with dithering; skipped and transparent pixels get `transparentIndex`. */
  #map(data: Uint8ClampedArray, out: Uint8Array, palette: Palette, keep: (i: number) => boolean, transparentIndex: number) {
    const { width, height } = this;
    const near = nearestFinder(palette);
    const mode = this.#o.dither;
    if (mode === 'fs') {
      // Error diffusion over two rows of float errors.
      let cur = new Float32Array((width + 2) * 3);
      let next = new Float32Array((width + 2) * 3);
      for (let y = 0; y < height; y += 1) {
        next.fill(0);
        for (let x = 0; x < width; x += 1) {
          const i = y * width + x;
          const p = i * 4;
          if (!keep(i) || (data[p + 3] ?? 0) < 128) {
            out[i] = transparentIndex;
            continue;
          }
          const e = (x + 1) * 3;
          const r = Math.min(255, Math.max(0, (data[p] ?? 0) + (cur[e] ?? 0)));
          const g = Math.min(255, Math.max(0, (data[p + 1] ?? 0) + (cur[e + 1] ?? 0)));
          const b = Math.min(255, Math.max(0, (data[p + 2] ?? 0) + (cur[e + 2] ?? 0)));
          const idx = near(r | 0, g | 0, b | 0);
          out[i] = idx;
          const c = palette[idx] ?? [0, 0, 0];
          const er = r - (c[0] ?? 0);
          const eg = g - (c[1] ?? 0);
          const eb = b - (c[2] ?? 0);
          const spread = (arr: Float32Array, at: number, k: number) => {
            arr[at] = (arr[at] ?? 0) + er * k;
            arr[at + 1] = (arr[at + 1] ?? 0) + eg * k;
            arr[at + 2] = (arr[at + 2] ?? 0) + eb * k;
          };
          spread(cur, e + 3, 7 / 16);
          spread(next, e - 3, 3 / 16);
          spread(next, e, 5 / 16);
          spread(next, e + 3, 1 / 16);
        }
        [cur, next] = [next, cur];
      }
      return;
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const p = i * 4;
        if (!keep(i) || (data[p + 3] ?? 0) < 128) {
          out[i] = transparentIndex;
          continue;
        }
        const t = mode === 'ordered' ? ((BAYER4[(y & 3) * 4 + (x & 3)] ?? 0) / 16 - 0.5) * 24 : 0;
        const r = Math.min(255, Math.max(0, (data[p] ?? 0) + t));
        const g = Math.min(255, Math.max(0, (data[p + 1] ?? 0) + t));
        const b = Math.min(255, Math.max(0, (data[p + 2] ?? 0) + t));
        out[i] = near(r | 0, g | 0, b | 0);
      }
    }
  }

  get frames(): number {
    return this.#count;
  }

  finish(): Uint8Array {
    this.#enc.finish();
    return this.#enc.bytes();
  }
}
