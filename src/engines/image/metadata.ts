/**
 * Finds and removes metadata (EXIF, GPS, XMP, IPTC, comments) without
 * touching the compressed pixel data, so stripping is lossless:
 *
 * - JPEG: drops APP1 (EXIF/XMP), APP3–APP13, APP15, COM, non-ICC APP2 (MPF)
 *   and anything after the end-of-image marker (secondary images such as depth
 *   or gain maps). Keeps JFIF, the ICC profile and Adobe APP14 (needed to
 *   decode CMYK correctly). The entropy-coded scans are copied byte for byte.
 * - PNG: drops eXIf, tEXt, zTXt, iTXt and tIME chunks.
 * - WebP: drops EXIF, XMP and unknown chunks and clears the VP8X flags.
 * - GIF: drops comment and non-animation application extensions.
 * - AVIF/HEIC: zeroes the Exif and XMP items in place and marks them hidden
 *   under an unknown item type; offsets and the image items are unchanged.
 *
 * When the EXIF orientation is not 1, a minimal EXIF block holding only
 * Orientation is written back so the photo still displays upright.
 */
import { type ExifSummary, orientationOnlyExif, readExif } from './exif';
import { readHeif } from './isobmff';
import { iccDescription, probeImage, type SourceFormat } from './probe';

export type MetadataReport = {
  format: SourceFormat;
  /** Stripping is supported for this format. */
  supported: boolean;
  exif?: ExifSummary;
  xmp: boolean;
  /** XMP text mentions a GPS position. */
  xmpGps: boolean;
  iptc: boolean;
  comments: string[];
  /** PNG text chunks and similar key/value pairs. */
  text: { key: string; value: string }[];
  /** Embedded colour profile (kept when stripping). */
  icc?: string;
  /** Bytes after the end of the image (JPEG secondary images, junk). */
  trailingBytes: number;
  /** Other metadata blocks that will be removed, described for people. */
  other: string[];
};

export type StripResult = {
  bytes: Uint8Array;
  removed: string[];
  /** Orientation written back as a minimal EXIF block (only when not 1). */
  keptOrientation?: number;
};

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i += 1) s += String.fromCharCode(b[o + i] ?? 0);
  return s;
};
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
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

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = (CRC_TABLE[(c ^ (b[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function emptyReport(format: SourceFormat, supported: boolean): MetadataReport {
  return { format, supported, xmp: false, xmpGps: false, iptc: false, comments: [], text: [], trailingBytes: 0, other: [] };
}

const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXT_SIG = 'http://ns.adobe.com/xmp/extension/\0';

function noteXmp(report: MetadataReport, text: string) {
  report.xmp = true;
  if (/GPSLatitude|GPSLongitude/i.test(text)) report.xmpGps = true;
}

// ── JPEG ──────────────────────────────────────────────────────────────────

type Segment = { marker: number; start: number; end: number };

function jpegSegments(b: Uint8Array): { segments: Segment[]; eoi: number } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const segments: Segment[] = [];
  let o = 2;
  while (o + 1 < b.length) {
    if (b[o] !== 0xff) throw new Error('This JPEG is damaged (unexpected data between segments).');
    const marker = b[o + 1] ?? 0;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd9) return { segments, eoi: o + 2 };
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ marker, start: o, end: o + 2 });
      o += 2;
      continue;
    }
    if (o + 4 > b.length) break;
    const seg: Segment = { marker, start: o, end: o + 2 + view.getUint16(o + 2) };
    if (marker === 0xda) {
      // Entropy-coded data runs until the next marker that is not a stuffed 0x00 or a restart.
      let p = seg.end;
      while (p + 1 < b.length) {
        if (b[p] === 0xff) {
          const m = b[p + 1] ?? 0;
          if (m !== 0x00 && !(m >= 0xd0 && m <= 0xd7) && m !== 0xff) break;
        }
        p += 1;
      }
      seg.end = p;
    }
    if (seg.end > b.length) throw new Error('This JPEG is truncated.');
    segments.push(seg);
    o = seg.end;
  }
  return { segments, eoi: b.length };
}

