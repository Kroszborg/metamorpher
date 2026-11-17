/**
 * Fonts for stamped text. Text that WinAnsi can encode uses a standard PDF
 * font (nothing embedded). Anything else falls back to Liberation Sans
 * (SIL OFL), which pdf.js ships and this app serves from its own origin under
 * /vendor/pdfjs/standard_fonts; it covers Latin, Greek and Cyrillic.
 */
import { type PDFDocument, type PDFFont, type PDFHexString, type PDFName, type PDFPage, StandardFonts } from '@cantoo/pdf-lib';
import { Type0Font } from './truetype';

export type FontFamily = 'helvetica' | 'times' | 'courier';

export type TextFont = {
  ref: PDFFont['ref'];
  encode: (text: string) => PDFHexString;
  widthOfTextAtSize: (text: string, size: number) => number;
  ascentAtSize: (size: number) => number;
  descentAtSize: (size: number) => number;
};

const STANDARD: Record<FontFamily, [StandardFonts, StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

const fallbackBytes = new Map<string, Promise<Uint8Array>>();

function fetchFallback(bold: boolean): Promise<Uint8Array> {
  const file = bold ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf';
  let p = fallbackBytes.get(file);
  if (!p) {
    p = fetch(new URL(`/vendor/pdfjs/standard_fonts/${file}`, self.location.origin))
      .then((r) => {
        if (!r.ok) throw new Error(`The fallback font could not be loaded (${r.status}).`);
        return r.arrayBuffer();
      })
      .then((b) => new Uint8Array(b));
    p.catch(() => fallbackBytes.delete(file));
    fallbackBytes.set(file, p);
  }
  return p;
}

function standardFont(font: PDFFont): TextFont {
  return {
    ref: font.ref,
    encode: (t) => font.encodeText(t) as PDFHexString,
    widthOfTextAtSize: (t, s) => font.widthOfTextAtSize(t, s),
    ascentAtSize: (s) => font.heightAtSize(s, { descender: false }),
    descentAtSize: (s) => font.heightAtSize(s, { descender: false }) - font.heightAtSize(s),
  };
}

/** Strips control characters that no font can draw (tabs become spaces). */
export function cleanText(text: string): string {
  return text.replace(/\t/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g, '');
}

/** Picks and embeds fonts for one document. Call `finalize()` before saving. */
export class FontBook {
  readonly #doc: PDFDocument;
  readonly #standard = new Map<string, { font: PDFFont; charset: Set<number> }>();
  readonly #fallback = new Map<string, Type0Font>();
  readonly #keys = new WeakMap<object, Map<unknown, PDFName>>();

  constructor(doc: PDFDocument) {
    this.#doc = doc;
  }

  async #standardFor(family: FontFamily, bold: boolean) {
    const name = STANDARD[family][bold ? 1 : 0];
    let entry = this.#standard.get(name);
    if (!entry) {
      const font = await this.#doc.embedFont(name);
      entry = { font, charset: new Set(font.getCharacterSet()) };
      this.#standard.set(name, entry);
    }
    return entry;
  }

  /** The font to draw `text` with: the standard font when it can, else the bundled fallback. */
  async fontFor(text: string, family: FontFamily, bold = false): Promise<TextFont> {
    const std = await this.#standardFor(family, bold);
    let ok = true;
    for (const ch of text) {
      if (!std.charset.has(ch.codePointAt(0) ?? 0)) {
        ok = false;
        break;
      }
    }
    if (ok) return standardFont(std.font);

    const key = bold ? 'bold' : 'regular';
    let fb = this.#fallback.get(key);
    if (!fb) {
      fb = new Type0Font(this.#doc.context, await fetchFallback(bold), bold ? 'LiberationSans-Bold' : 'LiberationSans');
      this.#fallback.set(key, fb);
    }
    const missing = fb.missing(text);
    if (missing.length) {
      const sample = missing.slice(0, 5).join(' ');
      throw new Error(
        `The text uses characters that the bundled font cannot draw (${sample}). Latin, Greek and Cyrillic are supported.`,
      );
    }
    const f = fb;
    return {
      ref: f.ref,
      encode: (t) => f.encode(t),
      widthOfTextAtSize: (t, s) => f.widthOfTextAtSize(t, s),
      ascentAtSize: (s) => f.ascentAtSize(s),
      descentAtSize: (s) => f.descentAtSize(s),
    };
  }

  /** The page's resource name for a font (registered once per page). */
  keyOn(page: PDFPage, font: TextFont): PDFName {
    let map = this.#keys.get(page.node);
    if (!map) {
      map = new Map();
      this.#keys.set(page.node, map);
    }
    let key = map.get(font.ref);
    if (!key) {
      key = page.node.newFontDictionary('MmF', font.ref);
      map.set(font.ref, key);
    }
    return key;
  }

  finalize(): void {
    for (const f of this.#fallback.values()) f.finalize();
  }
}
