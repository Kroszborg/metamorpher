/**
 * EMF and WMF pictures cannot be drawn here (they are Windows drawing
 * commands). Many of them, though, are just a bitmap wrapped in a
 * metafile (pasted pictures, screenshots, OLE previews): this finds the
 * largest bitmap inside and returns it as a BMP, PNG or JPEG file, when it
 * covers most of the picture.
 */

export type MetafileKind = 'emf' | 'wmf';

export function metafileKind(b: Uint8Array): MetafileKind | null {
  if (b.length >= 44 && b[0] === 1 && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[40] === 0x20 && b[41] === 0x45 && b[42] === 0x4d && b[43] === 0x46) return 'emf';
  if (b.length >= 22 && b[0] === 0xd7 && b[1] === 0xcd && b[2] === 0xc6 && b[3] === 0x9a) return 'wmf';
  if (b.length >= 18 && (b[0] === 1 || b[0] === 2) && b[1] === 0 && b[2] === 9 && b[3] === 0) return 'wmf';
  return null;
}

/** A device-independent bitmap (BITMAPINFO + bits) as a .bmp file, or the embedded PNG/JPEG. */
function dibFile(info: Uint8Array, bits: Uint8Array): Uint8Array | null {
  if (info.length < 12) return null;
  const v = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const size = v.getUint32(0, true);
  if (size < 12 || size > info.length) return null;
  if (size >= 40) {
    const compression = v.getUint32(16, true);
    if (compression === 4 || compression === 5) return bits.slice(); // BI_JPEG / BI_PNG
    if (compression !== 0 && compression !== 1 && compression !== 2 && compression !== 3) return null;
  }
  const out = new Uint8Array(14 + info.length + bits.length);
  const o = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  o.setUint32(2, out.length, true);
  o.setUint32(10, 14 + info.length, true);
  out.set(info, 14);
  out.set(bits, 14 + info.length);
  return out;
}

/** Size of BITMAPINFO (header + colour table) at the start of a packed DIB. */
function infoSize(dib: Uint8Array): number {
  if (dib.length < 12) return 0;
  const v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const size = v.getUint32(0, true);
  if (size === 12) {
    const bpp = v.getUint16(10, true);
    return 12 + (bpp <= 8 ? (1 << bpp) * 3 : 0);
  }
  if (size < 40 || dib.length < 40) return 0;
  const bpp = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  const used = v.getUint32(32, true);
  const colours = used || (bpp <= 8 ? 1 << bpp : 0);
  return size + colours * 4 + (compression === 3 && size === 40 ? 12 : 0);
}

type Found = { file: Uint8Array; area: number };

function emfBitmaps(b: Uint8Array): { found: Found[]; area: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const boundsArea = (o: number) => Math.max(0, v.getInt32(o + 8, true) - v.getInt32(o, true) + 1) * Math.max(0, v.getInt32(o + 12, true) - v.getInt32(o + 4, true) + 1);
  const total = boundsArea(8);
  const found: Found[] = [];
  let off = 0;
  for (let guard = 0; off + 8 <= b.length && guard < 200000; guard++) {
    const type = v.getUint32(off, true);
    const size = v.getUint32(off + 4, true);
    if (size < 8 || off + size > b.length) break;
    // STRETCHDIBITS (81) and SETDIBITSTODEVICE (80): BITMAPINFO offsets at 48; BITBLT (76) and STRETCHBLT (77): at 84.
    const at = type === 81 || type === 80 ? 48 : type === 76 || type === 77 ? 84 : 0;
    if (at && size >= at + 16) {
      const offBmi = v.getUint32(off + at, true);
      const cbBmi = v.getUint32(off + at + 4, true);
      const offBits = v.getUint32(off + at + 8, true);
      const cbBits = v.getUint32(off + at + 12, true);
      if (cbBmi > 0 && cbBits > 0 && offBmi + cbBmi <= size && offBits + cbBits <= size) {
        const file = dibFile(b.subarray(off + offBmi, off + offBmi + cbBmi), b.subarray(off + offBits, off + offBits + cbBits));
        if (file) found.push({ file, area: boundsArea(off + 8) });
      }
    }
    if (type === 14) break; // EOF
    off += size;
  }
  return { found, area: total };
}

function wmfBitmaps(b: Uint8Array): Found[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = v.getUint32(0, true) === 0x9ac6cdd7 ? 22 : 0;
  off += v.getUint16(off + 2, true) * 2; // header size in words
  const found: Found[] = [];
  for (let guard = 0; off + 6 <= b.length && guard < 200000; guard++) {
    const words = v.getUint32(off, true);
    const fn = v.getUint16(off + 4, true);
    const size = words * 2;
    if (size < 6 || off + size > b.length) break;
    // STRETCHDIB (0x0F43): DIB at 28; DIBSTRETCHBLT (0x0B41): 26; DIBBITBLT (0x0940): 22.
    const at = fn === 0x0f43 ? 28 : fn === 0x0b41 ? 26 : fn === 0x0940 ? 22 : 0;
    if (at && size > at + 40) {
      const dib = b.subarray(off + at, off + size);
      const n = infoSize(dib);
      if (n > 0 && n < dib.length) {
        const file = dibFile(dib.subarray(0, n), dib.subarray(n));
        const dw = Math.abs(v.getInt16(off + at - 6, true));
        const dh = Math.abs(v.getInt16(off + at - 8, true));
        if (file) found.push({ file, area: dw * dh });
      }
    }
    if (fn === 0) break;
    off += size;
  }
  return found;
}

/** A PNG or JPEG stored whole inside the file (EMF+ pictures), the largest one. */
function embeddedImage(b: Uint8Array): Uint8Array | null {
  let best: Uint8Array | null = null;
  for (let i = 0; i + 8 < b.length; i++) {
    if (b[i] === 0x89 && b[i + 1] === 0x50 && b[i + 2] === 0x4e && b[i + 3] === 0x47 && b[i + 4] === 0x0d && b[i + 5] === 0x0a) {
      // Find IEND.
      for (let j = i + 8; j + 8 <= b.length; j++) {
        if (b[j] === 0x49 && b[j + 1] === 0x45 && b[j + 2] === 0x4e && b[j + 3] === 0x44) {
          const png = b.subarray(i, j + 8);
          if (!best || png.length > best.length) best = png;
          i = j;
          break;
        }
      }
    }
  }
  return best ? best.slice() : null;
}

/**
 * The bitmap a metafile shows, when it is essentially one picture; null for
 * vector drawings (charts, diagrams, clip art).
 */
export function rasterFromMetafile(bytes: Uint8Array): Uint8Array | null {
  const kind = metafileKind(bytes);
  if (!kind) return null;
  try {
    if (kind === 'emf') {
      const { found, area } = emfBitmaps(bytes);
      const best = found.sort((x, y) => y.area - x.area)[0];
      if (best && (area <= 0 || best.area >= area * 0.5)) return best.file;
      if (found.length === 0) return embeddedImage(bytes);
      return null;
    }
    const found = wmfBitmaps(bytes).sort((x, y) => y.area - x.area);
    return found[0]?.file ?? null;
  } catch {
    return null;
  }
}
