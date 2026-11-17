/**
 * Animated GIF, WebP and PNG (APNG) in the image worker.
 *
 * Timing (each frame's delay and the loop count) is read from the file's own
 * bytes, so it survives exactly. Frames are decoded by the browser's
 * WebCodecs ImageDecoder where it exists (Chrome, Edge, Firefox) and
 * otherwise here: GIF with the decoder in gif.ts, WebP and APNG by
 * repackaging each frame as a still image for createImageBitmap and
 * compositing in JavaScript. Every frame comes out as the whole canvas,
 * composited, 8-bit RGBA in sRGB.
 *
 * Writing: GIF (gif.ts), APNG (png.ts) and animated WebP, which is muxed here
 * from frames encoded by libwebp's still encoder (as webpmux does).
 *
 * Worker-only: uses OffscreenCanvas and createImageBitmap.
 */
import { decodeGif } from './gif';
import { changedRect, PNG_SIGNATURE, pngChunk } from './png';
import type { SourceFormat } from './probe';
import { offscreen } from './pixels';

export type AnimationInfo = {
  format: 'gif' | 'webp' | 'png';
  width: number;
  height: number;
  /** Display time of each frame in milliseconds, as stored. */
  delays: number[];
  /** Times the animation plays: 0 = forever. */
  plays: number;
};

export type Frame = { data: Uint8ClampedArray; width: number; height: number };

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i += 1) s += String.fromCharCode(b[o + i] ?? 0);
  return s;
};
const u24 = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);

// ── Timing ────────────────────────────────────────────────────────────────

function gifInfo(b: Uint8Array): AnimationInfo {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info: AnimationInfo = { format: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true), delays: [], plays: 1 };
  let o = 13;
  const flags = b[10] ?? 0;
  if (flags & 0x80) o += 3 * (1 << ((flags & 7) + 1));
  let delay = 0;
  const skip = (at: number) => {
    let x = at;
    while (x < b.length && b[x] !== 0) x += (b[x] ?? 0) + 1;
    return x + 1;
  };
  while (o < b.length) {
    const intro = b[o];
    if (intro === 0x21) {
      const label = b[o + 1];
      if (label === 0xf9 && b[o + 2] === 4) delay = view.getUint16(o + 4, true) * 10;
      else if (label === 0xff && b[o + 2] === 11 && /^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(ascii(b, o + 3, 11))) {
        const sub = o + 14;
        // Loop count = extra iterations (0 = forever).
        if (b[sub] === 3 && b[sub + 1] === 1) {
          const n = view.getUint16(sub + 2, true);
          info.plays = n === 0 ? 0 : n + 1;
        }
      }
      o = skip(o + 2);
    } else if (intro === 0x2c) {
      const f = b[o + 9] ?? 0;
      o += 10;
      if (f & 0x80) o += 3 * (1 << ((f & 7) + 1));
      o = skip(o + 1);
      info.delays.push(delay);
      delay = 0;
    } else {
      break;
    }
  }
  return info;
}

type WebpFrame = { x: number; y: number; w: number; h: number; duration: number; blend: boolean; dispose: boolean; data: Uint8Array };

function webpFrames(b: Uint8Array): { info: AnimationInfo; frames: WebpFrame[] } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info: AnimationInfo = { format: 'webp', width: 0, height: 0, delays: [], plays: 0 };
  const frames: WebpFrame[] = [];
  let o = 12;
  while (o + 8 <= b.length) {
    const type = ascii(b, o, 4);
    const len = view.getUint32(o + 4, true);
    const d = o + 8;
    if (type === 'VP8X') {
      info.width = 1 + u24(b, d + 4);
      info.height = 1 + u24(b, d + 7);
    } else if (type === 'ANIM') {
      info.plays = view.getUint16(d + 4, true);
    } else if (type === 'ANMF') {
      const flags = b[d + 15] ?? 0;
      const frame: WebpFrame = {
        x: u24(b, d) * 2,
        y: u24(b, d + 3) * 2,
        w: 1 + u24(b, d + 6),
        h: 1 + u24(b, d + 9),
        duration: u24(b, d + 12),
        blend: (flags & 2) === 0,
        dispose: (flags & 1) === 1,
        data: b.subarray(d + 16, d + len),
      };
      frames.push(frame);
      info.delays.push(frame.duration);
    }
    o = d + len + (len & 1);
  }
  return { info, frames };
}

type PngFrame = { x: number; y: number; w: number; h: number; dispose: number; blend: number; data: Uint8Array[] };

