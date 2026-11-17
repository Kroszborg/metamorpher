/**
 * Reads an image's format, size, orientation and a few traits from its header
 * bytes, without decoding pixels. Used for pixel limits, UI readouts and to
 * pick a decoder.
 */
import { exifOrientation } from './exif';
import { readHeif } from './isobmff';

export type SourceFormat =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'avif'
  | 'heic'
  | 'ico'
  | 'tiff'
  | 'svg'
  | 'unknown';

export type ImageProbe = {
  format: SourceFormat;
  /** Displayed size (after EXIF/HEIF rotation). 0 when unknown. */
  width: number;
  height: number;
  /** EXIF orientation, 1–8 (1 also when there is none). */
  orientation: number;
  animated: boolean;
  /** Frame count for GIF/WebP/APNG when animated. */
  frames?: number;
  /** Whether the format declares an alpha channel (may still be fully opaque). */
  alpha: boolean;
  /** JPEG with four colour components (CMYK/YCCK). */
  cmyk: boolean;
  /** An embedded ICC profile, when one is present. */
  iccDescription?: string;
};

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = 0; i < n; i += 1) s += String.fromCharCode(b[o + i] ?? 0);
  return s;
};

/** The profile description ('desc' or 'mluc') of an ICC profile. */
export function iccDescription(icc: Uint8Array): string | undefined {
  if (icc.length < 132) return undefined;
  const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const count = view.getUint32(128);
  for (let i = 0; i < count && 132 + i * 12 + 12 <= icc.length; i += 1) {
    const t = 132 + i * 12;
    if (ascii(icc, t, 4) !== 'desc') continue;
    const off = view.getUint32(t + 4);
    const len = view.getUint32(t + 8);
    if (off + len > icc.length || len < 12) return undefined;
    const type = ascii(icc, off, 4);
    if (type === 'desc') {
      const n = view.getUint32(off + 8);
      return ascii(icc, off + 12, Math.max(0, Math.min(n, len - 12) - 1)).trim() || undefined;
    }
    if (type === 'mluc') {
      const recLen = view.getUint32(off + 12);
      if (view.getUint32(off + 8) < 1 || recLen < 12) return undefined;
      const sLen = view.getUint32(off + 20);
      const sOff = view.getUint32(off + 24);
      const start = off + sOff;
      if (start + sLen > icc.length) return undefined;
      let s = '';
      for (let k = 0; k + 1 < sLen; k += 2) s += String.fromCharCode(view.getUint16(start + k));
      return s.replace(/\0+$/, '').trim() || undefined;
    }
  }
  return undefined;
}

function swapForOrientation(w: number, h: number, orientation: number): [number, number] {
  return orientation >= 5 ? [h, w] : [w, h];
}

function probeJpeg(b: Uint8Array, view: DataView): ImageProbe {
  const p: ImageProbe = { format: 'jpeg', width: 0, height: 0, orientation: 1, animated: false, alpha: false, cmyk: false };
  let o = 2;
  const iccParts: Uint8Array[] = [];
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) break;
    const marker = b[o + 1] ?? 0;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    const len = view.getUint16(o + 2);
    const data = o + 4;
    if (marker === 0xe1 && ascii(b, data, 6) === 'Exif\0\0') {
      p.orientation = exifOrientation(b.subarray(data + 6, o + 2 + len));
    } else if (marker === 0xe2 && ascii(b, data, 12) === 'ICC_PROFILE\0') {
      iccParts.push(b.subarray(data + 14, o + 2 + len));
    } else if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      p.height = view.getUint16(data + 1);
      p.width = view.getUint16(data + 3);
      p.cmyk = b[data + 5] === 4;
    } else if (marker === 0xda || marker === 0xd9) {
      break;
    }
    o += 2 + len;
  }
  if (iccParts.length) {
    const total = iccParts.reduce((n, x) => n + x.length, 0);
    const icc = new Uint8Array(total);
    let at = 0;
    for (const part of iccParts) {
      icc.set(part, at);
      at += part.length;
    }
    p.iccDescription = iccDescription(icc);
  }
  [p.width, p.height] = swapForOrientation(p.width, p.height, p.orientation);
  return p;
}