function jpegReport(b: Uint8Array): MetadataReport {
  const r = emptyReport('jpeg', true);
  const { segments, eoi } = jpegSegments(b);
  r.trailingBytes = Math.max(0, b.length - eoi);
  const iccParts: Uint8Array[] = [];
  const others = new Set<string>();
  for (const s of segments) {
    const d = s.start + 4;
    const body = b.subarray(d, s.end);
    if (s.marker === 0xe1) {
      if (ascii(b, d, 6) === 'Exif\0\0') r.exif = readExif(body.subarray(6)) ?? r.exif;
      else if (ascii(b, d, XMP_SIG.length) === XMP_SIG) noteXmp(r, utf8(body.subarray(XMP_SIG.length)));
      else if (ascii(b, d, XMP_EXT_SIG.length) === XMP_EXT_SIG) noteXmp(r, utf8(body.subarray(XMP_EXT_SIG.length)));
      else others.add('APP1 block');
    } else if (s.marker === 0xe2) {
      if (ascii(b, d, 12) === 'ICC_PROFILE\0') iccParts.push(body.subarray(14));
      else if (ascii(b, d, 4) === 'MPF\0') others.add('Multi-picture index (MPF)');
      else others.add('APP2 block');
    } else if (s.marker === 0xed) {
      r.iptc = true;
    } else if (s.marker === 0xfe) {
      const c = latin1(body).replace(/\0+$/, '').trim();
      if (c) r.comments.push(c);
    } else if (s.marker === 0xe0) {
      if (ascii(b, d, 5) === 'JFXX\0') others.add('JFIF thumbnail');
    } else if (s.marker >= 0xe3 && s.marker <= 0xef && s.marker !== 0xee) {
      const id = ascii(b, d, 16).replace(/\0.*$/s, '').trim();
      others.add(id ? `APP${s.marker - 0xe0} (${id})` : `APP${s.marker - 0xe0} block`);
    }
  }
  if (iccParts.length) r.icc = iccDescription(concat(iccParts)) ?? 'Embedded profile';
  r.other = [...others];
  return r;
}

function jpegStrip(b: Uint8Array, keepIcc: boolean): StripResult {
  const report = jpegReport(b);
  const { segments, eoi } = jpegSegments(b);
  const removed = new Set<string>();
  const jfifPart: Uint8Array[] = [];
  const head: Uint8Array[] = [];
  const rest: Uint8Array[] = [];
  let seenFrame = false;
  for (const s of segments) {
    const d = s.start + 4;
    const raw = b.subarray(s.start, s.end);
    const isApp = s.marker >= 0xe0 && s.marker <= 0xef;
    if (!isApp && s.marker !== 0xfe) {
      seenFrame = true;
      rest.push(raw);
      continue;
    }
    let keep = false;
    if (s.marker === 0xe0 && ascii(b, d, 5) === 'JFIF\0') {
      // Keep JFIF but drop its optional embedded thumbnail.
      const jfif = b.slice(s.start, Math.min(s.end, s.start + 18));
      if (jfif.length === 18) {
        jfif[2] = 0;
        jfif[3] = 16;
        jfif[16] = 0;
        jfif[17] = 0;
        (seenFrame ? rest : jfifPart).push(jfif);
      }
      continue;
    }
    if (s.marker === 0xe2 && ascii(b, d, 12) === 'ICC_PROFILE\0') keep = keepIcc;
    if (s.marker === 0xee && ascii(b, d, 5) === 'Adobe') keep = true;
    if (keep) {
      (seenFrame ? rest : head).push(raw);
      continue;
    }
    if (s.marker === 0xe1) removed.add(ascii(b, d, 6) === 'Exif\0\0' ? 'EXIF' : 'XMP');
    else if (s.marker === 0xed) removed.add('IPTC / Photoshop');
    else if (s.marker === 0xfe) removed.add('Comment');
    else if (s.marker === 0xe2 && ascii(b, d, 12) === 'ICC_PROFILE\0') removed.add('Colour profile');
    else if (s.marker === 0xe2 && ascii(b, d, 4) === 'MPF\0') removed.add('Multi-picture index');
    else removed.add(`APP${s.marker - 0xe0}`);
  }
  if (b.length > eoi) removed.add('Data after the image (secondary images)');

  const orientation = report.exif?.orientation ?? 1;
  // JFIF first, then the orientation-only EXIF, then the kept ICC/Adobe blocks.
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8]), ...jfifPart];
  if (orientation !== 1) {
    const tiff = orientationOnlyExif(orientation);
    const len = 2 + 6 + tiff.length;
    const app1 = new Uint8Array(2 + len);
    app1.set([0xff, 0xe1, len >> 8, len & 0xff]);
    app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
    app1.set(tiff, 10);
    parts.push(app1);
  }
  parts.push(...head, ...rest, new Uint8Array([0xff, 0xd9]));
  return {
    bytes: concat(parts),
    removed: [...removed],
    keptOrientation: orientation !== 1 ? orientation : undefined,
  };
}

