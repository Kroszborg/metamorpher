/**
 * Minimal ISOBMFF (HEIF/AVIF) reader: enough to find the primary item's size,
 * rotation and mirroring, its colour profile, and the Exif/XMP metadata items.
 * Pure functions over bytes; safe on the main thread and in workers.
 */

export type Box = { type: string; start: number; size: number; header: number };

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);

/** Child boxes in [start, end). Stops quietly at a truncated box. */
export function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = view.getUint32(o);
    const type = fourcc(b, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = Number(view.getBigUint64(o + 8));
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header || o + size > end) break;
    out.push({ type, start: o, size, header });
    o += size;
  }
  return out;
}

const child = (b: Uint8Array, parent: Box, type: string, skip = 0) =>
  boxes(b, parent.start + parent.header + skip, parent.start + parent.size).find((x) => x.type === type);

export type HeifItem = {
  id: number;
  type: string;
  /** Offset of the 4CC item_type inside the file (to rename it in place). */
  typeOffset: number;
  /** Offset of the infe FullBox flags (3 bytes after the version byte). */
  flagsOffset: number;
  contentType?: string;
  extents: { offset: number; length: number }[];
};

export type HeifInfo = {
  brand: 'avif' | 'heic' | 'unknown';
  primaryId: number;
  items: HeifItem[];
  /** Displayed size of the primary image, after rotation. */
  width: number;
  height: number;
  rotation: number; // clockwise degrees
  mirror: boolean;
  icc?: Uint8Array;
  /** CICP colour code points from an nclx 'colr' box (used when there is no ICC profile). */
  nclx?: { primaries: number; transfer: number; matrix: number; fullRange: boolean };
  hasAlpha: boolean;
  sequence: boolean;
};

function readUint(view: DataView, o: number, size: number): number {
  if (size === 0) return 0;
  if (size === 1) return view.getUint8(o);
  if (size === 2) return view.getUint16(o);
  if (size === 4) return view.getUint32(o);
  if (size === 8) return Number(view.getBigUint64(o));
  throw new Error(`Unsupported field size ${size}`);
}

function cstring(b: Uint8Array, o: number, end: number): [string, number] {
  let e = o;
  while (e < end && b[e] !== 0) e += 1;
  return [new TextDecoder().decode(b.subarray(o, e)), e + 1];
}

