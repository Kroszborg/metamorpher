/**
 * A small EXIF (TIFF structure) reader that pulls out what matters for
 * privacy, and a writer for a minimal EXIF block holding only Orientation.
 */

export type ExifSummary = {
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  description?: string;
  ownerName?: string;
  serialNumber?: string;
  dateTaken?: string;
  dateModified?: string;
  orientation?: number;
  gps?: { latitude: number; longitude: number; altitude?: number };
  /** True when GPS tags exist even if no usable position could be read. */
  hasGps: boolean;
  hasMakerNote: boolean;
  hasThumbnail: boolean;
  tagCount: number;
};

const TAGS = {
  description: 0x010e,
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateModified: 0x0132,
  artist: 0x013b,
  copyright: 0x8298,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTaken: 0x9003,
  makerNote: 0x927c,
  ownerName: 0xa430,
  serialNumber: 0xa431,
  lens: 0xa434,
} as const;

type Entry = { tag: number; type: number; count: number; valueOffset: number };

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * Reads EXIF from a TIFF-structured buffer (starting at the "II"/"MM" header).
 * Returns null when the buffer is not valid TIFF.
 */
export function readExif(tiff: Uint8Array): ExifSummary | null {
  if (tiff.length < 8) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  if (view.getUint16(2, le) !== 42) return null;

  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const inRange = (o: number, n: number) => o >= 0 && o + n <= tiff.length;

  const readIfd = (offset: number): { entries: Entry[]; next: number } => {
    if (!inRange(offset, 2)) return { entries: [], next: 0 };
    const n = u16(offset);
    const entries: Entry[] = [];
    for (let i = 0; i < n; i += 1) {
      const e = offset + 2 + i * 12;
      if (!inRange(e, 12)) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      entries.push({ tag: u16(e), type, count, valueOffset: size <= 4 ? e + 8 : u32(e + 8) });
    }
    const nextAt = offset + 2 + n * 12;
    return { entries, next: inRange(nextAt, 4) ? u32(nextAt) : 0 };
  };

  const ascii = (e: Entry): string | undefined => {
    if (e.type !== 2 && e.type !== 7) return undefined;
    if (!inRange(e.valueOffset, e.count)) return undefined;
    const s = new TextDecoder('latin1').decode(tiff.subarray(e.valueOffset, e.valueOffset + e.count));
    const clean = s.replace(/\0+$/, '').trim();
    return clean || undefined;
  };
  const short = (e: Entry) => (e.type === 3 ? u16(e.valueOffset) : e.type === 4 ? u32(e.valueOffset) : undefined);
  const rationals = (e: Entry): number[] => {
    if (e.type !== 5 && e.type !== 10) return [];
    const out: number[] = [];
    for (let i = 0; i < e.count; i += 1) {
      const o = e.valueOffset + i * 8;
      if (!inRange(o, 8)) break;
      const den = u32(o + 4);
      out.push(den === 0 ? 0 : u32(o) / den);
    }
    return out;
  };

  const summary: ExifSummary = { hasGps: false, hasMakerNote: false, hasThumbnail: false, tagCount: 0 };
  const ifd0 = readIfd(u32(4));
  summary.tagCount += ifd0.entries.length;
  let exifAt = 0;
  let gpsAt = 0;
  for (const e of ifd0.entries) {
    switch (e.tag) {
      case TAGS.make: summary.make = ascii(e); break;
      case TAGS.model: summary.model = ascii(e); break;
      case TAGS.software: summary.software = ascii(e); break;
      case TAGS.dateModified: summary.dateModified = ascii(e); break;
      case TAGS.artist: summary.artist = ascii(e); break;
      case TAGS.copyright: summary.copyright = ascii(e); break;
      case TAGS.description: summary.description = ascii(e); break;
      case TAGS.orientation: summary.orientation = short(e); break;
      case TAGS.exifIfd: exifAt = u32(e.valueOffset); break;
      case TAGS.gpsIfd: gpsAt = u32(e.valueOffset); break;
    }
  }
  if (ifd0.next && readIfd(ifd0.next).entries.length) summary.hasThumbnail = true;

  if (exifAt) {
    const ifd = readIfd(exifAt);
    summary.tagCount += ifd.entries.length;
    for (const e of ifd.entries) {
      switch (e.tag) {
        case TAGS.dateTaken: summary.dateTaken = ascii(e); break;
        case TAGS.lens: summary.lens = ascii(e); break;
        case TAGS.ownerName: summary.ownerName = ascii(e); break;
        case TAGS.serialNumber: summary.serialNumber = ascii(e); break;
        case TAGS.makerNote: summary.hasMakerNote = true; break;
      }
    }
  }

  if (gpsAt) {
    const ifd = readIfd(gpsAt);
    summary.tagCount += ifd.entries.length;
    summary.hasGps = ifd.entries.length > 0;
    const get = (tag: number) => ifd.entries.find((e) => e.tag === tag);
    const latRef = get(1);
    const lat = get(2);
    const lonRef = get(3);
    const lon = get(4);
    const alt = get(6);
    const dms = (e?: Entry) => {
      const [d = 0, m = 0, s = 0] = e ? rationals(e) : [];
      return d + m / 60 + s / 3600;
    };
    if (lat && lon) {
      const ref = (e?: Entry) => (e ? String.fromCharCode(tiff[e.valueOffset] ?? 0) : '');
      let latitude = dms(lat);
      let longitude = dms(lon);
      if (ref(latRef) === 'S') latitude = -latitude;
      if (ref(lonRef) === 'W') longitude = -longitude;
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)) {
        summary.gps = { latitude, longitude, altitude: alt ? rationals(alt)[0] : undefined };
      }
    }
  }
  return summary;
}