// ── PNG ───────────────────────────────────────────────────────────────────

type Chunk = { type: string; start: number; end: number; data: Uint8Array };

function pngChunks(b: Uint8Array): Chunk[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = view.getUint32(o);
    const type = ascii(b, o + 4, 4);
    const end = o + 12 + len;
    if (end > b.length) throw new Error('This PNG is truncated.');
    out.push({ type, start: o, end, data: b.subarray(o + 8, o + 8 + len) });
    o = end;
    if (type === 'IEND') break;
  }
  return out;
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function pngReport(b: Uint8Array): MetadataReport {
  const r = emptyReport('png', true);
  const chunks = pngChunks(b);
  const last = chunks[chunks.length - 1];
  r.trailingBytes = last ? b.length - last.end : 0;
  for (const c of chunks) {
    if (c.type === 'eXIf') {
      const t = ascii(c.data, 0, 6) === 'Exif\0\0' ? c.data.subarray(6) : c.data;
      r.exif = readExif(t) ?? r.exif;
    } else if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') {
      const nul = c.data.indexOf(0);
      const key = latin1(c.data.subarray(0, Math.max(0, nul)));
      if (key === 'XML:com.adobe.xmp') {
        noteXmp(r, utf8(c.data));
        continue;
      }
      let value = '(compressed text)';
      if (c.type === 'tEXt') value = latin1(c.data.subarray(nul + 1));
      else if (c.type === 'iTXt' && c.data[nul + 1] === 0) {
        // Uncompressed iTXt: keyword\0 flag method lang\0 translated\0 text
        let p = nul + 3;
        p = c.data.indexOf(0, p) + 1;
        p = c.data.indexOf(0, p) + 1;
        value = utf8(c.data.subarray(p));
      }
      r.text.push({ key, value: value.slice(0, 200) });
    } else if (c.type === 'tIME') {
      r.other.push('Modification time (tIME)');
    } else if (c.type === 'iCCP') {
      r.icc = latin1(c.data.subarray(0, Math.max(0, c.data.indexOf(0)))) || 'Embedded profile';
    }
  }
  return r;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function pngStrip(b: Uint8Array, keepIcc: boolean): StripResult {
  const report = pngReport(b);
  const removed = new Set<string>();
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const orientation = report.exif?.orientation ?? 1;
  let wroteExif = false;
  for (const c of pngChunks(b)) {
    if (c.type === 'iCCP' && !keepIcc) {
      removed.add('Colour profile');
      continue;
    }
    if (PNG_DROP.has(c.type)) {
      removed.add(c.type === 'eXIf' ? 'EXIF' : c.type === 'tIME' ? 'Modification time' : 'Text');
      continue;
    }
    if (c.type === 'IDAT' && orientation !== 1 && !wroteExif) {
      parts.push(pngChunk('eXIf', orientationOnlyExif(orientation)));
      wroteExif = true;
    }
    parts.push(b.subarray(c.start, c.end));
  }
  if (report.trailingBytes) removed.add('Data after the image');
  return { bytes: concat(parts), removed: [...removed], keptOrientation: wroteExif ? orientation : undefined };
}

