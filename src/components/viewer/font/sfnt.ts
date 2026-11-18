/**
 * Just enough of the OpenType format to describe a font: the table directory
 * (TTF, OTF, TTC's first font, WOFF with zlib tables), the `name` table, the
 * character map (formats 4 and 12) and a few metrics. WOFF2 tables are
 * Brotli-compressed and are not read here; the browser still renders them.
 */

export type FontInfo = {
  format: string;
  names: Partial<Record<'family' | 'subfamily' | 'full' | 'version' | 'postscript' | 'designer' | 'manufacturer' | 'license' | 'licenseUrl' | 'copyright' | 'description' | 'vendorUrl' | 'trademark', string>>;
  glyphs: number | null;
  codepoints: number[];
  unitsPerEm: number | null;
  weight: number | null;
  italic: boolean;
  monospace: boolean;
  tables: string[];
  variable: boolean;
};

const NAME_IDS: Record<number, keyof FontInfo['names']> = {
  0: 'copyright',
  1: 'family',
  2: 'subfamily',
  4: 'full',
  5: 'version',
  6: 'postscript',
  7: 'trademark',
  8: 'manufacturer',
  9: 'designer',
  10: 'description',
  11: 'vendorUrl',
  13: 'license',
  14: 'licenseUrl',
};

type Table = { tag: string; data: DataView };

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function tables(buf: ArrayBuffer): Promise<{ format: string; list: Map<string, DataView> } | null> {
  const v = new DataView(buf);
  const tag = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  const list = new Map<string, DataView>();
  if (tag === 'wOF2') return null;
  if (tag === 'wOFF') {
    const n = v.getUint16(12);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20;
      const t = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      const off = v.getUint32(o + 4);
      const comp = v.getUint32(o + 8);
      const orig = v.getUint32(o + 12);
      const raw = new Uint8Array(buf, off, comp);
      const data = comp < orig ? await inflate(raw) : raw.slice();
      list.set(t, new DataView(data.buffer, data.byteOffset, data.byteLength));
    }
    return { format: 'WOFF', list };
  }
  let base = 0;
  let format = tag === 'OTTO' ? 'OpenType (CFF)' : 'TrueType';
  if (tag === 'ttcf') {
    base = v.getUint32(12);
    format = 'TrueType collection';
  }
  const n = v.getUint16(base + 4);
  for (let i = 0; i < n; i++) {
    const o = base + 12 + i * 16;
    const t = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const off = v.getUint32(o + 8);
    const len = v.getUint32(o + 12);
    if (off + len <= buf.byteLength) list.set(t, new DataView(buf, off, len));
  }
  return { format, list };
}

function readNames(d: DataView): FontInfo['names'] {
  const out: FontInfo['names'] = {};
  const count = d.getUint16(2);
  const strings = d.getUint16(4);
  const prefer = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const platform = d.getUint16(o);
    const encoding = d.getUint16(o + 2);
    const language = d.getUint16(o + 4);
    const id = d.getUint16(o + 6);
    const len = d.getUint16(o + 8);
    const off = d.getUint16(o + 10);
    const key = NAME_IDS[id];
    if (!key) continue;
    // Windows Unicode English first, then any Windows Unicode, then Mac Roman.
    const rank = platform === 3 && (encoding === 1 || encoding === 10) ? (language === 0x409 ? 3 : 2) : platform === 1 && encoding === 0 ? 1 : 0;
    if (!rank || (prefer.get(key) ?? 0) >= rank) continue;
    const bytes = new Uint8Array(d.buffer, d.byteOffset + strings + off, len);
    let s = '';
    if (platform === 3) for (let k = 0; k + 1 < bytes.length; k += 2) s += String.fromCharCode((bytes[k]! << 8) | bytes[k + 1]!);
    else s = new TextDecoder('macintosh').decode(bytes);
    out[key] = s.trim();
    prefer.set(key, rank);
  }
  return out;
}

function readCmap(d: DataView): number[] {
  const n = d.getUint16(2);
  let best = -1;
  let bestFormat = 0;
  for (let i = 0; i < n; i++) {
    const platform = d.getUint16(4 + i * 8);
    const enc = d.getUint16(6 + i * 8);
    const off = d.getUint32(8 + i * 8);
    const format = d.getUint16(off);
    const good = (platform === 3 && (enc === 1 || enc === 10)) || platform === 0;
    if (good && (format === 12 || (format === 4 && bestFormat !== 12))) {
      best = off;
      bestFormat = format;
    }
  }
  const cps = new Set<number>();
  if (best < 0) return [];
  if (bestFormat === 4) {
    const segX2 = d.getUint16(best + 6);
    const ends = best + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = d.getUint16(ends + s * 2);
      const start = d.getUint16(starts + s * 2);
      const delta = d.getInt16(deltas + s * 2);
      const ro = d.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + ro + (c - start) * 2;
          g = at + 2 <= d.byteLength ? d.getUint16(at) : 0;
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) cps.add(c);
      }
    }
  } else {
    const groups = d.getUint32(best + 12);
    for (let i = 0; i < groups && cps.size < 200_000; i++) {
      const o = best + 16 + i * 12;
      const s = d.getUint32(o);
      const e = Math.min(d.getUint32(o + 4), s + 65536);
      for (let c = s; c <= e; c++) cps.add(c);
    }
  }
  return [...cps].filter((c) => c >= 32 && (c < 0x7f || c > 0x9f)).sort((a, b) => a - b);
}

export async function readFont(buf: ArrayBuffer): Promise<FontInfo | null> {
  const t = await tables(buf);
  if (!t) return null;
  const get = (tag: string): Table | null => {
    const data = t.list.get(tag);
    return data ? { tag, data } : null;
  };
  const head = get('head');
  const os2 = get('OS/2');
  const maxp = get('maxp');
  const post = get('post');
  const name = get('name');
  const cmap = get('cmap');
  return {
    format: t.format,
    names: name ? readNames(name.data) : {},
    glyphs: maxp ? maxp.data.getUint16(4) : null,
    codepoints: cmap ? readCmap(cmap.data) : [],
    unitsPerEm: head ? head.data.getUint16(18) : null,
    weight: os2 ? os2.data.getUint16(4) : null,
    italic: head ? (head.data.getUint16(44) & 2) !== 0 : false,
    monospace: post ? post.data.getUint32(12) !== 0 : false,
    tables: [...t.list.keys()].sort(),
    variable: t.list.has('fvar'),
  };
}
