// Worker-only: the fonts the layout engine adds to MuPDF's built-in ones.
//
// MuPDF ships Nimbus Sans/Roman/Mono (Helvetica, Times and Courier clones,
// Latin/Greek/Cyrillic) and Droid Sans Fallback (Chinese, Japanese, Korean).
// Everything else comes from public/vendor/fonts (Noto, OFL-1.1), fetched
// only when a document contains characters that need it. MuPDF asks for
// fonts through one synchronous callback, so every font a document needs is
// fetched before layout starts.
import type * as M from 'mupdf';

type Mupdf = typeof M;
type Style = '400' | '700' | '400i' | '700i';

type Family = { label: string; styles: readonly Style[] };

const RB: readonly Style[] = ['400', '700'];
const RBI: readonly Style[] = ['400', '700', '400i', '700i'];
const R: readonly Style[] = ['400'];
const STYLE_NAME: Record<Style, string> = { '400': 'Regular', '700': 'Bold', '400i': 'Italic', '700i': 'BoldItalic' };

/** Font files in /vendor/fonts, named `<key>-<style>.ttf` (scripts/copy-runtime-assets.mjs). */
const FAMILIES: Record<string, Family> = {
  'noto-sans': { label: 'Noto Sans', styles: RBI },
  'noto-sans-mono': { label: 'Noto Sans Mono', styles: RB },
  carlito: { label: 'Carlito', styles: RBI },
  caladea: { label: 'Caladea', styles: RBI },
  'noto-sans-symbols': { label: 'Noto Sans Symbols', styles: R },
  'noto-sans-symbols-2': { label: 'Noto Sans Symbols 2', styles: R },
  'noto-sans-math': { label: 'Noto Sans Math', styles: R },
  'noto-emoji': { label: 'Noto Emoji', styles: R },
  'noto-sans-arabic': { label: 'Noto Sans Arabic', styles: RB },
  'noto-sans-armenian': { label: 'Noto Sans Armenian', styles: RB },
  'noto-sans-bengali': { label: 'Noto Sans Bengali', styles: RB },
  'noto-sans-devanagari': { label: 'Noto Sans Devanagari', styles: RB },
  'noto-sans-ethiopic': { label: 'Noto Sans Ethiopic', styles: RB },
  'noto-sans-georgian': { label: 'Noto Sans Georgian', styles: RB },
  'noto-sans-gujarati': { label: 'Noto Sans Gujarati', styles: RB },
  'noto-sans-gurmukhi': { label: 'Noto Sans Gurmukhi', styles: RB },
  'noto-sans-hebrew': { label: 'Noto Sans Hebrew', styles: RB },
  'noto-sans-kannada': { label: 'Noto Sans Kannada', styles: RB },
  'noto-sans-khmer': { label: 'Noto Sans Khmer', styles: RB },
  'noto-sans-lao': { label: 'Noto Sans Lao', styles: RB },
  'noto-sans-malayalam': { label: 'Noto Sans Malayalam', styles: RB },
  'noto-sans-myanmar': { label: 'Noto Sans Myanmar', styles: RB },
  'noto-sans-sinhala': { label: 'Noto Sans Sinhala', styles: RB },
  'noto-sans-tamil': { label: 'Noto Sans Tamil', styles: RB },
  'noto-sans-telugu': { label: 'Noto Sans Telugu', styles: RB },
  'noto-sans-thai': { label: 'Noto Sans Thai', styles: RB },
};

/** MuPDF's script names (its fallback callback) → family. */
const SCRIPT_FAMILY: Record<string, string> = {
  Latin: 'noto-sans',
  Greek: 'noto-sans',
  Cyrillic: 'noto-sans',
  Arabic: 'noto-sans-arabic',
  Armenian: 'noto-sans-armenian',
  Bengali: 'noto-sans-bengali',
  Devanagari: 'noto-sans-devanagari',
  Ethiopic: 'noto-sans-ethiopic',
  Georgian: 'noto-sans-georgian',
  Gujarati: 'noto-sans-gujarati',
  Gurmukhi: 'noto-sans-gurmukhi',
  Hebrew: 'noto-sans-hebrew',
  Kannada: 'noto-sans-kannada',
  Khmer: 'noto-sans-khmer',
  Lao: 'noto-sans-lao',
  Malayalam: 'noto-sans-malayalam',
  Myanmar: 'noto-sans-myanmar',
  Sinhala: 'noto-sans-sinhala',
  Tamil: 'noto-sans-tamil',
  Telugu: 'noto-sans-telugu',
  Thai: 'noto-sans-thai',
};