function apngFrames(b: Uint8Array): { info: AnimationInfo; frames: PngFrame[]; shared: Uint8Array[]; ihdr: Uint8Array } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info: AnimationInfo = { format: 'png', width: view.getUint32(16), height: view.getUint32(20), delays: [], plays: 0 };
  const frames: PngFrame[] = [];
  const shared: Uint8Array[] = [];
  let ihdr = new Uint8Array(13);
  let current: PngFrame | null = null;
  let seenIdat = false;
  let o = 8;
  while (o + 12 <= b.length) {
    const len = view.getUint32(o);
    const type = ascii(b, o + 4, 4);
    const d = o + 8;
    if (type === 'IHDR') ihdr = b.slice(d, d + 13);
    else if (type === 'acTL') info.plays = view.getUint32(d + 4);
    else if (type === 'fcTL') {
      const num = view.getUint16(d + 20);
      const den = view.getUint16(d + 22) || 100;
      current = {
        w: view.getUint32(d + 4),
        h: view.getUint32(d + 8),
        x: view.getUint32(d + 12),
        y: view.getUint32(d + 16),
        dispose: b[d + 24] ?? 0,
        blend: b[d + 25] ?? 0,
        data: [],
      };
      frames.push(current);
      info.delays.push(Math.round((num * 1000) / den));
    } else if (type === 'IDAT') {
      // Without a preceding fcTL the default image is not part of the animation.
      if (current && frames.length === 1) current.data.push(b.subarray(d, d + len));
    } else if (type === 'fdAT') {
      current?.data.push(b.subarray(d + 4, d + len));
    } else if (type === 'IEND') {
      break;
    } else if (!seenIdat && !frames.length && type !== 'IHDR' && type !== 'acTL') {
      shared.push(b.subarray(o, d + len + 4));
    }
    if (type === 'IDAT') seenIdat = true;
    o = d + len + 4;
  }
  return { info, frames, shared, ihdr };
}

/** Timing of an animated GIF, WebP or PNG; null for anything else or a still image. */
export function readAnimation(b: Uint8Array, format: SourceFormat): AnimationInfo | null {
  try {
    const info = format === 'gif' ? gifInfo(b) : format === 'webp' ? webpFrames(b).info : format === 'png' ? apngFrames(b).info : null;
    return info && info.delays.length > 1 ? info : null;
  } catch {
    return null;
  }
}

// ── Decoding ──────────────────────────────────────────────────────────────

const MIME = { gif: 'image/gif', webp: 'image/webp', png: 'image/png' } as const;

/** Set by tests to exercise the fallback decoders in a browser that has ImageDecoder. */
const FORCE_FALLBACK = false;

async function bitmapPixels(blob: Blob): Promise<Frame> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  const { width, height } = bitmap;
  const canvas = offscreen(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available in this browser.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height).data;
  return { data, width, height };
}

/** Draws `src` at (x, y) on the canvas: replacing pixels, or alpha-blending over them. */
function blit(canvas: Uint8ClampedArray, W: number, H: number, src: Frame, x: number, y: number, blend: boolean) {
  for (let r = 0; r < src.height; r += 1) {
    const cy = y + r;
    if (cy < 0 || cy >= H) continue;
    for (let c = 0; c < src.width; c += 1) {
      const cx = x + c;
      if (cx < 0 || cx >= W) continue;
      const s = (r * src.width + c) * 4;
      const d = (cy * W + cx) * 4;
      const sa = src.data[s + 3] ?? 0;
      if (!blend || sa === 255) {
        canvas[d] = src.data[s] ?? 0;
        canvas[d + 1] = src.data[s + 1] ?? 0;
        canvas[d + 2] = src.data[s + 2] ?? 0;
        canvas[d + 3] = sa;
      } else if (sa > 0) {
        const da = ((canvas[d + 3] ?? 0) * (255 - sa)) / 255;
        const a = sa + da;
        for (let k = 0; k < 3; k += 1) canvas[d + k] = ((src.data[s + k] ?? 0) * sa + (canvas[d + k] ?? 0) * da) / a;
        canvas[d + 3] = a;
      }
    }
  }
}

function clearRect(canvas: Uint8ClampedArray, W: number, H: number, x: number, y: number, w: number, h: number) {
  for (let r = Math.max(0, y); r < Math.min(H, y + h); r += 1) {
    const x0 = Math.max(0, x);
    const x1 = Math.min(W, x + w);
    if (x1 > x0) canvas.fill(0, (r * W + x0) * 4, (r * W + x1) * 4);
  }
}

