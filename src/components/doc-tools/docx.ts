/**
 * Word (.docx) → HTML for the layout engine, read straight from the OOXML:
 * styles (with inheritance), headings, runs (bold, italic, underline,
 * strike, colour, size, font, super/subscript), alignment, indents and
 * spacing, numbered and bulleted lists, tables (merged cells, borders,
 * shading, column widths), images, hyperlinks, page and section breaks,
 * footnotes and endnotes, and the document's page size and margins.
 *
 * Headers and footers (first / even / default, with PAGE and NUMPAGES
 * fields), tab stops (left, centre, right, decimal, with dot leaders),
 * highlights, footnotes (at the bottom of their page), EMF/WMF pictures
 * that wrap a bitmap, and floating pictures (placed on their own line at
 * their alignment, or over the text when they float in front of it).
 *
 * It is an approximation of Word's layout: text does not flow around
 * floating objects, comments, charts and SmartArt are not drawn.
 */
import { unzipSync } from 'fflate';
import type { PageGeometry, RunningText } from '@/engines/typeset';
import { imageDataUrl } from './images';
import { metafileKind, rasterFromMetafile } from './metafile';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

type Props = Record<string, string>;
type StyleDef = { id: string; type: string; name: string; basedOn?: string; p: Props; r: Props; table?: Element };

export type DocxResult = {
  html: string;
  css: string;
  page: PageGeometry | null;
  title?: string;
  lang?: string;
  images: number;
  /** Things that are in the file but not drawn (for a note). */
  skipped: string[];
  defaultSize: number;
  header?: RunningText;
  footer?: RunningText;
  footnotes: { id: string; html: string }[];
  /** EMF/WMF pictures drawn from the bitmap inside them. */
  metafiles: number;
};

// ── XML helpers ────────────────────────────────────────────────────────────

function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const c of el.children) if (!name || c.localName === name) out.push(c);
  return out;
}
function kid(el: Element | null | undefined, name: string): Element | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (c.localName === name) return c;
  return undefined;
}
function wattr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`);
}
function rattr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(R, name) ?? el.getAttribute(`r:${name}`);
}
function descendants(el: Element, name: string): Element[] {
  return [...el.getElementsByTagName('*')].filter((e) => e.localName === name);
}
const twip = (v: string | null | undefined) => (v ? Number(v) / 20 : 0);
const isOn = (el: Element | undefined) => {
  if (!el) return false;
  const v = wattr(el, 'val');
  return v === null || !['0', 'false', 'off', 'none'].includes(v);
};

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

function parseXml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

// ── Properties ────────────────────────────────────────────────────────────
// Run and paragraph properties are read into flat maps ("b", "i", "sz",
// "color", "jc", "ind.left" …) so styles can be merged by spreading.

function readRunProps(rPr: Element | undefined, theme: ThemeFonts): Props {
  const p: Props = {};
  if (!rPr) return p;
  for (const c of rPr.children) {
    const v = wattr(c, 'val');
    switch (c.localName) {
      case 'b':
      case 'i':
      case 'strike':
      case 'dstrike':
      case 'caps':
      case 'vanish':
        p[c.localName] = isOn(c) ? '1' : '0';
        break;
      case 'u':
        p.u = v && v !== 'none' ? '1' : '0';
        break;
      case 'color':
        if (v && v !== 'auto') p.color = v;
        break;
      case 'sz':
        if (v) p.sz = v;
        break;
      case 'vertAlign':
        if (v) p.vert = v;
        break;
      case 'highlight':
        if (v && v !== 'none') p.highlight = v;
        break;
      case 'shd': {
        const fill = wattr(c, 'fill');
        if (fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill)) p.shd = fill;
        break;
      }
      case 'rFonts': {
        const f = wattr(c, 'ascii') ?? wattr(c, 'hAnsi') ?? themeFont(wattr(c, 'asciiTheme') ?? wattr(c, 'hAnsiTheme'), theme);
        if (f) p.font = f;
        break;
      }
      case 'lang':
        if (v) p.lang = v;
        break;
      default:
    }
  }
  return p;
}

function readParaProps(pPr: Element | undefined): Props {
  const p: Props = {};
  if (!pPr) return p;
  for (const c of pPr.children) {
    const v = wattr(c, 'val');
    switch (c.localName) {
      case 'jc':
        if (v) p.jc = v;
        break;
      case 'ind':
        for (const k of ['left', 'start', 'right', 'end', 'firstLine', 'hanging']) {
          const a = wattr(c, k);
          if (a !== null) p[`ind.${k === 'start' ? 'left' : k === 'end' ? 'right' : k}`] = a;
        }
        break;
      case 'spacing':
        for (const k of ['before', 'after', 'line', 'lineRule']) {
          const a = wattr(c, k);
          if (a !== null) p[`sp.${k}`] = a;
        }
        break;
      case 'pageBreakBefore':
        p.pbb = isOn(c) ? '1' : '0';
        break;
      case 'contextualSpacing':
        p.ctx = isOn(c) ? '1' : '0';
        break;
      case 'outlineLvl':
        if (v) p.outline = v;
        break;
      case 'shd': {
        const fill = wattr(c, 'fill');
        if (fill && fill !== 'auto') p.shd = fill;
        break;
      }
      case 'numPr': {
        const id = wattr(kid(c, 'numId'), 'val');
        const lvl = wattr(kid(c, 'ilvl'), 'val');
        if (id !== null) p.numId = id;
        if (lvl !== null) p.ilvl = lvl;
        break;
      }
      case 'pBdr':
        for (const side of ['top', 'bottom', 'left', 'right']) {
          const b = kid(c, side);
          const val = wattr(b, 'val');
          if (b && val && val !== 'nil' && val !== 'none') {
            p[`bdr.${side}`] = `${Math.max(0.5, Number(wattr(b, 'sz') ?? 4) / 8)}pt solid ${color(wattr(b, 'color'))}`;
          }
        }
        break;
      default:
    }
  }
  return p;
}

type ThemeFonts = { major?: string; minor?: string };

function themeFont(name: string | null, theme: ThemeFonts): string | undefined {
  if (!name) return undefined;
  return name.startsWith('major') ? theme.major : theme.minor;
}

function color(v: string | null | undefined): string {
  return v && /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : '#000';
}

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};

function runCss(p: Props, base: Props): string {
  const css: string[] = [];
  if (p.b === '1') css.push('font-weight:bold');
  else if (p.b === '0' && base.b === '1') css.push('font-weight:normal');
  if (p.i === '1') css.push('font-style:italic');
  const deco = [p.u === '1' ? 'underline' : '', p.strike === '1' || p.dstrike === '1' ? 'line-through' : ''].filter(Boolean);
  if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
  if (p.color && p.color !== base.color) css.push(`color:${color(p.color)}`);
  if (p.sz && p.sz !== base.sz) css.push(`font-size:${Number(p.sz) / 2}pt`);
  if (p.font && p.font !== base.font) css.push(`font-family:'${p.font.replace(/'/g, '')}'`);
  if (p.vert === 'superscript') css.push('vertical-align:super;font-size:0.7em');
  if (p.vert === 'subscript') css.push('vertical-align:sub;font-size:0.7em');
  if (p.caps === '1') css.push('text-transform:uppercase');
  if (p.highlight && HIGHLIGHT[p.highlight]) css.push(`background-color:${HIGHLIGHT[p.highlight]}`);
  else if (p.shd && p.shd !== base.shd) css.push(`background-color:#${p.shd}`);
  return css.join(';');
}

