// The invisible font for OCR text layers, after Tesseract's "GlyphLessFont":
// a Type0 font with Identity-H encoding where each character code is a UTF-16
// code unit, every code maps to one empty glyph 0.5 em wide, and ToUnicode
// maps codes back to the same code units. Any script (Latin, Devanagari,
// Arabic …) is written the same way and extracts as the recognised text.
//
// The embedded TrueType program is built here (about 600 bytes): two empty
// glyphs, ascent 800 and descent -200 per 1000 units, so a character's box
// spans exactly the font size from 0.8 above the baseline to 0.2 below it.

export const GLYPH_ADVANCE = 0.5;
export const FONT_ASCENT = 0.8;
export const FONT_DESCENT = 0.2;

class Bytes {
  #parts: number[] = [];
  u8(v: number) {
    this.#parts.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number) {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff);
  }
  tag(s: string) {
    for (let i = 0; i < 4; i += 1) this.u8(s.charCodeAt(i));
    return this;
  }
  bytes(b: Uint8Array) {
    for (const v of b) this.u8(v);
    return this;
  }
  get length() {
    return this.#parts.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.#parts);
  }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum;
}

function utf16be(s: string): Uint8Array {
  const b = new Bytes();
  for (let i = 0; i < s.length; i += 1) b.u16(s.charCodeAt(i));
  return b.done();
}

let cachedFont: Uint8Array | null = null;

/** A minimal TrueType font with two empty glyphs (.notdef and the "any character" glyph). */
export function glyphlessTrueType(): Uint8Array {
  if (cachedFont) return cachedFont;
  const units = 1000;
  const advance = units * GLYPH_ADVANCE;
  const ascent = units * FONT_ASCENT;
  const descent = -units * FONT_DESCENT;

  const head = new Bytes()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment, patched below
    .u32(0x5f0f3cf5)
    .u16(0x000b)
    .u16(units)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .i16(0)
    .i16(descent)
    .i16(advance)
    .i16(ascent)
    .u16(0)
    .u16(8)
    .i16(2)
    .i16(0) // short loca
    .i16(0)
    .done();
  const hhea = new Bytes()
    .u32(0x00010000)
    .i16(ascent)
    .i16(descent)
    .i16(0)
    .u16(advance)
    .i16(0)
    .i16(0)
    .i16(advance)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(2)
    .done();
  const maxp = new Bytes().u32(0x00010000).u16(2).u16(0).u16(0).u16(0).u16(0).u16(2);
  for (let i = 0; i < 8; i += 1) maxp.u16(0);
  const hmtx = new Bytes().u16(advance).i16(0).u16(advance).i16(0).done();
  const loca = new Bytes().u16(0).u16(0).u16(0).done();
  const glyf = new Uint8Array(0);
  // cmap: one format-4 segment (the required 0xFFFF terminator); glyphs are
  // selected by the PDF's CIDToGIDMap, not by this table.
  const cmapSub = new Bytes().u16(4).u16(24).u16(0).u16(2).u16(2).u16(0).u16(0).u16(0xffff).u16(0).u16(0xffff).i16(1).u16(0);
  const cmap = new Bytes().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(cmapSub.done()).done();
  const names: [number, string][] = [
    [1, 'GlyphLessFont'],
    [2, 'Regular'],
    [4, 'GlyphLessFont'],
    [6, 'GlyphLessFont'],
  ];
  const nameRecords = new Bytes();
  const nameStrings = new Bytes();
  for (const [id, text] of names) {
    const enc = utf16be(text);
    nameRecords.u16(3).u16(1).u16(0x409).u16(id).u16(enc.length).u16(nameStrings.length);
    nameStrings.bytes(enc);
  }
  const name = new Bytes()
    .u16(0)
    .u16(names.length)
    .u16(6 + names.length * 12)
    .bytes(nameRecords.done())
    .bytes(nameStrings.done())
    .done();
  const post = new Bytes().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0).done();

  const tables: [string, Uint8Array][] = [
    ['cmap', cmap],
    ['glyf', glyf],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', loca],
    ['maxp', maxp.done()],
    ['name', name],
    ['post', post],
  ];
  const n = tables.length;
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log += 1;
  }
  const dir = new Bytes().u32(0x00010000).u16(n).u16(pow * 16).u16(log).u16(n * 16 - pow * 16);
  let offset = 12 + n * 16;
  const body = new Bytes();
  let headOffset = 0;
  for (const [tag, data] of tables) {
    if (tag === 'head') headOffset = offset;
    dir.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    body.bytes(data);
    let len = data.length;
    while (len % 4 !== 0) {
      body.u8(0);
      len += 1;
    }
    offset += len;
  }
  const font = new Uint8Array(offset);
  font.set(dir.done(), 0);
  font.set(body.done(), 12 + n * 16);
  const adjust = (0xb1b0afba - checksum(font)) >>> 0;
  new DataView(font.buffer).setUint32(headOffset + 8, adjust);
  cachedFont = font;
  return font;
}

/** ToUnicode CMap: every 2-byte code maps to the same UTF-16 code unit. */
export function identityToUnicode(): string {
  const ranges: string[] = [];
  const hex = (v: number) => v.toString(16).toUpperCase().padStart(4, '0');
  // bfrange entries may not cross a change in the high byte, so one per high byte (max 100 per block).
  for (let block = 0; block < 256; block += 64) {
    const lines: string[] = [];
    for (let hi = block; hi < block + 64; hi += 1) lines.push(`<${hex(hi << 8)}> <${hex((hi << 8) | 0xff)}> <${hex(hi << 8)}>`);
    ranges.push(`${lines.length} beginbfrange\n${lines.join('\n')}\nendbfrange`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...ranges,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/** CIDToGIDMap: every CID (0–65535) to glyph 1. */
export function cidToGidMap(): Uint8Array {
  const map = new Uint8Array(65536 * 2);
  for (let i = 1; i < map.length; i += 2) map[i] = 1;
  return map;
}