function riff(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + size);
  out.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(out.buffer).setUint32(4, 4 + size, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  let o = 12;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function vp8x(width: number, height: number, flags: number): Uint8Array {
  const c = new Uint8Array(18);
  c.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]);
  c[8] = flags;
  const w = width - 1;
  const h = height - 1;
  c.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 12);
  return c;
}

async function decodeWebpFallback(b: Uint8Array, sink: (f: Frame) => Promise<void>) {
  const { info, frames } = webpFrames(b);
  const { width: W, height: H } = info;
  const canvas = new Uint8ClampedArray(W * H * 4);
  for (const f of frames) {
    // A frame's ALPH + VP8, or VP8L, as a still WebP of its own.
    const hasAlpha = ascii(f.data, 0, 4) === 'ALPH';
    const parts = hasAlpha ? [vp8x(f.w, f.h, 0x10), f.data] : [f.data];
    const still = await bitmapPixels(new Blob([riff(parts) as Uint8Array<ArrayBuffer>], { type: 'image/webp' }));
    blit(canvas, W, H, still, f.x, f.y, f.blend);
    await sink({ data: canvas.slice(), width: W, height: H });
    if (f.dispose) clearRect(canvas, W, H, f.x, f.y, f.w, f.h);
  }
}

async function decodeApngFallback(b: Uint8Array, sink: (f: Frame) => Promise<void>) {
  const { info, frames, shared, ihdr } = apngFrames(b);
  const { width: W, height: H } = info;
  const canvas = new Uint8ClampedArray(W * H * 4);
  for (const f of frames) {
    const head = ihdr.slice();
    const v = new DataView(head.buffer);
    v.setUint32(0, f.w);
    v.setUint32(4, f.h);
    const png = [PNG_SIGNATURE, pngChunk('IHDR', head), ...shared, ...f.data.map((d) => pngChunk('IDAT', d)), pngChunk('IEND', new Uint8Array(0))];
    const still = await bitmapPixels(new Blob(png as Uint8Array<ArrayBuffer>[], { type: 'image/png' }));
    const saved = f.dispose === 2 ? canvas.slice() : null;
    blit(canvas, W, H, still, f.x, f.y, f.blend === 1);
    await sink({ data: canvas.slice(), width: W, height: H });
    if (f.dispose === 1) clearRect(canvas, W, H, f.x, f.y, f.w, f.h);
    else if (saved) canvas.set(saved);
  }
}

/** Whether this browser's ImageDecoder can decode the format. */
async function canUseImageDecoder(type: string): Promise<boolean> {
  if (FORCE_FALLBACK || typeof ImageDecoder !== 'function') return false;
  try {
    return await ImageDecoder.isTypeSupported(type);
  } catch {
    return false;
  }
}

/**
 * Decodes every frame of an animation (full canvas, composited) and passes
 * each to `sink` in order. Frames are not kept here, so memory stays at one
 * frame plus whatever `sink` keeps.
 */