/** Code point ranges whose script MuPDF falls back for by itself (shaped with HarfBuzz). */
const SCRIPT_RANGES: [number, number, string][] = [
  [0x0180, 0x036f, 'noto-sans'], // Latin Extended-B, IPA, spacing modifiers, combining marks
  [0x0370, 0x03ff, 'noto-sans'],
  [0x0400, 0x052f, 'noto-sans'],
  [0x0530, 0x058f, 'noto-sans-armenian'],
  [0x0590, 0x05ff, 'noto-sans-hebrew'],
  [0x0600, 0x06ff, 'noto-sans-arabic'],
  [0x0750, 0x077f, 'noto-sans-arabic'],
  [0x0870, 0x08ff, 'noto-sans-arabic'],
  [0x0900, 0x097f, 'noto-sans-devanagari'],
  [0x0980, 0x09ff, 'noto-sans-bengali'],
  [0x0a00, 0x0a7f, 'noto-sans-gurmukhi'],
  [0x0a80, 0x0aff, 'noto-sans-gujarati'],
  [0x0b80, 0x0bff, 'noto-sans-tamil'],
  [0x0c00, 0x0c7f, 'noto-sans-telugu'],
  [0x0c80, 0x0cff, 'noto-sans-kannada'],
  [0x0d00, 0x0d7f, 'noto-sans-malayalam'],
  [0x0d80, 0x0dff, 'noto-sans-sinhala'],
  [0x0e00, 0x0e7f, 'noto-sans-thai'],
  [0x0e80, 0x0eff, 'noto-sans-lao'],
  [0x1000, 0x109f, 'noto-sans-myanmar'],
  [0x10a0, 0x10ff, 'noto-sans-georgian'],
  [0x1200, 0x139f, 'noto-sans-ethiopic'],
  [0x1780, 0x17ff, 'noto-sans-khmer'],
  [0x19e0, 0x19ff, 'noto-sans-khmer'],
  [0x1c80, 0x1c8f, 'noto-sans'],
  [0x1c90, 0x1cbf, 'noto-sans-georgian'],
  [0x1d00, 0x1dbf, 'noto-sans'],
  [0x1dc0, 0x1dff, 'noto-sans'],
  [0x1e00, 0x1fff, 'noto-sans'], // Latin Extended Additional (Vietnamese), Greek Extended
  [0x2c60, 0x2c7f, 'noto-sans'],
  [0x2d00, 0x2d2f, 'noto-sans-georgian'],
  [0x2d80, 0x2ddf, 'noto-sans-ethiopic'],
  [0x2de0, 0x2dff, 'noto-sans'],
  [0xa640, 0xa69f, 'noto-sans'],
  [0xa720, 0xa7ff, 'noto-sans'],
  [0xa8e0, 0xa8ff, 'noto-sans-devanagari'],
  [0xa9e0, 0xa9ff, 'noto-sans-myanmar'],
  [0xaa60, 0xaa7f, 'noto-sans-myanmar'],
  [0xab30, 0xab6f, 'noto-sans'],
  [0xfb1d, 0xfb4f, 'noto-sans-hebrew'],
  [0xfb50, 0xfdff, 'noto-sans-arabic'],
  [0xfe70, 0xfeff, 'noto-sans-arabic'],
];

/** Chinese, Japanese and Korean: MuPDF's built-in Droid Sans Fallback covers them. */
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0x2fdf) ||
    (cp >= 0x3000 && cp <= 0x30ff) ||
    (cp >= 0x3100 && cp <= 0x31ff) ||
    (cp >= 0x3200 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7ff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x20000 && cp <= 0x3134f)
  );
}