// ── Lists ─────────────────────────────────────────────────────────────────

type Level = { fmt: string; text: string; start: number; ind: Props; font?: string };
type Numbering = { levels: Map<string, Level[]>; starts: Map<string, Map<number, number>> };

function readNumbering(doc: Document | null): Numbering {
  const levels = new Map<string, Level[]>();
  const starts = new Map<string, Map<number, number>>();
  if (!doc) return { levels, starts };
  const abstract = new Map<string, Level[]>();
  for (const a of kids(doc.documentElement, 'abstractNum')) {
    const lv: Level[] = [];
    for (const l of kids(a, 'lvl')) {
      const i = Number(wattr(l, 'ilvl') ?? 0);
      lv[i] = {
        fmt: wattr(kid(l, 'numFmt'), 'val') ?? 'decimal',
        text: wattr(kid(l, 'lvlText'), 'val') ?? '',
        start: Number(wattr(kid(l, 'start'), 'val') ?? 1),
        ind: readParaProps(kid(l, 'pPr')),
        font: wattr(kid(kid(l, 'rPr'), 'rFonts'), 'ascii') ?? undefined,
      };
    }
    abstract.set(wattr(a, 'abstractNumId') ?? '', lv);
  }
  for (const n of kids(doc.documentElement, 'num')) {
    const id = wattr(n, 'numId') ?? '';
    levels.set(id, abstract.get(wattr(kid(n, 'abstractNumId'), 'val') ?? '') ?? []);
    const overrides = new Map<number, number>();
    for (const o of kids(n, 'lvlOverride')) {
      const s = wattr(kid(o, 'startOverride'), 'val');
      if (s !== null) overrides.set(Number(wattr(o, 'ilvl') ?? 0), Number(s));
    }
    starts.set(id, overrides);
  }
  return { levels, starts };
}

function roman(n: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}
function letters(n: number): string {
  let s = '';
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    case 'none': return '';
    default: return String(n);
  }
}

/** Bullets in symbol fonts use private-use code points; map them to Unicode. */
function bulletChar(text: string, font?: string): string {
  const c = text.codePointAt(0) ?? 0x2022;
  const f = (font ?? '').toLowerCase();
  if (c === 0xf0b7 || c === 0xb7) return '•';
  if (c === 0xf0a7 || (f.includes('wingdings') && c === 0xa7)) return '▪';
  if (c === 0xf0d8 || c === 0xf0e8) return '➢';
  if (c === 0xf076) return '❖';
  if (c === 0xf0fc) return '✔';
  if (text === 'o' && f.includes('courier')) return '◦';
  if (c >= 0xf000 && c <= 0xf0ff) return '•';
  return text || '•';
}

class ListCounter {
  #counts = new Map<string, number[]>();
  constructor(private numbering: Numbering) {}

  label(numId: string, ilvl: number): { text: string; level: Level } | null {
    const levels = this.numbering.levels.get(numId);
    const level = levels?.[ilvl];
    if (!levels || !level) return null;
    const counts = this.#counts.get(numId) ?? [];
    const startOf = (i: number) => this.numbering.starts.get(numId)?.get(i) ?? levels[i]?.start ?? 1;
    counts[ilvl] = counts[ilvl] === undefined ? startOf(ilvl) : (counts[ilvl] as number) + 1;
    for (let d = ilvl + 1; d < counts.length; d++) counts[d] = undefined as unknown as number;
    counts.length = ilvl + 1;
    this.#counts.set(numId, counts);
    if (level.fmt === 'bullet') return { text: bulletChar(level.text, level.font), level };
    const text = level.text.replace(/%(\d)/g, (_m, d: string) => {
      const i = Number(d) - 1;
      const lv = levels[i];
      const n = counts[i] ?? startOf(i);
      return lv ? formatNumber(n, i === ilvl ? level.fmt : lv.fmt) : '';
    });
    return { text, level };
  }
}

// ── The converter ─────────────────────────────────────────────────────────

class Converter {
  styles = new Map<string, StyleDef>();
  defaultsR: Props = {};
  defaultsP: Props = {};
  rels = new Map<string, { target: string; external: boolean }>();
  theme: ThemeFonts = {};
  lists: ListCounter;
  images = 0;
  skipped = new Set<string>();
  footnotes = new Map<string, Element>();
  endnotes = new Map<string, Element>();
  noteOrder: { kind: 'footnote' | 'endnote'; id: string; n: number }[] = [];
  imageCache = new Map<string, Promise<string | null>>();
  defaultParaStyle = '';
  /** Converting a header or footer: PAGE / NUMPAGES fields become placeholders. */
  running = false;
  /** Open complex fields (fldChar begin … separate … end). */
  fields: { instr: string; result: boolean; replace: string | null }[] = [];
  /** Default tab stop distance in points. */
  defaultTab = 36;
  /** Width of the text column in points (for tab stops and floating pictures). */
  column = 451;
  /** Floating pictures of the paragraph being converted. */
  floats: string[] = [];
  metafiles = 0;
  /** Footnotes set at the bottom of their page. */
  pageNotes: { id: string; html: string }[] = [];

  constructor(
    private files: Record<string, Uint8Array>,
    numbering: Numbering,
  ) {
    this.lists = new ListCounter(numbering);
  }

