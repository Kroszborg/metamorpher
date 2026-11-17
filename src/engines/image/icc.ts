/**
 * Colour profiles: read the embedded ICC profile of a source image and embed
 * one into encoded JPEG, PNG and WebP files. Pure functions over bytes.
 *
 * The engine keeps a source's own profile when the output can carry it, so a
 * Display P3 or Adobe RGB photo is not squeezed into sRGB (the pixels stay in
 * the source's colour space and the profile travels with them). AVIF, BMP and
 * ICO outputs, and CMYK sources, are converted to sRGB instead.
 */
import { unzlibSync, zlibSync } from 'fflate';
import { readHeif } from './isobmff';
import { iccDescription, type SourceFormat } from './probe';
import type { CanvasFormat } from './types';

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i += 1) s += String.fromCharCode(b[o + i] ?? 0);
  return s;
};

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Output formats that can carry an ICC profile here. */
export const CAN_EMBED_ICC: Record<CanvasFormat, boolean> = {
  jpeg: true,
  png: true,
  webp: true,
  avif: false,
  gif: false,
  bmp: false,
  ico: false,
};

/** Whether a profile is (a variant of) sRGB, so keeping it changes nothing. */
export function isSrgbProfile(icc: Uint8Array): boolean {
  return /srgb/i.test(iccDescription(icc) ?? '');
}

/** The ICC profile's colour space signature ('RGB ', 'CMYK', 'GRAY'). */
export function iccColourSpace(icc: Uint8Array): string {
  return ascii(icc, 16, 4);
}

// ── Reading ───────────────────────────────────────────────────────────────

function jpegIcc(b: Uint8Array): Uint8Array | undefined {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: { seq: number; data: Uint8Array }[] = [];
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const marker = b[o + 1] ?? 0;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xd8) {
      o += 2;
      continue;
    }
    const len = view.getUint16(o + 2);
    if (marker === 0xe2 && ascii(b, o + 4, 12) === 'ICC_PROFILE\0') {
      parts.push({ seq: b[o + 16] ?? 0, data: b.subarray(o + 18, o + 2 + len) });
    }
    o += 2 + len;
  }
  if (!parts.length) return undefined;
  parts.sort((a, c) => a.seq - c.seq);
  return concat(parts.map((p) => p.data));
}

function pngIcc(b: Uint8Array): Uint8Array | undefined {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8;
  while (o + 12 <= b.length) {
    const len = view.getUint32(o);
    const type = ascii(b, o + 4, 4);
    if (type === 'iCCP') {
      const data = b.subarray(o + 8, o + 8 + len);
      const nul = data.indexOf(0);
      if (nul < 0) return undefined;
      try {
        return unzlibSync(data.subarray(nul + 2));
      } catch {
        return undefined;
      }
    }
    if (type === 'IDAT' || type === 'IEND') return undefined;
    o += 12 + len;
  }
  return undefined;
}

function webpIcc(b: Uint8Array): Uint8Array | undefined {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 12;
  while (o + 8 <= b.length) {
    const len = view.getUint32(o + 4, true);
    if (ascii(b, o, 4) === 'ICCP') return b.slice(o + 8, o + 8 + len);
    o += 8 + len + (len & 1);
  }
  return undefined;
}