/** Joiners, variation selectors and other invisible format characters. */
function isInvisible(cp: number): boolean {
  return (
    (cp >= 0x80 && cp < 0xa0) ||
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xf0000) ||
    OTHER.test(String.fromCodePoint(cp)) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    cp === 0xad ||
    (cp >= 0xe0000 && cp <= 0xe01ef)
  );
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const LETTER = /[\p{L}\p{M}]/u;
/** Control, unassigned, surrogate and private-use code points: no font is fetched for them. */
const OTHER = /[\p{Cc}\p{Cn}\p{Cs}\p{Co}]/u;

function isEmoji(cp: number): boolean {
  return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x1f1e6 && cp <= 0x1f1ff) || PICTOGRAPHIC.test(String.fromCodePoint(cp));
}

function isMath(cp: number): boolean {
  return (
    (cp >= 0x2200 && cp <= 0x22ff) ||
    (cp >= 0x27c0 && cp <= 0x27ef) ||
    (cp >= 0x2980 && cp <= 0x2aff) ||
    (cp >= 0x1d400 && cp <= 0x1d7ff)
  );
}

function scriptFamily(cp: number): string | null {
  for (const [lo, hi, key] of SCRIPT_RANGES) {
    if (cp < lo) return null;
    if (cp <= hi) return key;
  }
  return null;
}

/** Characters that ride along inside an emoji run (skin tones, joiners, presentation selectors, keycaps). */
function joinsEmoji(cp: number): boolean {
  return cp === 0x200d || cp === 0xfe0f || cp === 0x20e3 || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f);
}

const bytesCache = new Map<string, Promise<Uint8Array>>();