  // Styles ------------------------------------------------------------------
  loadStyles(doc: Document | null) {
    if (!doc) return;
    const defaults = kid(doc.documentElement, 'docDefaults');
    this.defaultsR = readRunProps(kid(kid(defaults, 'rPrDefault'), 'rPr'), this.theme);
    this.defaultsP = readParaProps(kid(kid(defaults, 'pPrDefault'), 'pPr'));
    for (const s of kids(doc.documentElement, 'style')) {
      const id = wattr(s, 'styleId') ?? '';
      const def: StyleDef = {
        id,
        type: wattr(s, 'type') ?? 'paragraph',
        name: (wattr(kid(s, 'name'), 'val') ?? id).toLowerCase(),
        basedOn: wattr(kid(s, 'basedOn'), 'val') ?? undefined,
        p: readParaProps(kid(s, 'pPr')),
        r: readRunProps(kid(s, 'rPr'), this.theme),
        table: s,
      };
      this.styles.set(id, def);
      if (def.type === 'paragraph' && (wattr(s, 'default') === '1' || wattr(s, 'default') === 'true')) this.defaultParaStyle = id;
    }
  }

  chain(id: string | null | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    let cur = id ? this.styles.get(id) : undefined;
    for (let guard = 0; cur && guard < 20; guard++) {
      out.unshift(cur);
      cur = cur.basedOn ? this.styles.get(cur.basedOn) : undefined;
    }
    return out;
  }

  paraStyle(id: string | null): { p: Props; r: Props; name: string } {
    const chain = this.chain(id ?? this.defaultParaStyle);
    const p: Props = { ...this.defaultsP };
    const r: Props = { ...this.defaultsR };
    for (const s of chain) {
      Object.assign(p, s.p);
      Object.assign(r, s.r);
    }
    return { p, r, name: chain[chain.length - 1]?.name ?? '' };
  }

  charStyle(id: string | null): Props {
    const r: Props = {};
    for (const s of this.chain(id)) Object.assign(r, s.r);
    return r;
  }

