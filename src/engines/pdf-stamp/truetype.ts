/**
 * A minimal TrueType reader and a Type0 (CIDFontType2, Identity-H) embedder,
 * so stamped text can use characters outside WinAnsi (Greek, Cyrillic, Latin
 * Extended…) without a fontkit dependency. No shaping: scripts that need it
 * (Arabic, Indic) are not supported. The whole font file is embedded once per
 * document, compressed; a ToUnicode map keeps the text extractable.
 */
import {
  PDFArray,
  type PDFContext,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';

export type TrueTypeFont = {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  italicAngle: number;
  numGlyphs: number;
  /** Glyph id for a code point; 0 when the font lacks it. */
  glyphFor: (codePoint: number) => number;
  /** Advance width in font units. */
  advance: (gid: number) => number;
};

export function parseTrueType(bytes: Uint8Array): TrueTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, { offset: number; length: number }>();
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!);
    tables.set(tag, { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) });
  }
  const table = (tag: string) => {
    const t = tables.get(tag);
    if (!t) throw new Error(`Font is missing its ${tag} table.`);
    return t.offset;
  };

  const head = table('head');
  const unitsPerEm = view.getUint16(head + 18);
  const bbox: [number, number, number, number] = [
    view.getInt16(head + 36),
    view.getInt16(head + 38),
    view.getInt16(head + 40),
    view.getInt16(head + 42),
  ];
  const hhea = table('hhea');
  const ascent = view.getInt16(hhea + 4);
  const descent = view.getInt16(hhea + 6);
  const numberOfHMetrics = view.getUint16(hhea + 34);
  const numGlyphs = view.getUint16(table('maxp') + 4);
  const hmtx = table('hmtx');

  let capHeight = Math.round(ascent * 0.7);
  const os2 = tables.get('OS/2');
  if (os2 && view.getUint16(os2.offset) >= 2 && os2.length >= 90) capHeight = view.getInt16(os2.offset + 88);
  const post = tables.get('post');
  const italicAngle = post ? view.getInt32(post.offset + 4) / 65536 : 0;

  // cmap: prefer a full-Unicode (format 12) subtable, then BMP (format 4).
  const cmap = table('cmap');
  let fmt12 = -1;
  let fmt4 = -1;
  const nSub = view.getUint16(cmap + 2);
  for (let i = 0; i < nSub; i += 1) {
    const rec = cmap + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const sub = cmap + view.getUint32(rec + 4);
    const format = view.getUint16(sub);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12 && fmt12 < 0) fmt12 = sub;
    if (format === 4 && fmt4 < 0) fmt4 = sub;
  }
  if (fmt12 < 0 && fmt4 < 0) throw new Error('Font has no Unicode character map.');

  const glyphFor = (cp: number): number => {
    if (fmt12 >= 0) {
      const groups = view.getUint32(fmt12 + 12);
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = fmt12 + 16 + mid * 12;
        const start = view.getUint32(g);
        const end = view.getUint32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return view.getUint32(g + 8) + (cp - start);
      }
      return 0;
    }
    if (cp > 0xffff) return 0;
    const segX2 = view.getUint16(fmt4 + 6);
    const ends = fmt4 + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const rangeOffsets = deltas + segX2;
    for (let i = 0; i < segX2; i += 2) {
      const end = view.getUint16(ends + i);
      if (cp > end) continue;
      const start = view.getUint16(starts + i);
      if (cp < start) return 0;
      const delta = view.getInt16(deltas + i);
      const ro = view.getUint16(rangeOffsets + i);
      if (ro === 0) return (cp + delta) & 0xffff;
      const at = rangeOffsets + i + ro + (cp - start) * 2;
      const gid = view.getUint16(at);
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  };

  const advance = (gid: number): number => {
    const i = Math.min(gid, numberOfHMetrics - 1);
    return view.getUint16(hmtx + i * 4);
  };

  return { unitsPerEm, ascent, descent, capHeight, bbox, italicAngle, numGlyphs, glyphFor, advance };
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