// ── WebP ──────────────────────────────────────────────────────────────────

const WEBP_KEEP = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function webpChunks(b: Uint8Array): Chunk[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  const end = Math.min(b.length, 8 + view.getUint32(4, true));
  let o = 12;
  while (o + 8 <= end) {
    const len = view.getUint32(o + 4, true);
    const next = o + 8 + len + (len & 1);
    out.push({ type: ascii(b, o, 4), start: o, end: Math.min(next, b.length), data: b.subarray(o + 8, o + 8 + len) });
    o = next;
  }
  return out;
}

function webpReport(b: Uint8Array): MetadataReport {
  const r = emptyReport('webp', true);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  r.trailingBytes = Math.max(0, b.length - (8 + view.getUint32(4, true)));
  for (const c of webpChunks(b)) {
    if (c.type === 'EXIF') {
      const t = ascii(c.data, 0, 6) === 'Exif\0\0' ? c.data.subarray(6) : c.data;
      r.exif = readExif(t) ?? r.exif;
    } else if (c.type === 'XMP ') noteXmp(r, utf8(c.data));
    else if (c.type === 'ICCP') r.icc = iccDescription(c.data) ?? 'Embedded profile';
    else if (!WEBP_KEEP.has(c.type)) r.other.push(`Unknown chunk "${c.type.trim()}"`);
  }
  return r;
}

function webpStrip(b: Uint8Array, keepIcc: boolean): StripResult {
  const report = webpReport(b);
  const removed = new Set<string>();
  const orientation = report.exif?.orientation ?? 1;
  const kept: Uint8Array[] = [];
  let vp8x: Uint8Array | null = null;
  for (const c of webpChunks(b)) {
    if (c.type === 'ICCP' && !keepIcc) {
      removed.add('Colour profile');
      continue;
    }
    if (!WEBP_KEEP.has(c.type)) {
      removed.add(c.type === 'EXIF' ? 'EXIF' : c.type === 'XMP ' ? 'XMP' : `Chunk ${c.type.trim()}`);
      continue;
    }
    const raw = b.slice(c.start, c.end);
    if (c.type === 'VP8X') vp8x = raw;
    kept.push(raw);
  }
  if (orientation !== 1 && vp8x) {
    const tiff = orientationOnlyExif(orientation);
    const chunk = new Uint8Array(8 + tiff.length);
    chunk.set([0x45, 0x58, 0x49, 0x46]);
    new DataView(chunk.buffer).setUint32(4, tiff.length, true);
    chunk.set(tiff, 8);
    kept.push(chunk);
  }
  if (vp8x) {
    // Flags: ICC 0x20, alpha 0x10, EXIF 0x08, XMP 0x04, animation 0x02.
    let flags = (vp8x[8] ?? 0) & ~(0x08 | 0x04);
    if (!keepIcc) flags &= ~0x20;
    if (orientation !== 1) flags |= 0x08;
    vp8x[8] = flags;
  }
  const body = concat(kept);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  if (report.trailingBytes) removed.add('Data after the image');
  return { bytes: out, removed: [...removed], keptOrientation: orientation !== 1 && vp8x ? orientation : undefined };
}

// ── GIF ───────────────────────────────────────────────────────────────────

const GIF_KEEP_APPS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0', 'ICCRGBG1012']);