  // Images ------------------------------------------------------------------
  async image(relId: string | null): Promise<string | null> {
    if (!relId) return null;
    const rel = this.rels.get(relId);
    if (!rel || rel.external) {
      if (rel?.external) this.skipped.add('linked images (never downloaded)');
      return null;
    }
    const path = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`.replace(/\/\.\//g, '/');
    const normal = path.split('/').reduce<string[]>((acc, seg) => (seg === '..' ? acc.slice(0, -1) : [...acc, seg]), []).join('/');
    let p = this.imageCache.get(normal);
    if (!p) {
      const bytes = this.files[normal];
      if (!bytes) return null;
      let data: Uint8Array = bytes;
      if (/\.(emf|wmf)$/i.test(normal) || metafileKind(bytes)) {
        const raster = rasterFromMetafile(bytes);
        if (!raster) {
          this.skipped.add('EMF/WMF vector drawings');
          return null;
        }
        this.metafiles += 1;
        data = raster;
      }
      p = imageDataUrl(new Blob([new Uint8Array(data)]));
      this.imageCache.set(normal, p);
    }
    const url = await p;
    if (url) this.images += 1;
    else this.skipped.add('images in formats the browser cannot decode');
    return url;
  }

  // Runs --------------------------------------------------------------------
  async runs(container: Element, base: Props, out: string[], state: { breakAfter: boolean }): Promise<void> {
    for (const el of container.children) {
      switch (el.localName) {
        case 'r':
          await this.run(el, base, out, state);
          break;
        case 'hyperlink': {
          const id = rattr(el, 'id');
          const anchor = wattr(el, 'anchor');
          const rel = id ? this.rels.get(id) : undefined;
          const href = rel?.external ? rel.target : anchor ? `#${anchor}` : null;
          const inner: string[] = [];
          await this.runs(el, base, inner, state);
          out.push(href && /^(https?:|mailto:|#)/i.test(href) ? `<a href="${esc(href)}">${inner.join('')}</a>` : inner.join(''));
          break;
        }
        case 'fldSimple': {
          const code = fieldCode(wattr(el, 'instr') ?? '');
          if (this.running && code) {
            const rPr = kid(kid(el, 'r'), 'rPr');
            const props: Props = { ...base, ...readRunProps(rPr, this.theme) };
            const css = runCss(props, base);
            out.push(css ? `<span style="${css}">${code}</span>` : code);
          } else await this.runs(el, base, out, state);
          break;
        }
        case 'ins':
        case 'smartTag':
        case 'customXml':
        case 'dir':
        case 'bdo':
          await this.runs(el, base, out, state);
          break;
        case 'sdt':
          await this.runs(kid(el, 'sdtContent') ?? el, base, out, state);
          break;
        case 'bookmarkStart': {
          const name = wattr(el, 'name');
          if (name && !name.startsWith('_')) out.push(`<a id="${esc(name)}"></a>`);
          break;
        }
        case 'oMath':
        case 'oMathPara': {
          const text = descendants(el, 't').map((t) => t.textContent ?? '').join('');
          if (text) out.push(`<i>${esc(text)}</i>`);
          this.skipped.add('equations (shown as plain text)');
          break;
        }
        default:
      }
    }
  }

  async run(r: Element, base: Props, out: string[], state: { breakAfter: boolean }): Promise<void> {
    const rPr = kid(r, 'rPr');
    const props: Props = { ...base, ...this.charStyle(wattr(kid(rPr, 'rStyle'), 'val')), ...readRunProps(rPr, this.theme) };
    if (props.vanish === '1') return;
    const css = runCss(props, base);
    const parts: string[] = [];
    const field = this.fields[this.fields.length - 1];
    for (const c of r.children) {
      // Inside a field's result that is replaced (page numbers in headers): skip the cached text.
      if (field?.result && field.replace !== null && c.localName !== 'fldChar') continue;
      switch (c.localName) {
        case 'fldChar': {
          const type = wattr(c, 'fldCharType');
          if (type === 'begin') this.fields.push({ instr: '', result: false, replace: null });
          else if (type === 'separate') {
            const f = this.fields[this.fields.length - 1];
            if (f) {
              f.result = true;
              f.replace = this.running ? fieldCode(f.instr) : null;
              if (f.replace) parts.push(f.replace);
            }
          } else if (type === 'end') {
            const f = this.fields.pop();
            // A field without a separate (no cached result): still show the page number.
            if (f && !f.result && this.running) {
              const code = fieldCode(f.instr);
              if (code) parts.push(code);
            }
          }
          break;
        }
        case 'instrText': {
          const f = this.fields[this.fields.length - 1];
          if (f && !f.result) f.instr += c.textContent ?? '';
          break;
        }
        case 't':
          // A tab character typed into the text counts as a tab, as in Word.
          parts.push(esc(c.textContent ?? '').replace(/\t/g, TAB));
          break;
        case 'tab':
          parts.push(TAB);
          break;
        case 'ptab': {
          const align = wattr(c, 'alignment') ?? 'left';
          parts.push(`\u0000PTAB:${align}\u0000`);
          break;
        }
        case 'br':
        case 'cr': {
          const type = wattr(c, 'type');
          if (type === 'page') {
            parts.push('\u0000PAGEBREAK\u0000');
            state.breakAfter = false;
          } else parts.push('<br>');
          break;
        }
        case 'noBreakHyphen':
          parts.push('‑');
          break;
        case 'softHyphen':
          parts.push('­');
          break;
        case 'sym': {
          const ch = wattr(c, 'char');
          if (ch) parts.push(esc(bulletChar(String.fromCharCode(parseInt(ch, 16)), wattr(c, 'font') ?? undefined)));
          break;
        }
        case 'drawing':
        case 'pict':
        case 'object':
          parts.push(await this.drawing(c));
          break;
        case 'AlternateContent': {
          const choice = kid(c, 'Choice');
          const fallback = kid(c, 'Fallback');
          parts.push(await this.drawing(choice ?? fallback ?? c));
          break;
        }
        case 'footnoteReference':
        case 'endnoteReference': {
          const kind = c.localName === 'footnoteReference' ? 'footnote' : 'endnote';
          const id = wattr(c, 'id') ?? '';
          const n = this.noteOrder.filter((x) => x.kind === kind).length + 1;
          this.noteOrder.push({ kind, id, n });
          const label = kind === 'footnote' ? String(n) : roman(n);
          // Footnotes go to the bottom of their page (the engine finds the page by this link).
          const href = kind === 'footnote' ? `#mm-fn-${id}` : `#mm-${kind}-${id}`;
          parts.push(`<a href="${href}"><span style="vertical-align:super;font-size:0.7em">${label}</span></a>`);
          break;
        }
        default:
      }
    }
    const html = parts.join('');
    if (!html) return;
    if (!css) {
      out.push(html);
      return;
    }
    // Tab markers stay outside the styled spans, so the paragraph can be split at them.
    out.push(
      html
        .split(/(\u0000(?:TAB|PTAB:\w+)\u0000)/)
        .map((piece) => (piece.startsWith('\u0000') || piece === '' ? piece : `<span style="${css}">${piece}</span>`))
        .join(''),
    );
  }

  async drawing(el: Element): Promise<string> {
    // Pictures: <a:blip r:embed> (DrawingML) or <v:imagedata r:id> (VML).
    const out: string[] = [];
    // A floating picture (wp:anchor): placed on its own line at its alignment, or over the text when it does not wrap.
    const anchor = descendants(el, 'anchor')[0];
    if (anchor && descendants(anchor, 'txbxContent').length === 0) {
      const float = await this.floating(anchor);
      if (float !== null) {
        this.floats.push(float);
        return '';
      }
    }
    const blips = descendants(el, 'blip');
    const extents = descendants(el, 'extent');
    for (const [i, blip] of blips.entries()) {
      const url = await this.image(rattr(blip, 'embed') ?? rattr(blip, 'link'));
      if (!url) continue;
      const ext = extents[i] ?? extents[0];
      const w = ext ? Number(ext.getAttribute('cx')) / 12700 : 0;
      out.push(`<img src="${url}"${w > 0 ? ` style="width:${w.toFixed(1)}pt"` : ''}>`);
    }
    for (const im of descendants(el, 'imagedata')) {
      const url = await this.image(rattr(im, 'id'));
      if (url) out.push(`<img src="${url}">`);
    }
    // Text boxes: their paragraphs, inline.
    for (const box of descendants(el, 'txbxContent')) {
      out.push(`<span style="font-style:inherit">${(await this.blocks(box)).replace(/<\/?p[^>]*>/g, ' ')}</span>`);
      this.skipped.add('text boxes (placed inline)');
    }
    if (blips.length === 0 && descendants(el, 'imagedata').length === 0 && descendants(el, 'txbxContent').length === 0) {
      if (descendants(el, 'chart').length) this.skipped.add('charts');
      else if (descendants(el, 'relIds').length) this.skipped.add('SmartArt');
      else if (el.localName === 'object') this.skipped.add('embedded objects');
    }
    return out.join('');
  }

  /** HTML for a floating picture: a block before the paragraph, or null to place it inline. */
  async floating(anchor: Element): Promise<string | null> {
    const blip = descendants(anchor, 'blip')[0];
    if (!blip) return null;
    const url = await this.image(rattr(blip, 'embed') ?? rattr(blip, 'link'));
    if (!url) return '';
    const ext = kid(anchor, 'extent');
    const w = ext ? Number(ext.getAttribute('cx')) / 12700 : 0;
    const h = ext ? Number(ext.getAttribute('cy')) / 12700 : 0;
    const posH = kid(anchor, 'positionH');
    const posV = kid(anchor, 'positionV');
    const fromH = posH?.getAttribute('relativeFrom') ?? 'column';
    const alignH = kid(posH, 'align')?.textContent?.trim();
    const offH = Number(kid(posH, 'posOffset')?.textContent ?? 0) / 12700;
    const offV = Number(kid(posV, 'posOffset')?.textContent ?? 0) / 12700;
    const fromV = posV?.getAttribute('relativeFrom') ?? 'paragraph';
    // Horizontal position inside the text column.
    let x: number;
    if (alignH === 'center') x = (this.column - w) / 2;
    else if (alignH === 'right' || alignH === 'outside') x = this.column - w;
    else if (alignH) x = 0;
    else x = fromH === 'page' ? offH - this.marginLeft : fromH === 'margin' || fromH === 'column' ? offH : offH;
    x = Math.max(-this.marginLeft, Math.min(x, this.column - Math.min(w, this.column)));
    const size = `width:${w.toFixed(1)}pt${h > 0 ? `;height:${h.toFixed(1)}pt` : ''}`;
    const behind = anchor.getAttribute('behindDoc') === '1' || anchor.getAttribute('behindDoc') === 'true';
    const wrapNone = !!kid(anchor, 'wrapNone') || behind;
    if (wrapNone) {
      // In front of (or behind) the text: drawn over the paragraph at its offset, taking no room.
      const y = fromV === 'paragraph' || fromV === 'line' ? offV : 0;
      return `${OVERLAY}<div style="position:absolute;left:${x.toFixed(1)}pt;top:${y.toFixed(1)}pt;${size};margin:0;padding:0;text-indent:0"><img src="${url}" style="${size}"></div>`;
    }
    this.skipped.add('text wrapping around floating pictures (placed on their own line)');
    const top = fromV === 'paragraph' && offV > 0 && offV < 200 ? offV : 0;
    return `<div style="margin:${top.toFixed(1)}pt 0 4pt ${Math.max(0, x).toFixed(1)}pt;padding:0;line-height:1"><img src="${url}" style="${size}"></div>`;
  }

  marginLeft = 72;

  /** Tab stops of a paragraph (points from the paragraph's left edge = the column's left). */
  tabStops(pPr: Element | undefined, styleTabs: Element[]): { pos: number; align: string; leader: string }[] {
    const stops = new Map<number, { pos: number; align: string; leader: string }>();
    for (const t of [...styleTabs, ...kids(kid(pPr, 'tabs'), 'tab')]) {
      const pos = twip(wattr(t, 'pos'));
      const val = wattr(t, 'val') ?? 'left';
      if (val === 'clear') stops.delete(Math.round(pos));
      else stops.set(Math.round(pos), { pos, align: val === 'end' ? 'right' : val === 'start' ? 'left' : val, leader: wattr(t, 'leader') ?? 'none' });
    }
    return [...stops.values()].filter((s) => s.align !== 'bar').sort((a, b) => a.pos - b.pos);
  }

  /** Lays out a paragraph whose text has tab characters (see layoutTabs). */
  tabbed(inner: string, o: { stops: { pos: number; align: string; leader: string }[]; left: number; first: number; size: number; label: string }): string | null {
    return layoutTabs(inner, { ...o, column: this.column, defaultTab: this.defaultTab });
  }

  // Paragraphs --------------------------------------------------------------
  async paragraph(p: Element): Promise<string> {
    const pPr = kid(p, 'pPr');
    const styleId = wattr(kid(pPr, 'pStyle'), 'val');
    const style = this.paraStyle(styleId);
    const props: Props = { ...style.p, ...readParaProps(pPr) };
    const runBase: Props = { ...style.r, ...readRunProps(kid(pPr, 'rPr'), this.theme) };
    delete runBase.vanish;

    const css: string[] = [];
    const jc = props.jc;
    if (jc === 'center') css.push('text-align:center');
    else if (jc === 'right' || jc === 'end') css.push('text-align:right');
    else if (jc === 'both' || jc === 'distribute') css.push('text-align:justify');

    let left = twip(props['ind.left']);
    const right = twip(props['ind.right']);
    let first = props['ind.hanging'] ? -twip(props['ind.hanging']) : twip(props['ind.firstLine']);

    // List label.
    let label = '';
    const numId = props.numId;
    if (numId && numId !== '0') {
      const res = this.lists.label(numId, Number(props.ilvl ?? 0));
      if (res) {
        const lv = res.level.ind;
        if (!props['ind.left'] && lv['ind.left']) left = twip(lv['ind.left']);
        if (!props['ind.hanging'] && !props['ind.firstLine']) {
          first = lv['ind.hanging'] ? -twip(lv['ind.hanging']) : twip(lv['ind.firstLine']);
        }
        if (res.text) label = esc(res.text);
      }
    }
    if (left) css.push(`margin-left:${left}pt`);
    if (right) css.push(`margin-right:${right}pt`);
    if (first) css.push(`text-indent:${first}pt`);

    const contextual = props.ctx === '1';
    const before = contextual ? 0 : twip(props['sp.before']);
    const after = contextual ? 0 : twip(props['sp.after']);
    if (before) css.push(`margin-top:${before}pt`);
    if (after) css.push(`margin-bottom:${after}pt`);
    const line = props['sp.line'];
    if (line) {
      const rule = props['sp.lineRule'] ?? 'auto';
      // Word's "single" spacing is the font's natural line, about 1.17 em.
      if (rule === 'auto') css.push(`line-height:${((Number(line) / 240) * 1.17).toFixed(3)}`);
      else if (rule === 'atLeast') {
        // "At least": never below the natural line (an at-least of 0 is just single spacing).
        const natural = (Number(runBase.sz ?? 20) / 2) * 1.17;
        if (twip(line) > natural) css.push(`line-height:${twip(line)}pt`);
      } else if (twip(line) > 0) css.push(`line-height:${twip(line)}pt`);
    }
    if (props.shd) css.push(`background-color:#${props.shd}`);
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const b = props[`bdr.${side}`];
      if (b) css.push(`border-${side}:${b};padding-${side}:2pt`);
    }
    const rcss = runCss(runBase, {});
    if (rcss) css.push(rcss);

    const state = { breakAfter: false };
    const content: string[] = [];
    const outerFloats = this.floats;
    this.floats = [];
    await this.runs(p, runBase, content, state);
    const floats = this.floats;
    this.floats = outerFloats;
    let inner = content.join('');
    // Tab stops (and the list label, which sits in the hanging indent like a tab).
    const size = Number(runBase.sz ?? 20) / 2;
    const hasTabs = inner.includes('\u0000');
    if (label || hasTabs) {
      const styleTabs = this.chain(styleId ?? this.defaultParaStyle).flatMap((st) => kids(kid(kid(st.table, 'pPr'), 'tabs'), 'tab'));
      const laid = this.tabbed((label ? `${label}${TAB}` : '') + inner, { stops: this.tabStops(pPr, styleTabs), left, first, size, label });
      if (laid !== null) {
        inner = laid;
        if (laid.includes('position:absolute')) css.push('position:relative');
        const at = css.findIndex((c) => c.startsWith('text-indent:'));
        if (at >= 0 && laid.includes('class="mm-hang"')) css.splice(at, 1);
      } else inner = (label ? `${label}&#160;` : '') + inner.replace(/\u0000(TAB|PTAB:\w+)\u0000/g, '&#160;&#160;&#160;&#160;');
      label = '';
    }

    // Heading level: Word's heading styles, or an outline level.
    const named = /^heading (\d)$/.exec(style.name)?.[1];
    const outline = props.outline !== undefined && Number(props.outline) < 9 ? Number(props.outline) + 1 : undefined;
    const level = Math.min(6, Number(named ?? outline ?? 0));
    const tag = level >= 1 ? `h${level}` : 'p';
    const isTitle = style.name === 'title';

    const plain = inner.replace(/<[^>]+>/g, '').replace(/\u0000PAGEBREAK\u0000/g, '').trim();
    const pageBreakBefore = props.pbb === '1';
    // Pictures in front of or behind the text: positioned inside the paragraph, at the end (see layoutTabs).
    const overlays = floats.filter((f) => f.startsWith(OVERLAY)).map((f) => f.slice(OVERLAY.length));
    const blocks = floats.filter((f) => !f.startsWith(OVERLAY));
    if (overlays.length > 0 && !css.includes('position:relative')) css.push('position:relative');
    const styleAttr = css.length ? ` style="${css.join(';')}"` : '';
    // Positioned pieces (tab stops, hanging labels) are divs: a div inside a <p> would close it.
    const block = isTitle || tag === 'p' ? (css.includes('position:relative') ? 'div' : 'p') : tag;
    const open = `<${block}${styleAttr}>`;
    const close = `</${block}>`;
    // Manual page breaks split the paragraph.
    const pieces = inner.split('\u0000PAGEBREAK\u0000');
    const html = pieces
      .map((piece, i) => {
        const body = (i === 0 ? label : '') + piece;
        const empty = body.replace(/<[^>]+>/g, '').trim() === '' && !/<img/.test(body);
        // Empty paragraphs still take a line in Word.
        if (empty && pieces.length > 1) return '';
        return `${open}${empty ? '&#160;' : body}${i === 0 ? overlays.join('') : ''}${close}`;
      })
      .join(PAGE_BREAK_HTML);
    inner = html;
    if (!plain && !/<img/.test(inner) && pieces.length === 1 && !label) inner = `${open}&#160;${overlays.join('')}${close}`;
    return (pageBreakBefore ? PAGE_BREAK_HTML : '') + blocks.join('') + inner;
  }

  // Tables ------------------------------------------------------------------
  tableBorders(tbl: Element): { inside: string | null; outer: string | null } {
    const tblPr = kid(tbl, 'tblPr');
    const own = kid(tblPr, 'tblBorders');
    const styleId = wattr(kid(tblPr, 'tblStyle'), 'val');
    let borders = own;
    if (!borders) {
      for (const s of this.chain(styleId).reverse()) {
        const b = kid(kid(s.table, 'tblPr'), 'tblBorders');
        if (b) {
          borders = b;
          break;
        }
      }
    }
    const read = (side: string) => {
      const b = kid(borders, side);
      const val = wattr(b, 'val');
      if (!b || !val || val === 'nil' || val === 'none') return null;
      return `${Math.max(0.5, Number(wattr(b, 'sz') ?? 4) / 8)}pt solid ${color(wattr(b, 'color'))}`;
    };
    return { inside: read('insideH') ?? read('insideV'), outer: read('top') ?? read('left') ?? read('bottom') };
  }

  async table(tbl: Element): Promise<string> {
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => twip(wattr(g, 'w')));
    const { inside, outer } = this.tableBorders(tbl);
    const border = inside ?? outer;
    const rows = kids(tbl, 'tr');
    // Vertical merges: count how many rows each "restart" cell spans.
    type Cell = { el: Element; col: number; span: number; vmerge: string | null };
    const layout: Cell[][] = rows.map((tr) => {
      let col = 0;
      return kids(tr, 'tc').map((tc) => {
        const tcPr = kid(tc, 'tcPr');
        const span = Number(wattr(kid(tcPr, 'gridSpan'), 'val') ?? 1);
        const vm = kid(tcPr, 'vMerge');
        const cell = { el: tc, col, span, vmerge: vm ? (wattr(vm, 'val') ?? 'continue') : null };
        col += span;
        return cell;
      });
    });
    const tblW = grid.reduce((a, b) => a + b, 0);
    let html = `<table style="border-collapse:collapse;margin:2pt 0 6pt${tblW ? `;width:${tblW.toFixed(1)}pt` : ''}">`;
    for (let r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (const cell of layout[r] as Cell[]) {
        if (cell.vmerge === 'continue') continue;
        let rowspan = 1;
        if (cell.vmerge === 'restart') {
          for (let k = r + 1; k < rows.length; k++) {
            const below = (layout[k] as Cell[]).find((c) => c.col === cell.col);
            if (below?.vmerge === 'continue') rowspan += 1;
            else break;
          }
        }
        const tcPr = kid(cell.el, 'tcPr');
        const css: string[] = [];
        const width = grid.slice(cell.col, cell.col + cell.span).reduce((a, b) => a + b, 0);
        if (width) css.push(`width:${Math.max(4, width - 10.8).toFixed(1)}pt`);
        if (border) css.push(`border:${border}`);
        const fill = wattr(kid(tcPr, 'shd'), 'fill');
        if (fill && fill !== 'auto') css.push(`background-color:#${fill}`);
        const va = wattr(kid(tcPr, 'vAlign'), 'val');
        if (va === 'center') css.push('vertical-align:middle');
        else if (va === 'bottom') css.push('vertical-align:bottom');
        for (const side of ['top', 'bottom', 'left', 'right']) {
          const b = kid(kid(tcPr, 'tcBorders'), side);
          const val = wattr(b, 'val');
          if (b && val) css.push(val === 'nil' || val === 'none' ? `border-${side}:none` : `border-${side}:${Math.max(0.5, Number(wattr(b, 'sz') ?? 4) / 8)}pt solid ${color(wattr(b, 'color'))}`);
        }
        const attrs = `${cell.span > 1 ? ` colspan="${cell.span}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
        html += `<td${attrs} style="${css.join(';')}">${await this.blocks(cell.el)}</td>`;
      }
      html += '</tr>';
    }
    return `${html}</table>`;
  }

  // Block containers ---------------------------------------------------------
  async blocks(container: Element): Promise<string> {
    const out: string[] = [];
    for (const el of container.children) {
      switch (el.localName) {
        case 'p': {
          out.push(await this.paragraph(el));
          // A section break that starts a new page.
          const sect = kid(kid(el, 'pPr'), 'sectPr');
          if (sect) {
            const type = wattr(kid(sect, 'type'), 'val') ?? 'nextPage';
            if (type !== 'continuous') out.push(PAGE_BREAK_HTML);
          }
          break;
        }
        case 'tbl':
          out.push(await this.table(el));
          break;
        case 'sdt':
          out.push(await this.blocks(kid(el, 'sdtContent') ?? el));
          break;
        case 'customXml':
        case 'ins':
          out.push(await this.blocks(el));
          break;
        default:
      }
    }
    return out.join('\n');
  }

  async notes(): Promise<string> {
    let html = '';
    for (const { kind, id, n } of this.noteOrder) {
      const el = (kind === 'footnote' ? this.footnotes : this.endnotes).get(id);
      if (!el) continue;
      const body = (await this.blocks(el)).replace(/^<p([^>]*)>/, '<p$1><span style="vertical-align:super;font-size:0.7em">LABEL</span> ');
      const note = `<div id="mm-${kind}-${id}" style="font-size:0.85em">${body.replace('LABEL', kind === 'footnote' ? String(n) : roman(n))}</div>`;
      if (kind === 'footnote') this.pageNotes.push({ id, html: note });
      else html += note;
    }
    return html ? `<hr style="margin:18pt 0 6pt;width:30%;border:none;border-top:0.75pt solid #000">${html}` : '';
  }

  /** A header or footer part as HTML (its own relationships for pictures). */
  async runningPart(target: string | undefined, dir: string): Promise<string | undefined> {
    if (!target) return undefined;
    const path = target.startsWith('/') ? target.slice(1) : `${dir}${target}`;
    const doc = parseXml(this.files[path]);
    if (!doc) return undefined;
    const rels = this.rels;
    this.rels = readRels(parseXml(this.files[`${path.slice(0, path.lastIndexOf('/') + 1)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`]));
    this.running = true;
    this.fields = [];
    try {
      const html = await this.blocks(doc.documentElement);
      return html.replace(/<p[^>]*>&#160;<\/p>\s*$/, '');
    } finally {
      this.running = false;
      this.fields = [];
      this.rels = rels;
    }
  }
}