function utf16Hex(cp: number): string {
  if (cp <= 0xffff) return hex4(cp);
  const v = cp - 0x10000;
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
}

/**
 * A TrueType font embedded as Type0/Identity-H. Glyph widths and the
 * ToUnicode map are written by `finalize()`, from the glyphs actually used.
 */
export class Type0Font {
  readonly ref: PDFRef;
  readonly font: TrueTypeFont;
  readonly #context: PDFContext;
  readonly #widthsRef: PDFRef;
  readonly #toUnicodeRef: PDFRef;
  readonly #used = new Map<number, number>();

  constructor(context: PDFContext, bytes: Uint8Array, baseName: string) {
    this.#context = context;
    this.font = parseTrueType(bytes);
    const f = this.font;
    const k = 1000 / f.unitsPerEm;
    const name = PDFName.of(baseName);

    const fontFile = context.register(context.flateStream(bytes, { Length1: bytes.length }));
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: name,
        Flags: 32,
        FontBBox: f.bbox.map((v) => Math.round(v * k)),
        ItalicAngle: f.italicAngle,
        Ascent: Math.round(f.ascent * k),
        Descent: Math.round(f.descent * k),
        CapHeight: Math.round(f.capHeight * k),
        StemV: 80,
        FontFile2: fontFile,
      }),
    );
    this.#widthsRef = context.nextRef();
    this.#toUnicodeRef = context.nextRef();
    const cidSystemInfo = context.obj({ Supplement: 0 });
    cidSystemInfo.set(PDFName.of('Registry'), PDFString.of('Adobe'));
    cidSystemInfo.set(PDFName.of('Ordering'), PDFString.of('Identity'));
    const cidFont = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: name,
        CIDSystemInfo: cidSystemInfo,
        FontDescriptor: descriptor,
        DW: Math.round(f.advance(0) * k),
        W: this.#widthsRef,
        CIDToGIDMap: 'Identity',
      }),
    );
    this.ref = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: name,
        Encoding: 'Identity-H',
        DescendantFonts: [cidFont],
        ToUnicode: this.#toUnicodeRef,
      }),
    );
  }

  /** Code points this font cannot draw. */
  missing(text: string): string[] {
    const out = new Set<string>();
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (this.font.glyphFor(cp) === 0) out.add(ch);
    }
    return [...out];
  }

  encode(text: string): PDFHexString {
    let hex = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      const gid = this.font.glyphFor(cp);
      if (gid !== 0 && !this.#used.has(gid)) this.#used.set(gid, cp);
      hex += hex4(gid);
    }
    return PDFHexString.of(hex);
  }

  widthOfTextAtSize(text: string, size: number): number {
    let units = 0;
    for (const ch of text) units += this.font.advance(this.font.glyphFor(ch.codePointAt(0) ?? 0));
    return (units / this.font.unitsPerEm) * size;
  }

  ascentAtSize(size: number): number {
    return (this.font.ascent / this.font.unitsPerEm) * size;
  }

  descentAtSize(size: number): number {
    return (this.font.descent / this.font.unitsPerEm) * size;
  }

  /** Writes /W and /ToUnicode. Call once, after all text has been encoded. */
  finalize(): void {
    const k = 1000 / this.font.unitsPerEm;
    const gids = [...this.#used.keys()].sort((a, b) => a - b);
    const w = PDFArray.withContext(this.#context);
    for (const gid of gids) {
      w.push(PDFNumber.of(gid));
      w.push(this.#context.obj([Math.round(this.font.advance(gid) * k)]));
    }
    this.#context.assign(this.#widthsRef, w);

    const lines = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
    ];
    for (let i = 0; i < gids.length; i += 100) {
      const chunk = gids.slice(i, i + 100);
      lines.push(`${chunk.length} beginbfchar`);
      for (const gid of chunk) lines.push(`<${hex4(gid)}> <${utf16Hex(this.#used.get(gid) ?? 0)}>`);
      lines.push('endbfchar');
    }
    lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
    this.#context.assign(this.#toUnicodeRef, this.#context.flateStream(lines.join('\n')));
  }
}