function gifWalk(b: Uint8Array, onBlock: (kind: 'keep' | 'comment' | 'app', start: number, end: number, label: string) => void): number {
  let o = 13;
  const flags = b[10] ?? 0;
  if (flags & 0x80) o += 3 * (1 << ((flags & 7) + 1));
  const sub = (at: number) => {
    let x = at;
    while (x < b.length && b[x] !== 0) x += (b[x] ?? 0) + 1;
    return Math.min(b.length, x + 1);
  };
  while (o < b.length) {
    const intro = b[o];
    const start = o;
    if (intro === 0x2c) {
      const f = b[o + 9] ?? 0;
      o += 10;
      if (f & 0x80) o += 3 * (1 << ((f & 7) + 1));
      o = sub(o + 1);
      onBlock('keep', start, o, 'image');
    } else if (intro === 0x21) {
      const label = b[o + 1];
      if (label === 0xfe) {
        o = sub(o + 2);
        onBlock('comment', start, o, latin1(b.subarray(start + 3, Math.max(start + 3, o - 1))));
      } else if (label === 0xff) {
        const id = ascii(b, o + 3, 11);
        o = sub(o + 2);
        onBlock(GIF_KEEP_APPS.has(id) ? 'keep' : 'app', start, o, id);
      } else {
        o = sub(o + 2);
        onBlock('keep', start, o, 'extension');
      }
    } else if (intro === 0x3b) {
      return o + 1;
    } else {
      throw new Error('This GIF is damaged.');
    }
  }
  return b.length;
}

function gifReport(b: Uint8Array): MetadataReport {
  const r = emptyReport('gif', true);
  const end = gifWalk(b, (kind, _s, _e, label) => {
    if (kind === 'comment') r.comments.push(label.replace(/[\0-\x08\x0b-\x1f]/g, '').trim());
    if (kind === 'app') {
      if (label.startsWith('XMP Data')) r.xmp = true;
      else r.other.push(`Application block "${label.trim()}"`);
    }
  });
  r.trailingBytes = b.length - end;
  return r;
}

function gifStrip(b: Uint8Array): StripResult {
  const removed = new Set<string>();
  let o = 13;
  const flags = b[10] ?? 0;
  if (flags & 0x80) o += 3 * (1 << ((flags & 7) + 1));
  const parts: Uint8Array[] = [b.subarray(0, o)];
  const end = gifWalk(b, (kind, s, e, label) => {
    if (kind === 'keep') parts.push(b.subarray(s, e));
    else removed.add(kind === 'comment' ? 'Comment' : label.startsWith('XMP Data') ? 'XMP' : 'Application data');
  });
  parts.push(new Uint8Array([0x3b]));
  if (end < b.length) removed.add('Data after the image');
  return { bytes: concat(parts), removed: [...removed] };
}

// ── HEIF / AVIF ───────────────────────────────────────────────────────────

function heifMetaItems(b: Uint8Array) {
  const info = readHeif(b);
  if (!info) throw new Error('Could not read this HEIF/AVIF file.');
  const isXmp = (t?: string) => !!t && /rdf\+xml|xmp/i.test(t);
  const exif = info.items.filter((i) => i.type === 'Exif');
  const xmp = info.items.filter((i) => i.type === 'mime' && isXmp(i.contentType));
  return { info, exif, xmp };
}

function heifReport(b: Uint8Array, format: SourceFormat): MetadataReport {
  const r = emptyReport(format, true);
  const { info, exif, xmp } = heifMetaItems(b);
  for (const item of exif) {
    const ext = item.extents[0];
    if (!ext || ext.offset + ext.length > b.length) continue;
    const payload = b.subarray(ext.offset, ext.offset + ext.length);
    if (payload.length < 4) continue;
    const skip = new DataView(payload.buffer, payload.byteOffset).getUint32(0);
    r.exif = readExif(payload.subarray(4 + skip)) ?? r.exif;
  }
  for (const item of xmp) {
    const ext = item.extents[0];
    if (ext && ext.offset + ext.length <= b.length) noteXmp(r, utf8(b.subarray(ext.offset, ext.offset + ext.length)));
  }
  if (info.icc) r.icc = iccDescription(info.icc) ?? 'Embedded profile';
  return r;
}