function fetchFont(file: string): Promise<Uint8Array> {
  let p = bytesCache.get(file);
  if (!p) {
    p = fetch(new URL(`/vendor/fonts/${file}`, self.location.origin).href).then(async (res) => {
      if (!res.ok) throw new Error(`Could not load the font ${file} (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    });
    p.catch(() => bytesCache.delete(file));
    bytesCache.set(file, p);
  }
  return p;
}

/** MuPDF's own fonts for the CSS generic families: regular, bold, italic, bold italic. */
const BUILTIN: Record<string, readonly string[]> = {
  'sans-serif': ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  monospace: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};

/** Common font names in documents → the generic family we set them in. */
const GENERIC_OF: Record<string, string> = Object.fromEntries([
  ...['arial', 'helvetica', 'helvetica neue', 'verdana', 'tahoma', 'segoe ui', 'aptos', 'roboto', 'open sans', 'liberation sans', 'arimo', 'system-ui', 'trebuchet ms', 'gill sans', 'century gothic', 'franklin gothic'].map((n) => [n, 'sans-serif']),
  ...['times', 'times new roman', 'georgia', 'garamond', 'book antiqua', 'palatino', 'palatino linotype', 'liberation serif', 'tinos', 'constantia', 'baskerville'].map((n) => [n, 'serif']),
  ...['courier', 'courier new', 'consolas', 'menlo', 'monaco', 'lucida console', 'liberation mono', 'cousine', 'source code pro', 'cascadia code', 'ui-monospace'].map((n) => [n, 'monospace']),
]);

/** Font names that documents use, mapped to what we have (metric-compatible where possible). */
const ALIASES: Record<string, string> = {
  calibri: 'carlito',
  'calibri light': 'carlito',
  carlito: 'carlito',
  cambria: 'caladea',
  caladea: 'caladea',
};

/** Generic family for an unknown font name. */
function genericGuess(name: string): string {
  if (/mono|courier|consolas|code|typewriter/.test(name)) return 'monospace';
  if (!/sans/.test(name) && /serif|times|roman|georgia|garamond|book|minion|palatino|bodoni|didot|baskerville|caslon|century schoolbook|cambria|sabon|charter|bembo|perpetua|goudy|rockwell|constantia|cochin|hoefler|utopia|lora|merriweather|playfair|crimson|calisto|californian|centaur|footlight|high tower|modern no|sylfaen|trajan|elephant|bell mt|baskerville|plantagenet|cooper|tw cen mt condensed extra bold/.test(name)) return 'serif';
  return 'sans-serif';
}

/**
 * The fonts of one layout job. Build it with `prepare`, install it with
 * `installFontSet`, and query `familyFor` while wrapping symbol runs.
 */
export class FontSet {
  #m: Mupdf;
  #bytes = new Map<string, Uint8Array>(); // `${key}-${style}`
  #fonts = new Map<string, M.Font>();
  #base: M.Font;
  #baseCover = new Map<number, boolean>();
  /** Code point → family for characters wrapped in a span (symbols, emoji, math). */
  symbolFamily = new Map<number, string>();
  /** Code points nothing can show. */
  missing = new Set<number>();
  /** Use Noto Sans for all sans-serif text (the document is mostly outside Nimbus Sans' range). */
  notoSansBody = false;
  /** Use Noto Sans Mono for monospace text. */
  notoMono = false;

  constructor(m: Mupdf) {
    this.#m = m;
    this.#base = new m.Font('Helvetica');
  }

  /** True when Nimbus Sans (and so Roman and Mono, which share its character set) has the glyph. */
  baseCovers(cp: number): boolean {
    let v = this.#baseCover.get(cp);
    if (v === undefined) {
      v = this.#base.encodeCharacter(cp) > 0;
      this.#baseCover.set(cp, v);
    }
    return v;
  }

  has(key: string): boolean {
    return this.#bytes.has(`${key}-400`);
  }

  /** Families loaded for this job, as display names. */
  labels(): string[] {
    return [...new Set([...this.#bytes.keys()].map((k) => FAMILIES[k.replace(/-(400|700)i?$/, '')]?.label ?? k))];
  }

  async load(key: string): Promise<void> {
    const family = FAMILIES[key];
    if (!family || this.has(key)) return;
    const files = await Promise.all(family.styles.map((s) => fetchFont(`${key}-${s}.ttf`)));
    family.styles.forEach((s, i) => this.#bytes.set(`${key}-${s}`, files[i] as Uint8Array));
  }

  #font(key: string, bold: boolean, italic: boolean): M.Font | null {
    const order: Style[] = bold && italic ? ['700i', '700', '400i', '400'] : bold ? ['700', '400'] : italic ? ['400i', '400'] : ['400'];
    for (const s of order) {
      const id = `${key}-${s}`;
      const cached = this.#fonts.get(id);
      if (cached) return cached;
      const bytes = this.#bytes.get(id);
      if (bytes) {
        const family = FAMILIES[key]?.label.replace(/\s+/g, '') ?? key;
        const font = new this.#m.Font(`${family}-${STYLE_NAME[s]}`, bytes);
        this.#fonts.set(id, font);
        return font;
      }
    }
    return null;
  }

  #builtin(name: string): M.Font {
    const id = `builtin:${name}`;
    let font = this.#fonts.get(id);
    if (!font) {
      font = new this.#m.Font(name);
      this.#fonts.set(id, font);
    }
    return font;
  }

  #covers(key: string, cp: number): boolean {
    const font = this.#font(key, false, false);
    return !!font && font.encodeCharacter(cp) > 0;
  }

  /** MuPDF's font callback: family names from CSS, or a script it needs a fallback for. */
  lookup(rawName: string | undefined, rawScript: string | undefined, bold: boolean, italic: boolean): M.Font | null {
    // MuPDF.js passes a missing name or script as the string "undefined".
    const name = rawName && rawName !== 'undefined' ? rawName : undefined;
    const script = rawScript && rawScript !== 'undefined' ? rawScript : undefined;
    if (name) {
      const raw = name.toLowerCase().replace(/["']/g, '').trim();
      if (raw.startsWith('mm-')) return this.#font(raw.slice(3), bold, italic);
      const n = GENERIC_OF[raw] ?? raw;
      if (n === 'monospace' && this.notoMono) return this.#font('noto-sans-mono', bold, italic);
      if (n === 'sans-serif' && this.notoSansBody) return this.#font('noto-sans', bold, italic);
      const alias = ALIASES[n];
      if (alias && this.has(alias)) return this.#font(alias, bold, italic);
      // Answering the generic families ourselves lets MuPDF cache them (a null answer is asked again for every box).
      const builtin = BUILTIN[n];
      if (builtin) return this.#builtin(builtin[(bold ? 1 : 0) + (italic ? 2 : 0)] as string);
      // A font we do not have: the closest generic family by its name, rather than MuPDF's serif default.
      const guess = BUILTIN[genericGuess(n)] as readonly string[];
      return this.#builtin(guess[(bold ? 1 : 0) + (italic ? 2 : 0)] as string);
    }
    const key = script ? SCRIPT_FAMILY[script] : undefined;
    return key && this.has(key) ? this.#font(key, bold, italic) : null;
  }

  /**
   * Looks at every character of the document and fetches the fonts it needs.
   * `monospace` / `aliases`: whether the document uses monospace text or
   * names fonts we have metric-compatible stand-ins for.
   */
  async prepare(text: string, { monospace, names }: { monospace: boolean; names: string[] }): Promise<void> {
    const scripts = new Set<string>();
    const symbols = new Set<number>();
    let latinExtra = 0;
    let latin = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) {
        if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin += 1;
        continue;
      }
      const cp = text.codePointAt(i) as number;
      if (cp > 0xffff) i += 1;
      if (isInvisible(cp) || this.baseCovers(cp)) continue;
      if (isCjk(cp)) continue;
      const family = scriptFamily(cp);
      if (family) {
        scripts.add(family);
        if (family === 'noto-sans') latinExtra += 1;
        continue;
      }
      // Letters of scripts we have no font for: do not fetch the symbol fonts to look for them.
      if (LETTER.test(String.fromCodePoint(cp)) && !isMath(cp) && !(cp >= 0x2100 && cp <= 0x214f)) {
        this.missing.add(cp);
        continue;
      }
      symbols.add(cp);
    }
    const loads: Promise<void>[] = [...scripts].map((k) => this.load(k));
    if (monospace) {
      this.notoMono = true;
      loads.push(this.load('noto-sans-mono'));
    }
    for (const n of names) {
      const lower = n.toLowerCase();
      const alias = ALIASES[lower];
      if (alias) loads.push(this.load(alias));
      // "mm-<family>" asks for one of our families by key (noto-sans, caladea …).
      if (lower.startsWith('mm-') && FAMILIES[lower.slice(3)]) loads.push(this.load(lower.slice(3)));
    }
    await Promise.all(loads);
    // Vietnamese and similar: mixing two Latin designs inside words looks broken, so set all sans text in Noto Sans.
    this.notoSansBody = latinExtra > 0 && latinExtra * 20 > latin;

    for (const cp of symbols) {
      const candidates = isEmoji(cp)
        ? ['noto-emoji', 'noto-sans-symbols-2', 'noto-sans-symbols']
        : isMath(cp)
          ? ['noto-sans-math', 'noto-sans-symbols-2', 'noto-sans-symbols']
          : ['noto-sans-symbols-2', 'noto-sans-symbols', 'noto-sans-math', 'noto-sans', 'noto-emoji'];
      let found: string | null = null;
      for (const key of candidates) {
        await this.load(key);
        if (this.#covers(key, cp)) {
          found = key;
          break;
        }
      }
      if (found) this.symbolFamily.set(cp, found);
      else this.missing.add(cp);
    }
  }

  /** Whether monospace text (Noto Sans Mono when loaded) can show the character itself. */
  monoCovers(cp: number): boolean {
    return this.notoMono ? this.#covers('noto-sans-mono', cp) : this.baseCovers(cp);
  }

  /** The span family for a character, if it must be wrapped. */
  wrapFamily(cp: number, mono: boolean): string | null {
    const key = this.symbolFamily.get(cp);
    if (!key) return null;
    if (mono && this.monoCovers(cp)) return null;
    return key;
  }

  joinsRun(cp: number): boolean {
    return joinsEmoji(cp);
  }

  destroy(): void {
    for (const f of this.#fonts.values()) f.destroy();
    this.#fonts.clear();
    this.#base.destroy();
  }
}

let current: FontSet | null = null;
let installed = false;

/** Points MuPDF's (global) font callback at this job's fonts. */
export function installFontSet(m: Mupdf, set: FontSet | null): void {
  current = set;
  if (!installed) {
    installed = true;
    m.installLoadFontFunction((name, script, bold, italic) => current?.lookup(name, script, !!bold, !!italic) ?? null);
  }
}