export async function decodeAnimation(b: Uint8Array, info: AnimationInfo, sink: (frame: Frame, index: number) => Promise<void>): Promise<void> {
  const type = MIME[info.format];
  let index = 0;
  let sinkError: unknown = null;
  const emit = async (f: Frame) => {
    if (index < info.delays.length) {
      try {
        await sink(f, index);
      } catch (err) {
        sinkError = err;
        throw err;
      }
    }
    index += 1;
  };
  if (await canUseImageDecoder(type)) {
    const decoder = new ImageDecoder({ data: b, type, colorSpaceConversion: 'default', preferAnimation: true });
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
      if (count === info.delays.length) {
        const canvas = offscreen(info.width, info.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('2D canvas is not available in this browser.');
        for (let i = 0; i < count; i += 1) {
          const { image } = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
          ctx.clearRect(0, 0, info.width, info.height);
          ctx.drawImage(image, 0, 0, info.width, info.height);
          image.close();
          await emit({ data: ctx.getImageData(0, 0, info.width, info.height).data, width: info.width, height: info.height });
        }
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
    } catch (err) {
      // The consumer's own errors (too large, cancelled) stop here; decoder errors fall through
      // to the decoders below, which skip frames already sent.
      if (sinkError) throw err;
    } finally {
      decoder.close();
    }
  }
  const done = index;
  index = 0;
  const skipSent = async (f: Frame) => {
    if (index >= done) await emit(f);
    else index += 1;
  };
  if (info.format === 'gif') await decodeGif(b, (f) => skipSent(f));
  else if (info.format === 'webp') await decodeWebpFallback(b, skipSent);
  else await decodeApngFallback(b, skipSent);
}

// ── Animated WebP writing ─────────────────────────────────────────────────

/** The image chunks (ALPH, VP8, VP8L) of an encoded still WebP. */
function imageChunks(webp: Uint8Array): Uint8Array {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const keep: Uint8Array[] = [];
  let o = 12;
  while (o + 8 <= webp.length) {
    const len = view.getUint32(o + 4, true);
    const end = Math.min(webp.length, o + 8 + len + (len & 1));
    if (['ALPH', 'VP8 ', 'VP8L'].includes(ascii(webp, o, 4))) keep.push(webp.subarray(o, end));
    o = end;
  }
  const out = new Uint8Array(keep.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of keep) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function anmf(x: number, y: number, w: number, h: number, duration: number, blend: boolean, frame: Uint8Array): Uint8Array {
  const size = 16 + frame.length;
  const out = new Uint8Array(8 + size + (size & 1));
  out.set([0x41, 0x4e, 0x4d, 0x46]);
  new DataView(out.buffer).setUint32(4, size, true);
  const put24 = (o: number, v: number) => out.set([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff], o);
  put24(8, x / 2);
  put24(11, y / 2);
  put24(14, w - 1);
  put24(17, h - 1);
  put24(20, Math.min(0xffffff, Math.max(0, Math.round(duration))));
  out[23] = blend ? 0 : 2; // bit 1: do not blend; disposal: none
  out.set(frame, 24);
  return out;
}

/**
 * Builds an animated WebP from full-canvas frames. Each frame after the first
 * stores only the rectangle that changed (on even coordinates, replacing
 * those pixels); `encode` turns RGBA into a still WebP with libwebp.
 */
export async function encodeAnimatedWebp(
  frames: readonly { data: Uint8ClampedArray; delay: number }[],
  width: number,
  height: number,
  plays: number,
  encode: (frame: Frame) => Promise<Uint8Array>,
  onProgress?: (f: number) => void,
): Promise<Uint8Array> {
  if (width > 16383 || height > 16383) {
    throw new Error('WebP images can be at most 16383 pixels wide or high. Resize first or choose another format.');
  }
  const parts: Uint8Array[] = [];
  let alpha = false;
  let prev: Uint32Array | null = null;
  for (const [i, frame] of frames.entries()) {
    const px = new Uint32Array(frame.data.buffer, frame.data.byteOffset, width * height);
    let rect = { x: 0, y: 0, w: width, h: height };
    if (prev) {
      const changed = changedRect(prev, px, width, height);
      const same = changed.w === 1 && changed.h === 1 && prev[0] === px[0];
      if (same) {
        // Nothing changed: a transparent pixel blended over the canvas keeps the timing.
        parts.push(anmf(0, 0, 1, 1, frame.delay, true, imageChunks(await encode({ data: new Uint8ClampedArray(4), width: 1, height: 1 }))));
        prev = px;
        onProgress?.((i + 1) / frames.length);
        continue;
      }
      const x = changed.x & ~1;
      const y = changed.y & ~1;
      rect = { x, y, w: changed.x + changed.w - x, h: changed.y + changed.h - y };
    }
    const sub = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let r = 0; r < rect.h; r += 1) {
      const start = ((rect.y + r) * width + rect.x) * 4;
      sub.set(frame.data.subarray(start, start + rect.w * 4), r * rect.w * 4);
    }
    for (let k = 3; k < sub.length && !alpha; k += 4) if ((sub[k] ?? 255) < 255) alpha = true;
    parts.push(anmf(rect.x, rect.y, rect.w, rect.h, frame.delay, false, imageChunks(await encode({ data: sub, width: rect.w, height: rect.h }))));
    prev = px;
    onProgress?.((i + 1) / frames.length);
  }
  const anim = new Uint8Array(14);
  anim.set([0x41, 0x4e, 0x49, 0x4d, 6, 0, 0, 0]);
  // Background colour (unused by browsers): transparent. Loop count.
  new DataView(anim.buffer).setUint16(12, Math.min(0xffff, plays), true);
  return riff([vp8x(width, height, 0x02 | (alpha ? 0x10 : 0)), anim, ...parts]);
}