const TAB = '\u0000TAB\u0000';
/** Marks a floating picture that is drawn over the paragraph rather than before it. */
const OVERLAY = '\u0001overlay\u0001';

/** PAGE / NUMPAGES field codes → the engine's placeholders. */
function fieldCode(instr: string): string | null {
  const name = instr.trim().split(/\s+/)[0]?.toUpperCase();
  if (name === 'PAGE') return '{{PAGE}}';
  if (name === 'NUMPAGES' || name === 'SECTIONPAGES') return '{{NUMPAGES}}';
  return null;
}

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

/** Approximate text width in points (canvas text metrics when there is a canvas, else an average). */
function textWidth(html: string, size: number): number {
  const text = html.replace(/<[^>]*>/g, '').replace(/&#160;|&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx) {
    measureCtx.font = `${size}pt Calibri, Carlito, Arial, sans-serif`;
    return (measureCtx.measureText(text).width * 72) / 96;
  }
  return text.length * size * 0.5;
}

const LEADER: Record<string, string> = { dot: '.', hyphen: '-', underscore: '_', middleDot: '·', heavy: '_' };

/**
 * A paragraph with tab characters: the text before the first tab flows
 * normally, every later piece is placed at its tab stop (left, centre,
 * right or decimal, with leader dots), relative to the paragraph. Text
 * after the last tab wraps when the paragraph has a hanging indent (list
 * labels, "1.<tab>Heading"). Returns null when the pieces do not fit on one
 * line (the caller then uses spaces).
 */