function probePng(b: Uint8Array, view: DataView): ImageProbe {
  const colourType = b[25] ?? 0;
  const p: ImageProbe = {
    format: 'png',
    width: view.getUint32(16),
    height: view.getUint32(20),
    orientation: 1,
    animated: false,
    alpha: colourType === 4 || colourType === 6,
    cmyk: false,
  };
  let o = 8;
  while (o + 12 <= b.length) {
    const len = view.getUint32(o);
    const type = ascii(b, o + 4, 4);
    if (type === 'tRNS') p.alpha = true;
    else if (type === 'acTL') {
      const frames = view.getUint32(o + 8);
      p.animated = frames > 1;
      p.frames = frames;
    } else if (type === 'eXIf') p.orientation = exifOrientation(b.subarray(o + 8, o + 8 + len));
    else if (type === 'iCCP') {
      let e = o + 8;
      while (e < o + 8 + len && b[e] !== 0) e += 1;
      p.iccDescription = new TextDecoder('latin1').decode(b.subarray(o + 8, e)) || undefined;
    } else if (type === 'IDAT' || type === 'IEND') {
      if (!p.animated && type === 'IEND') break;
    }
    o += 12 + len;
  }
  [p.width, p.height] = swapForOrientation(p.width, p.height, p.orientation);
  return p;
}

function probeGif(b: Uint8Array, view: DataView): ImageProbe {
  const p: ImageProbe = {
    format: 'gif',
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
    orientation: 1,
    animated: false,
    alpha: false,
    cmyk: false,
  };
  let o = 13;
  const flags = b[10] ?? 0;
  if (flags & 0x80) o += 3 * (1 << ((flags & 7) + 1));
  let frames = 0;
  const skipSubBlocks = (at: number) => {
    let x = at;
    while (x < b.length && b[x] !== 0) x += (b[x] ?? 0) + 1;
    return x + 1;
  };
  while (o < b.length) {
    const intro = b[o];
    if (intro === 0x2c) {
      frames += 1;
      const f = b[o + 9] ?? 0;
      o += 10;
      if (f & 0x80) o += 3 * (1 << ((f & 7) + 1));
      o = skipSubBlocks(o + 1); // LZW minimum code size, then data
    } else if (intro === 0x21) {
      if (b[o + 1] === 0xf9 && ((b[o + 3] ?? 0) & 1)) p.alpha = true;
      o = skipSubBlocks(o + 2);
    } else {
      break;
    }
  }
  p.frames = frames;
  p.animated = frames > 1;
  return p;
}

function probeWebp(b: Uint8Array, view: DataView): ImageProbe {
  const p: ImageProbe = { format: 'webp', width: 0, height: 0, orientation: 1, animated: false, alpha: false, cmyk: false };
  let o = 12;
  let frames = 0;
  while (o + 8 <= b.length) {
    const type = ascii(b, o, 4);
    const len = view.getUint32(o + 4, true);
    const d = o + 8;
    if (type === 'VP8X') {
      const flags = b[d] ?? 0;
      p.alpha = (flags & 0x10) !== 0;
      p.animated = (flags & 0x02) !== 0;
      p.width = 1 + ((b[d + 4] ?? 0) | ((b[d + 5] ?? 0) << 8) | ((b[d + 6] ?? 0) << 16));
      p.height = 1 + ((b[d + 7] ?? 0) | ((b[d + 8] ?? 0) << 8) | ((b[d + 9] ?? 0) << 16));
    } else if (type === 'VP8 ' && !p.width) {
      p.width = view.getUint16(d + 6, true) & 0x3fff;
      p.height = view.getUint16(d + 8, true) & 0x3fff;
    } else if (type === 'VP8L' && !p.width) {
      const bits = view.getUint32(d + 1, true);
      p.width = (bits & 0x3fff) + 1;
      p.height = ((bits >> 14) & 0x3fff) + 1;
      p.alpha = ((bits >> 28) & 1) === 1;
    } else if (type === 'ANMF') {
      frames += 1;
    } else if (type === 'EXIF') {
      let start = d;
      if (ascii(b, d, 6) === 'Exif\0\0') start += 6;
      p.orientation = exifOrientation(b.subarray(start, d + len));
    }
    o = d + len + (len & 1);
  }
  if (p.animated) p.frames = frames;
  return p;
}