/** Orientation (1–8) from a TIFF-structured EXIF buffer, or 1. */
export function exifOrientation(tiff: Uint8Array): number {
  const o = readExif(tiff)?.orientation;
  return o && o >= 1 && o <= 8 ? o : 1;
}

/** A big-endian TIFF block with a single IFD0 entry: Orientation. */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const out = new Uint8Array(26);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x4d, 0x00, 0x2a]);
  view.setUint32(4, 8); // IFD0 offset
  view.setUint16(8, 1); // one entry
  view.setUint16(10, 0x0112);
  view.setUint16(12, 3); // SHORT
  view.setUint32(14, 1);
  view.setUint16(18, orientation);
  view.setUint32(22, 0); // no next IFD
  return out;
}

/**
 * A copy of a TIFF-structured EXIF block that is safe to attach to pixels
 * that already have the orientation applied: Orientation is set to 1, the
 * thumbnail (IFD1, stored unrotated) is dropped and, unless `keepGps`, the
 * GPS directory is emptied and its values zeroed. Returns null for invalid input.
 */
export function exifForCopy(source: Uint8Array, { keepGps = false }: { keepGps?: boolean } = {}): Uint8Array | null {
  if (!readExif(source)) return null;
  const tiff = source.slice();
  const view = new DataView(tiff.buffer);
  const le = tiff[0] === 0x49;
  const inRange = (o: number, n: number) => o >= 0 && o + n <= tiff.length;
  const ifd0 = view.getUint32(4, le);
  if (!inRange(ifd0, 2)) return null;
  const n = view.getUint16(ifd0, le);
  let gpsAt = 0;
  for (let i = 0; i < n; i += 1) {
    const e = ifd0 + 2 + i * 12;
    if (!inRange(e, 12)) break;
    const tag = view.getUint16(e, le);
    if (tag === 0x0112 && view.getUint16(e + 2, le) === 3) view.setUint16(e + 8, 1, le);
    if (tag === 0x8825) gpsAt = view.getUint32(e + 8, le);
  }
  const next = ifd0 + 2 + n * 12;
  if (inRange(next, 4)) view.setUint32(next, 0, le);
  if (!keepGps && gpsAt && inRange(gpsAt, 2)) {
    const count = view.getUint16(gpsAt, le);
    for (let i = 0; i < count; i += 1) {
      const e = gpsAt + 2 + i * 12;
      if (!inRange(e, 12)) break;
      const size = (TYPE_SIZE[view.getUint16(e + 2, le)] ?? 1) * view.getUint32(e + 4, le);
      if (size > 4) {
        const at = view.getUint32(e + 8, le);
        if (inRange(at, size)) tiff.fill(0, at, at + size);
      }
      tiff.fill(0, e, e + 12);
    }
    view.setUint16(gpsAt, 0, le);
  }
  return tiff;
}