function layoutTabs(
  inner: string,
  o: { stops: { pos: number; align: string; leader: string }[]; left: number; first: number; size: number; label: string; column: number; defaultTab: number },
): string | null {
  const pieces = inner.split(/\u0000(TAB|PTAB:\w+)\u0000/);
  // pieces: text, kind, text, kind, text …
  const texts: string[] = [];
  const kinds: string[] = [];
  for (let i = 0; i < pieces.length; i++) (i % 2 === 0 ? texts : kinds).push(pieces[i] as string);
  if (texts.some((t) => (t.match(/<a\b/g)?.length ?? 0) !== (t.match(/<\/a>/g)?.length ?? 0))) return null;
  const start = o.left + o.first; // first line starts here (relative to the column)
  // Hanging indent: the first tab goes to the indent, and the rest wraps there.
  if (o.first < 0 && kinds.length >= 1 && kinds[0] === 'TAB') {
    const labelWidth = textWidth(texts[0] as string, o.size);
    const explicit = o.stops.find((s) => s.pos > start + labelWidth + 0.5 && s.pos < o.left);
    if (!explicit) {
      const rest = texts.slice(1).map((t, i) => (i === 0 ? t : `&#160;&#160;&#160;&#160;${t}`)).join('');
      // The positioned label comes after the text: before it, MuPDF would start the text on a new line.
      return `${rest || '&#160;'}<div class="mm-hang" style="position:absolute;left:${o.first.toFixed(1)}pt;top:0;width:${(-o.first).toFixed(1)}pt;margin:0;padding:0;text-indent:0;text-align:left">${texts[0]}</div>`;
    }
  }
  // One line of positioned pieces.
  let x = start + textWidth(texts[0] as string, o.size);
  let html = texts[0] as string;
  for (let k = 0; k < kinds.length; k++) {
    const text = texts[k + 1] as string;
    const w = textWidth(text, o.size);
    const kind = kinds[k] as string;
    let stop: { pos: number; align: string; leader: string };
    if (kind.startsWith('PTAB:')) {
      const a = kind.slice(5);
      stop = { pos: a === 'center' ? o.column / 2 : a === 'right' ? o.column : 0, align: a === 'center' ? 'center' : a === 'right' ? 'right' : 'left', leader: 'none' };
    } else {
      stop = o.stops.find((s) => s.pos > x + 0.5) ?? { pos: (Math.floor(x / o.defaultTab) + 1) * o.defaultTab, align: 'left', leader: 'none' };
      if (o.first < 0 && x < o.left - 0.5 && stop.pos > o.left) stop = { pos: o.left, align: 'left', leader: 'none' };
    }
    let left = stop.pos;
    let width = Math.max(4, o.column - stop.pos);
    let align = 'left';
    if (stop.align === 'right' || stop.align === 'decimal') {
      left = stop.pos - w;
      width = w + 2;
      align = 'right';
    } else if (stop.align === 'center') {
      left = stop.pos - w / 2;
      width = w + 2;
      align = 'center';
    }
    if (left < x - 1 || left + w > o.column + 8 || (align === 'left' && w > width + 2 && k < kinds.length - 1)) return null;
    const lead = LEADER[stop.leader];
    if (lead && left - x > 6) {
      const n = Math.floor((left - x - 4) / Math.max(1, textWidth(lead, o.size)));
      html += `<div style="position:absolute;left:${(x + 2 - o.left).toFixed(1)}pt;top:0;width:${(left - x - 2).toFixed(1)}pt;margin:0;padding:0;text-indent:0;text-align:right;white-space:nowrap">${lead.repeat(Math.max(0, n))}</div>`;
    }
    const wrapLast = align === 'left' && k === kinds.length - 1;
    html += `<div style="position:absolute;left:${(left - o.left).toFixed(1)}pt;top:0;width:${(wrapLast ? width : width).toFixed(1)}pt;margin:0;padding:0;text-indent:0;text-align:${align};white-space:${wrapLast ? 'normal' : 'nowrap'}">${text}</div>`;
    x = left + w;
    if (wrapLast && w > width) return null;
  }
  // Keep the line's height when the first piece is empty.
  return (texts[0] as string).replace(/<[^>]*>/g, '').trim() === '' ? `&#160;${html}` : html;
}