function probeTiff(b: Uint8Array, view: DataView): ImageProbe {
  const le = b[0] === 0x49;
  const p: ImageProbe = { format: 'tiff', width: 0, height: 0, orientation: 1, animated: false, alpha: false, cmyk: false };
  const ifd = view.getUint32(4, le);
  if (ifd + 2 > b.length) return p;
  const n = view.getUint16(ifd, le);
  for (let i = 0; i < n; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = view.getUint16(e, le);
    const type = view.getUint16(e + 2, le);
    const v = type === 3 ? view.getUint16(e + 8, le) : view.getUint32(e + 8, le);
    if (tag === 256) p.width = v;
    else if (tag === 257) p.height = v;
    else if (tag === 274) p.orientation = v >= 1 && v <= 8 ? v : 1;
    else if (tag === 262) p.cmyk = v === 5;
    else if (tag === 338) p.alpha = true;
  }
  [p.width, p.height] = swapForOrientation(p.width, p.height, p.orientation);
  return p;
}

/** Identifies an image from its bytes. Never throws; unknown input gives format 'unknown'. */
export function probeImage(b: Uint8Array): ImageProbe {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const unknown: ImageProbe = { format: 'unknown', width: 0, height: 0, orientation: 1, animated: false, alpha: false, cmyk: false };
  try {
    if (b.length < 12) return unknown;
    if (b[0] === 0xff && b[1] === 0xd8) return probeJpeg(b, view);
    if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return probePng(b, view);
    if (ascii(b, 0, 4) === 'GIF8') return probeGif(b, view);
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return probeWebp(b, view);
    if (b[0] === 0x42 && b[1] === 0x4d) {
      return {
        format: 'bmp',
        width: Math.abs(view.getInt32(18, true)),
        height: Math.abs(view.getInt32(22, true)),
        orientation: 1,
        animated: false,
        alpha: view.getUint16(28, true) === 32,
        cmyk: false,
      };
    }
    if (view.getUint16(0, true) === 0 && view.getUint16(2, true) === 1) {
      const count = view.getUint16(4, true);
      let w = 0;
      let h = 0;
      for (let i = 0; i < count; i += 1) {
        const e = 6 + i * 16;
        if (e + 16 > b.length) break;
        w = Math.max(w, b[e] || 256);
        h = Math.max(h, b[e + 1] || 256);
      }
      return { format: 'ico', width: w, height: h, orientation: 1, animated: false, alpha: true, cmyk: false };
    }
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42)) {
      return probeTiff(b, view);
    }
    if (ascii(b, 4, 4) === 'ftyp') {
      const heif = readHeif(b);
      if (!heif) return unknown;
      return {
        format: heif.brand === 'avif' ? 'avif' : 'heic',
        width: heif.width,
        height: heif.height,
        orientation: 1,
        animated: heif.sequence,
        alpha: heif.hasAlpha,
        cmyk: false,
        iccDescription: heif.icc ? iccDescription(heif.icc) : undefined,
      };
    }
    const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).toLowerCase();
    if (head.includes('<svg')) return { ...unknown, format: 'svg' };
  } catch {
    return unknown;
  }
  return unknown;
}