function heifStrip(b: Uint8Array): StripResult {
  const out = b.slice();
  const { exif, xmp } = heifMetaItems(out);
  const removed = new Set<string>();
  for (const item of [...exif, ...xmp]) {
    for (const ext of item.extents) {
      if (ext.offset + ext.length <= out.length) out.fill(0, ext.offset, ext.offset + ext.length);
    }
    // Unknown item type, flagged hidden: readers skip it.
    out.set([0x7a, 0x65, 0x72, 0x6f], item.typeOffset); // 'zero'
    out[item.flagsOffset + 2] = (out[item.flagsOffset + 2] ?? 0) | 1;
    removed.add(item.type === 'Exif' ? 'EXIF' : 'XMP');
  }
  return { bytes: out, removed: [...removed] };
}

// ── EXIF for copying into a converted file ───────────────────────────────

/** The source's EXIF as a TIFF-structured block (without the "Exif\0\0" prefix), if any. */
export function sourceExif(b: Uint8Array): Uint8Array | undefined {
  const { format } = probeImage(b);
  const strip = (d: Uint8Array) => (ascii(d, 0, 6) === 'Exif\0\0' ? d.subarray(6) : d);
  try {
    if (format === 'jpeg') {
      for (const s of jpegSegments(b).segments) {
        if (s.marker === 0xe1 && ascii(b, s.start + 4, 6) === 'Exif\0\0') return b.subarray(s.start + 10, s.end);
      }
    } else if (format === 'png') {
      const c = pngChunks(b).find((x) => x.type === 'eXIf');
      if (c) return strip(c.data);
    } else if (format === 'webp') {
      const c = webpChunks(b).find((x) => x.type === 'EXIF');
      if (c) return strip(c.data);
    } else if (format === 'heic' || format === 'avif') {
      const { exif } = heifMetaItems(b);
      const ext = exif[0]?.extents[0];
      if (ext && ext.offset + ext.length <= b.length && ext.length > 4) {
        const payload = b.subarray(ext.offset, ext.offset + ext.length);
        const skip = new DataView(payload.buffer, payload.byteOffset).getUint32(0);
        return payload.subarray(4 + skip);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// ── Entry points ──────────────────────────────────────────────────────────

/** What metadata an image carries. Never modifies the input. */
export function readMetadata(b: Uint8Array): MetadataReport {
  const { format } = probeImage(b);
  switch (format) {
    case 'jpeg': return jpegReport(b);
    case 'png': return pngReport(b);
    case 'webp': return webpReport(b);
    case 'gif': return gifReport(b);
    case 'avif':
    case 'heic': return heifReport(b, format);
    case 'bmp':
    case 'ico': return emptyReport(format, true);
    default: return emptyReport(format, false);
  }
}

/** Removes metadata without re-encoding. Throws for unsupported formats. */
export function stripMetadata(b: Uint8Array, { keepIcc = true }: { keepIcc?: boolean } = {}): StripResult {
  const { format } = probeImage(b);
  switch (format) {
    case 'jpeg': return jpegStrip(b, keepIcc);
    case 'png': return pngStrip(b, keepIcc);
    case 'webp': return webpStrip(b, keepIcc);
    case 'gif': return gifStrip(b);
    case 'avif':
    case 'heic': return heifStrip(b);
    case 'bmp':
    case 'ico': return { bytes: b, removed: [] };
    case 'tiff':
      throw new Error('TIFF is not supported here. Convert it to PNG first, which drops its metadata.');
    default:
      throw new Error('This file type is not supported for metadata removal.');
  }
}