/** The engine's page break (the same markup as PAGE_BREAK in src/engines/typeset/html.ts). */
const PAGE_BREAK_HTML = '<div class="mm-page-break"></div><div class="mm-after-break"></div>';

function readRels(doc: Document | null): Map<string, { target: string; external: boolean }> {
  const map = new Map<string, { target: string; external: boolean }>();
  if (!doc) return map;
  for (const r of doc.getElementsByTagName('Relationship')) {
    map.set(r.getAttribute('Id') ?? '', { target: r.getAttribute('Target') ?? '', external: r.getAttribute('TargetMode') === 'External' });
  }
  return map;
}

function readTheme(doc: Document | null): ThemeFonts {
  if (!doc) return {};
  const font = (name: string) => {
    const el = [...doc.getElementsByTagName('*')].find((e) => e.localName === name);
    const latin = el ? [...el.children].find((c) => c.localName === 'latin') : undefined;
    return latin?.getAttribute('typeface') || undefined;
  };
  return { major: font('majorFont'), minor: font('minorFont') };
}

function pageOf(sect: Element | undefined): PageGeometry | null {
  const sz = kid(sect, 'pgSz');
  const mar = kid(sect, 'pgMar');
  if (!sz) return null;
  const width = twip(wattr(sz, 'w'));
  const height = twip(wattr(sz, 'h'));
  if (!(width > 50 && height > 50)) return null;
  const m = (k: string, d: number) => {
    const v = wattr(mar, k);
    return v === null ? d : Math.max(0, Math.abs(Number(v)) / 20);
  };
  return { width, height, margin: { top: m('top', 72), right: m('right', 72), bottom: m('bottom', 72), left: m('left', 72) } };
}