/** The embedded ICC profile of a source image, if it has one. */
export function readIcc(b: Uint8Array, format: SourceFormat): Uint8Array | undefined {
  try {
    switch (format) {
      case 'jpeg':
        return jpegIcc(b);
      case 'png':
        return pngIcc(b);
      case 'webp':
        return webpIcc(b);
      case 'avif':
      case 'heic':
        return readHeif(b)?.icc;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

// ── Writing ───────────────────────────────────────────────────────────────

/** APP2 ICC_PROFILE segments right after SOI (and JFIF APP0 when present). */
function jpegWithIcc(b: Uint8Array, icc: Uint8Array): Uint8Array {
  const MAX = 65519; // 65535 − 2 (length) − 14 (signature, sequence, count)
  const count = Math.ceil(icc.length / MAX);
  if (count > 255) return b;
  const segments: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = icc.subarray(i * MAX, (i + 1) * MAX);
    const seg = new Uint8Array(4 + 14 + part.length);
    const len = 2 + 14 + part.length;
    seg.set([0xff, 0xe2, len >> 8, len & 0xff]);
    for (let k = 0; k < 12; k += 1) seg[4 + k] = 'ICC_PROFILE\0'.charCodeAt(k);
    seg[16] = i + 1;
    seg[17] = count;
    seg.set(part, 18);
    segments.push(seg);
  }
  let at = 2;
  if (b[2] === 0xff && b[3] === 0xe0) at = 4 + (((b[4] ?? 0) << 8) | (b[5] ?? 0));
  return concat([b.subarray(0, at), ...segments, b.subarray(at)]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i += 1) c = (CRC_TABLE[(c ^ (out[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}

/** iCCP right after IHDR; drops sRGB/gAMA/cHRM/iCCP chunks that would contradict it. */
function pngWithIcc(b: Uint8Array, icc: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const profile = zlibSync(icc);
  const body = new Uint8Array(5 + profile.length);
  body.set([0x69, 0x63, 0x63, 0, 0]); // "icc", NUL, compression method 0
  body.set(profile, 5);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = view.getUint32(o);
    const type = ascii(b, o + 4, 4);
    const end = o + 12 + len;
    if (!['sRGB', 'gAMA', 'cHRM', 'iCCP', 'cICP'].includes(type)) parts.push(b.subarray(o, end));
    if (type === 'IHDR') parts.push(pngChunk('iCCP', body));
    o = end;
  }
  return concat(parts);
}

/** WebP: converts a simple file to the extended (VP8X) layout if needed and adds ICCP. */
function webpWithIcc(b: Uint8Array, icc: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunks: { type: string; raw: Uint8Array }[] = [];
  let o = 12;
  while (o + 8 <= b.length) {
    const len = view.getUint32(o + 4, true);
    const end = Math.min(b.length, o + 8 + len + (len & 1));
    chunks.push({ type: ascii(b, o, 4), raw: b.slice(o, end) });
    o = end;
  }
  const first = chunks[0];
  if (!first) return b;
  let vp8x: Uint8Array;
  if (first.type === 'VP8X') {
    vp8x = first.raw;
    chunks.shift();
  } else {
    // Canvas size and alpha from the single image chunk.
    const d = first.raw;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let w = 0;
    let h = 0;
    let alpha = false;
    if (first.type === 'VP8 ') {
      w = dv.getUint16(8 + 6, true) & 0x3fff;
      h = dv.getUint16(8 + 8, true) & 0x3fff;
    } else if (first.type === 'VP8L') {
      const bits = dv.getUint32(8 + 1, true);
      w = (bits & 0x3fff) + 1;
      h = ((bits >> 14) & 0x3fff) + 1;
      alpha = ((bits >> 28) & 1) === 1;
    } else {
      return b;
    }
    vp8x = new Uint8Array(18);
    vp8x.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]);
    vp8x[8] = alpha ? 0x10 : 0;
    const cw = w - 1;
    const ch = h - 1;
    vp8x.set([cw & 0xff, (cw >> 8) & 0xff, (cw >> 16) & 0xff, ch & 0xff, (ch >> 8) & 0xff, (ch >> 16) & 0xff], 12);
  }
  vp8x[8] = (vp8x[8] ?? 0) | 0x20;
  const iccp = new Uint8Array(8 + icc.length + (icc.length & 1));
  iccp.set([0x49, 0x43, 0x43, 0x50]);
  new DataView(iccp.buffer).setUint32(4, icc.length, true);
  iccp.set(icc, 8);
  const rest = chunks.filter((c) => c.type !== 'ICCP').map((c) => c.raw);
  const body = concat([vp8x, iccp, ...rest]);
  const out = new Uint8Array(12 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(body, 12);
  return out;
}

/** Embeds `icc` into an encoded file. Formats that cannot carry one are returned unchanged. */
export function embedIcc(bytes: Uint8Array, format: CanvasFormat, icc: Uint8Array): Uint8Array {
  switch (format) {
    case 'jpeg':
      return jpegWithIcc(bytes, icc);
    case 'png':
      return pngWithIcc(bytes, icc);
    case 'webp':
      return webpWithIcc(bytes, icc);
    default:
      return bytes;
  }
}