/** Parses a HEIF/AVIF file's ftyp and meta boxes. Returns null for anything else. */
export function readHeif(b: Uint8Array): HeifInfo | null {
  const top = boxes(b, 0, b.length);
  const ftyp = top[0];
  if (!ftyp || ftyp.type !== 'ftyp') return null;
  const brands = new Set<string>();
  brands.add(fourcc(b, ftyp.start + 8));
  for (let o = ftyp.start + 16; o + 4 <= ftyp.start + ftyp.size; o += 4) brands.add(fourcc(b, o));
  const isAvif = brands.has('avif') || brands.has('avis');
  const isHeic = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].some((x) => brands.has(x));
  if (!isAvif && !isHeic) return null;

  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info: HeifInfo = {
    brand: isAvif ? 'avif' : isHeic ? 'heic' : 'unknown',
    primaryId: 0,
    items: [],
    width: 0,
    height: 0,
    rotation: 0,
    mirror: false,
    hasAlpha: false,
    sequence: brands.has('avis') || brands.has('msf1') || brands.has('hevc'),
  };
  const meta = top.find((x) => x.type === 'meta');
  if (!meta) return info;
  // meta is a FullBox: 4 bytes of version/flags before its children.
  const metaChildren = boxes(b, meta.start + meta.header + 4, meta.start + meta.size);

  const pitm = metaChildren.find((x) => x.type === 'pitm');
  if (pitm) {
    const v = b[pitm.start + pitm.header] ?? 0;
    info.primaryId = v === 0 ? view.getUint16(pitm.start + pitm.header + 4) : view.getUint32(pitm.start + pitm.header + 4);
  }

  // iinf: item types.
  const iinf = metaChildren.find((x) => x.type === 'iinf');
  const items = new Map<number, HeifItem>();
  if (iinf) {
    const v = b[iinf.start + iinf.header] ?? 0;
    const skip = 4 + (v === 0 ? 2 : 4);
    for (const infe of boxes(b, iinf.start + iinf.header + skip, iinf.start + iinf.size)) {
      if (infe.type !== 'infe') continue;
      const p = infe.start + infe.header;
      const ver = b[p] ?? 0;
      if (ver < 2) continue;
      let o = p + 4;
      const id = ver === 2 ? view.getUint16(o) : view.getUint32(o);
      o += ver === 2 ? 2 : 4;
      o += 2; // protection index
      const typeOffset = o;
      const type = fourcc(b, o);
      o += 4;
      const end = infe.start + infe.size;
      const [, afterName] = cstring(b, o, end);
      let contentType: string | undefined;
      if (type === 'mime') [contentType] = cstring(b, afterName, end);
      items.set(id, { id, type, typeOffset, flagsOffset: p + 1, contentType, extents: [] });
    }
  }

  // iloc: where each item's bytes are.
  const iloc = metaChildren.find((x) => x.type === 'iloc');
  const idat = metaChildren.find((x) => x.type === 'idat');
  if (iloc) {
    let o = iloc.start + iloc.header;
    const ver = b[o] ?? 0;
    o += 4;
    const s1 = b[o] ?? 0;
    const s2 = b[o + 1] ?? 0;
    o += 2;
    const offsetSize = s1 >> 4;
    const lengthSize = s1 & 15;
    const baseOffsetSize = s2 >> 4;
    const indexSize = ver === 1 || ver === 2 ? s2 & 15 : 0;
    const count = ver < 2 ? view.getUint16(o) : view.getUint32(o);
    o += ver < 2 ? 2 : 4;
    for (let i = 0; i < count; i += 1) {
      const id = ver < 2 ? view.getUint16(o) : view.getUint32(o);
      o += ver < 2 ? 2 : 4;
      let method = 0;
      if (ver === 1 || ver === 2) {
        method = view.getUint16(o) & 15;
        o += 2;
      }
      o += 2; // data reference index
      const base = readUint(view, o, baseOffsetSize);
      o += baseOffsetSize;
      const extentCount = view.getUint16(o);
      o += 2;
      const extents: { offset: number; length: number }[] = [];
      for (let e = 0; e < extentCount; e += 1) {
        o += indexSize;
        const off = readUint(view, o, offsetSize);
        o += offsetSize;
        const len = readUint(view, o, lengthSize);
        o += lengthSize;
        if (method === 0) extents.push({ offset: base + off, length: len });
        else if (method === 1 && idat) extents.push({ offset: idat.start + idat.header + base + off, length: len });
      }
      const item = items.get(id);
      if (item) item.extents = extents;
    }
  }
  info.items = [...items.values()];

  // iprp: properties of the primary item.
  const iprp = metaChildren.find((x) => x.type === 'iprp');
  const ipco = iprp ? child(b, iprp, 'ipco') : undefined;
  const ipmas = iprp ? boxes(b, iprp.start + iprp.header, iprp.start + iprp.size).filter((x) => x.type === 'ipma') : [];
  if (ipco) {
    const props = boxes(b, ipco.start + ipco.header, ipco.start + ipco.size);
    const assoc = new Map<number, number[]>();
    for (const ipma of ipmas) {
      let o = ipma.start + ipma.header;
      const ver = b[o] ?? 0;
      const flags = b[o + 3] ?? 0;
      o += 4;
      const count = view.getUint32(o);
      o += 4;
      for (let i = 0; i < count; i += 1) {
        const id = ver < 1 ? view.getUint16(o) : view.getUint32(o);
        o += ver < 1 ? 2 : 4;
        const n = b[o] ?? 0;
        o += 1;
        const list: number[] = [];
        for (let k = 0; k < n; k += 1) {
          const idx = flags & 1 ? view.getUint16(o) & 0x7fff : (b[o] ?? 0) & 0x7f;
          o += flags & 1 ? 2 : 1;
          list.push(idx);
        }
        assoc.set(id, [...(assoc.get(id) ?? []), ...list]);
      }
    }
    const primaryProps = (assoc.get(info.primaryId) ?? []).map((i) => props[i - 1]).filter((x): x is Box => !!x);
    let w = 0;
    let h = 0;
    for (const p of primaryProps) {
      const d = p.start + p.header;
      if (p.type === 'ispe') {
        w = view.getUint32(d + 4);
        h = view.getUint32(d + 8);
      } else if (p.type === 'irot') {
        // Anti-clockwise quarter turns.
        info.rotation = ((4 - ((b[d] ?? 0) & 3)) % 4) * 90;
      } else if (p.type === 'imir') {
        info.mirror = true;
      } else if (p.type === 'colr') {
        const kind = fourcc(b, d);
        if (kind === 'prof' || kind === 'rICC') info.icc = b.slice(d + 4, p.start + p.size);
        else if (kind === 'nclx' && d + 11 <= p.start + p.size) {
          info.nclx = {
            primaries: view.getUint16(d + 4),
            transfer: view.getUint16(d + 6),
            matrix: view.getUint16(d + 8),
            fullRange: ((b[d + 10] ?? 0) & 0x80) !== 0,
          };
        }
      }
    }
    if (info.rotation === 90 || info.rotation === 270) [w, h] = [h, w];
    info.width = w;
    info.height = h;
    // An alpha auxiliary image references the primary through 'auxl'.
    for (const [id, list] of assoc) {
      if (id === info.primaryId) continue;
      for (const i of list) {
        const p = props[i - 1];
        if (p?.type !== 'auxC') continue;
        const [urn] = cstring(b, p.start + p.header + 4, p.start + p.size);
        if (urn.includes('alpha')) info.hasAlpha = true;
      }
    }
  }
  return info;
}