export async function docxToHtml(data: ArrayBuffer): Promise<DocxResult> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error('This file is not a valid Word document (.docx). Old .doc files need to be saved as .docx first.');
  }
  // Find the main part through the package relationships.
  const pkg = readRels(parseXml(files['_rels/.rels']));
  const mainTarget = [...pkg.values()].find((r) => /document(2)?\.xml$/.test(r.target))?.target ?? 'word/document.xml';
  const main = mainTarget.replace(/^\//, '');
  const doc = parseXml(files[main]);
  if (!doc) {
    if (files['xl/workbook.xml']) throw new Error('This is a spreadsheet, not a Word document. Use Excel to PDF.');
    if (files['ppt/presentation.xml']) throw new Error('This is a presentation, not a Word document.');
    throw new Error('This file is not a valid Word document (no readable document.xml).');
  }
  const dir = main.slice(0, main.lastIndexOf('/') + 1);
  const conv = new Converter(files, readNumbering(parseXml(files[`${dir}numbering.xml`])));
  conv.theme = readTheme(parseXml(files[`${dir}theme/theme1.xml`]));
  conv.loadStyles(parseXml(files[`${dir}styles.xml`]));
  conv.rels = readRels(parseXml(files[`${dir}_rels/${main.slice(dir.length)}.rels`]));
  for (const [kind, name] of [['footnote', 'footnotes.xml'], ['endnote', 'endnotes.xml']] as const) {
    const notes = parseXml(files[`${dir}${name}`]);
    for (const n of kids(notes?.documentElement, kind)) (kind === 'footnote' ? conv.footnotes : conv.endnotes).set(wattr(n, 'id') ?? '', n);
  }
  const body = kid(doc.documentElement, 'body');
  if (!body) throw new Error('This Word document has no body.');
  if (files[`${dir}comments.xml`]) conv.skipped.add('comments');
  const settings = parseXml(files[`${dir}settings.xml`]);
  const defTab = wattr(kid(settings?.documentElement, 'defaultTabStop'), 'val');
  if (defTab && Number(defTab) > 0) conv.defaultTab = Number(defTab) / 20;
  const evenOdd = isOn(kid(settings?.documentElement, 'evenAndOddHeaders'));
  const sect = kid(body, 'sectPr') ?? descendants(body, 'sectPr').pop();
  const geometry = pageOf(sect);
  if (geometry) {
    conv.column = geometry.width - geometry.margin.left - geometry.margin.right;
    conv.marginLeft = geometry.margin.left;
  }

  let html = await conv.blocks(body);
  html += await conv.notes();

  // Headers and footers of the (last) section.
  const titlePg = isOn(kid(sect, 'titlePg'));
  const pgMar = kid(sect, 'pgMar');
  const running = async (kind: 'header' | 'footer'): Promise<RunningText | undefined> => {
    const refs = new Map<string, string>();
    // Sections without their own references continue the previous section's.
    for (const s of [...descendants(body, 'sectPr')]) {
      for (const r of kids(s, `${kind}Reference`)) refs.set(wattr(r, 'type') ?? 'default', rattr(r, 'id') ?? '');
    }
    if (refs.size === 0) return undefined;
    const target = (type: string) => conv.rels.get(refs.get(type) ?? '')?.target;
    const out: RunningText = {
      distance: twip(wattr(pgMar, kind) ?? '708'),
      default: await conv.runningPart(target('default'), dir),
    };
    if (titlePg) out.first = (await conv.runningPart(target('first'), dir)) ?? '';
    if (evenOdd) out.even = (await conv.runningPart(target('even'), dir)) ?? '';
    const empty = (h: string | undefined) => !h || h.replace(/<[^>]*>|&#160;/g, '').trim() === '' && !/<img/.test(h);
    if (empty(out.default) && empty(out.first) && empty(out.even)) return undefined;
    return out;
  };
  const header = await running('header');
  const footer = await running('footer');

  const core = parseXml(files['docProps/core.xml']);
  const title = [...(core?.getElementsByTagName('*') ?? [])].find((e) => e.localName === 'title')?.textContent?.trim() || undefined;
  const base = conv.paraStyle(null).r;
  const size = Number(base.sz ?? conv.defaultsR.sz ?? 20) / 2;
  const font = base.font ?? conv.theme.minor ?? 'Calibri';
  const css = `body{margin:0;color:#000;font-family:'${font.replace(/'/g, '')}';font-size:${size}pt;line-height:1.17}
p,h1,h2,h3,h4,h5,h6{margin:0;padding:0;border:none;font-size:inherit;font-weight:normal;line-height:inherit}
table{border-collapse:collapse}
td{vertical-align:top;padding:0 5.4pt}
img{max-width:100%}
a{color:inherit;text-decoration:none}`;
  return {
    html,
    css,
    page: geometry,
    title,
    lang: base.lang,
    images: conv.images,
    skipped: [...conv.skipped],
    defaultSize: size,
    header,
    footer,
    footnotes: conv.pageNotes,
    metafiles: conv.metafiles,
  };
}
