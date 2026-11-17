/**
 * PowerPoint (.pptx) reader for PowerPoint to PDF: slides, layouts, masters
 * and their placeholders, themes (colours, fonts, fill and line styles),
 * text bodies with list styles, bullets and numbering, pictures (cropped,
 * clipped), preset and custom shapes, groups, tables with table styles,
 * backgrounds, SmartArt (from its stored drawing) and the slide size.
 * Everything is resolved into the flat model the layout worker draws
 * (`SlidesRequest` in src/engines/typeset/types.ts).
 *
 * Not drawn: charts (a labelled frame instead), shadows and other effects,
 * 3-D, animations, ink and vector EMF/WMF drawings.
 */
import { unzipSync } from 'fflate';
import type {
  PathCmd,
  Slide,
  SlideBox,
  SlideColor,
  SlideFill,
  SlideItem,
  SlideLine,
  SlidesRequest,
  SlideTableCell,
  SlideText,
} from '@/engines/typeset';
import { metafileKind, rasterFromMetafile } from './metafile';
import { customPath, LINE_PRESETS, presetPath } from './pptx-geometry';

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU = 12700;
const pt = (v: string | null | undefined, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v) / EMU);

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
function path(el: Element | null | undefined, ...names: string[]): Element | undefined {
  let cur = el ?? undefined;
  for (const n of names) cur = kid(cur, n);
  return cur;
}
function attr(el: Element | null | undefined, name: string): string | null {
  return el ? el.getAttribute(name) : null;
}
function rid(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(NS_R, name) || el.getAttribute(`r:${name}`);
}
function descendant(el: Element | null | undefined, name: string): Element | undefined {
  if (!el) return undefined;
  for (const e of el.getElementsByTagName('*')) if (e.localName === name) return e;
  return undefined;
}
function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}
const isTrue = (v: string | null) => v === '1' || v === 'true' || v === 'on';

// ── Package ────────────────────────────────────────────────────────────────

type Rel = { target: string; type: string; external: boolean };
type Part = { path: string; doc: Document; rels: Map<string, Rel> };

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  const out: string[] = [];
  for (const seg of `${dir}${target}`.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

class Package {
  #parts = new Map<string, Part | null>();
  constructor(readonly files: Record<string, Uint8Array>) {}

  xml(p: string): Document | null {
    const bytes = this.files[p];
    if (!bytes) return null;
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
    return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
  }

  part(p: string): Part | null {
    if (this.#parts.has(p)) return this.#parts.get(p) ?? null;
    const doc = this.xml(p);
    let part: Part | null = null;
    if (doc) {
      const rels = new Map<string, Rel>();
      const relDoc = this.xml(`${p.slice(0, p.lastIndexOf('/') + 1)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`);
      for (const r of relDoc?.getElementsByTagName('Relationship') ?? []) {
        const external = r.getAttribute('TargetMode') === 'External';
        const target = r.getAttribute('Target') ?? '';
        rels.set(r.getAttribute('Id') ?? '', { target: external ? target : resolve(p, target), type: r.getAttribute('Type') ?? '', external });
      }
      part = { path: p, doc, rels };
    }
    this.#parts.set(p, part);
    return part;
  }

  related(part: Part, typeSuffix: string): Part | null {
    for (const r of part.rels.values()) if (!r.external && r.type.endsWith(typeSuffix)) return this.part(r.target);
    return null;
  }
}

// ── Colours ────────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

type Theme = {
  colors: Record<string, Rgb>;
  major: string;
  minor: string;
  fills: Element[];
  lines: Element[];
  bgFills: Element[];
};

const PRESET_COLORS: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', gray: '808080', grey: '808080',
  darkGray: 'a9a9a9', lightGray: 'd3d3d3', orange: 'ffa500', purple: '800080', navy: '000080', teal: '008080', silver: 'c0c0c0',
  maroon: '800000', olive: '808000', lime: '00ff00', aqua: '00ffff', cyan: '00ffff', fuchsia: 'ff00ff', magenta: 'ff00ff',
  darkBlue: '00008b', darkRed: '8b0000', darkGreen: '006400', lightBlue: 'add8e6', gold: 'ffd700', brown: 'a52a2a', pink: 'ffc0cb',
};

function hex(v: string | null): Rgb | null {
  if (!v || !/^[0-9a-f]{6}$/i.test(v)) return null;
  const n = parseInt(v, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Colour context: theme, the master's colour map (bg1 → lt1 …) and the placeholder colour of a style reference. */
type Ctx = { theme: Theme; clrMap: Record<string, string>; ph?: SlideColor };

const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);

/** The colour inside a fill-like element (solidFill, buClr, fontRef …). */
function colorIn(container: Element | null | undefined, ctx: Ctx): SlideColor | null {
  if (!container) return null;
  for (const c of container.children) if (COLOR_TAGS.has(c.localName)) return colorOf(c, ctx);
  return null;
}

function colorOf(el: Element, ctx: Ctx): SlideColor | null {
  let rgb: Rgb | null = null;
  let alpha = 1;
  const val = attr(el, 'val');
  switch (el.localName) {
    case 'srgbClr':
      rgb = hex(val);
      break;
    case 'sysClr':
      rgb = hex(attr(el, 'lastClr')) ?? (val === 'window' ? [1, 1, 1] : [0, 0, 0]);
      break;
    case 'prstClr':
      rgb = hex(PRESET_COLORS[val ?? ''] ?? '000000');
      break;
    case 'scrgbClr':
      rgb = [Number(attr(el, 'r') ?? 0) / 100000, Number(attr(el, 'g') ?? 0) / 100000, Number(attr(el, 'b') ?? 0) / 100000].map((c) =>
        c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055,
      ) as Rgb;
      break;
    case 'hslClr':
      rgb = fromHsl([Number(attr(el, 'hue') ?? 0) / 21600000, Number(attr(el, 'sat') ?? 0) / 100000, Number(attr(el, 'lum') ?? 0) / 100000]);
      break;
    case 'schemeClr': {
      if (val === 'phClr') {
        if (ctx.ph) {
          rgb = [...ctx.ph.rgb];
          alpha = ctx.ph.alpha;
        }
        break;
      }
      const key = ctx.clrMap[val ?? ''] ?? val ?? '';
      rgb = ctx.theme.colors[key] ?? ctx.theme.colors[val ?? ''] ?? null;
      if (rgb) rgb = [...rgb];
      break;
    }
    default:
  }
  if (!rgb) return null;
  for (const t of el.children) {
    const v = Number(attr(t, 'val') ?? 0) / 100000;
    switch (t.localName) {
      case 'alpha':
        alpha = v;
        break;
      case 'alphaMod':
        alpha *= v;
        break;
      case 'lumMod': {
        const hsl = toHsl(rgb);
        rgb = fromHsl([hsl[0], hsl[1], clamp01(hsl[2] * v)]);
        break;
      }
      case 'lumOff': {
        const hsl = toHsl(rgb);
        rgb = fromHsl([hsl[0], hsl[1], clamp01(hsl[2] + v)]);
        break;
      }
      case 'satMod': {
        const hsl = toHsl(rgb);
        rgb = fromHsl([hsl[0], clamp01(hsl[1] * v), hsl[2]]);
        break;
      }
      case 'tint':
        rgb = rgb.map((c) => c + (1 - c) * (1 - v)) as Rgb;
        break;
      case 'shade':
        rgb = rgb.map((c) => c * v) as Rgb;
        break;
      case 'inv':
        rgb = rgb.map((c) => 1 - c) as Rgb;
        break;
      case 'gray': {
        const g: number = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
        rgb = [g, g, g];
        break;
      }
      default:
    }
  }
  return { rgb: rgb.map(clamp01) as Rgb, alpha: clamp01(alpha) };
}

function cssColor(c: SlideColor): string {
  return `#${c.rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

function readTheme(doc: Document | null): Theme {
  const theme: Theme = { colors: {}, major: 'Calibri Light', minor: 'Calibri', fills: [], lines: [], bgFills: [] };
  if (!doc) {
    Object.assign(theme.colors, { dk1: [0, 0, 0], lt1: [1, 1, 1], dk2: [0.27, 0.33, 0.42], lt2: [0.91, 0.9, 0.9], accent1: [0.27, 0.45, 0.77] });
    return theme;
  }
  const elements = descendant(doc.documentElement, 'themeElements');
  const scheme = kid(elements, 'clrScheme');
  const plain: Ctx = { theme, clrMap: {} };
  for (const c of kids(scheme)) {
    const col = colorIn(c, plain);
    if (col) theme.colors[c.localName] = col.rgb;
  }
  const fonts = kid(elements, 'fontScheme');
  theme.major = attr(path(fonts, 'majorFont', 'latin'), 'typeface') || theme.major;
  theme.minor = attr(path(fonts, 'minorFont', 'latin'), 'typeface') || theme.minor;
  const fmt = kid(elements, 'fmtScheme');
  theme.fills = kids(kid(fmt, 'fillStyleLst'));
  theme.lines = kids(kid(fmt, 'lnStyleLst'));
  theme.bgFills = kids(kid(fmt, 'bgFillStyleLst'));
  return theme;
}

function readClrMap(el: Element | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!el) return { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  for (const a of el.attributes) map[a.name] = a.value;
  return map;
}

// ── Text properties ────────────────────────────────────────────────────────

type RunProps = {
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  baseline?: number;
  caps?: boolean;
  color?: SlideColor;
  font?: string;
  highlight?: SlideColor;
  /** `<a:noFill/>`: invisible text. */
  hidden?: boolean;
};

type Bullet = { kind: 'none' } | { kind: 'char'; char: string } | { kind: 'num'; type: string; start: number };

type ParaProps = {
  marL?: number;
  indent?: number;
  algn?: string;
  rtl?: boolean;
  lnPct?: number;
  lnPts?: number;
  befPct?: number;
  befPts?: number;
  aftPct?: number;
  aftPts?: number;
  bullet?: Bullet;
  buColor?: SlideColor | 'text';
  buSizePct?: number;
  buSizePts?: number;
  buFont?: string | 'text';
  run: RunProps;
};

function assignDefined<T extends object>(target: T, src: Partial<T>): T {
  for (const [k, v] of Object.entries(src)) if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  return target;
}

function mergePara(a: ParaProps, b: ParaProps | undefined): ParaProps {
  if (!b) return a;
  const out: ParaProps = assignDefined({ ...a }, { ...b, run: undefined } as Partial<ParaProps>);
  out.run = assignDefined({ ...a.run }, b.run);
  return out;
}

function themeFont(face: string | null, theme: Theme): string | undefined {
  if (!face) return undefined;
  if (face.startsWith('+mj')) return theme.major;
  if (face.startsWith('+mn')) return theme.minor;
  return face;
}

function readRun(rPr: Element | undefined, ctx: Ctx): RunProps {
  const r: RunProps = {};
  if (!rPr) return r;
  const sz = attr(rPr, 'sz');
  if (sz) r.sz = Number(sz) / 100;
  const b = attr(rPr, 'b');
  if (b !== null) r.b = isTrue(b);
  const i = attr(rPr, 'i');
  if (i !== null) r.i = isTrue(i);
  const u = attr(rPr, 'u');
  if (u !== null) r.u = u !== 'none';
  const strike = attr(rPr, 'strike');
  if (strike !== null) r.strike = strike !== 'noStrike';
  const baseline = attr(rPr, 'baseline');
  if (baseline !== null) r.baseline = Number(baseline) / 1000;
  const cap = attr(rPr, 'cap');
  if (cap !== null) r.caps = cap === 'all' || cap === 'small';
  if (kid(rPr, 'noFill')) r.hidden = true;
  const fill = kid(rPr, 'solidFill') ?? kid(rPr, 'gradFill');
  if (fill) {
    const c = fill.localName === 'gradFill' ? colorIn(descendant(fill, 'gs'), ctx) : colorIn(fill, ctx);
    if (c) r.color = c;
  }
  const latin = themeFont(attr(kid(rPr, 'latin'), 'typeface'), ctx.theme);
  if (latin) r.font = latin;
  const hl = colorIn(kid(rPr, 'highlight'), ctx);
  if (hl) r.highlight = hl;
  return r;
}

function spacing(el: Element | undefined): { pct?: number; pts?: number } {
  const pct = attr(kid(el, 'spcPct'), 'val');
  if (pct !== null) return { pct: Number(pct) / 1000 };
  const pts = attr(kid(el, 'spcPts'), 'val');
  if (pts !== null) return { pts: Number(pts) / 100 };
  return {};
}

/** `<a:lvlNpPr>` or `<a:pPr>`. */
function readPara(el: Element | undefined, ctx: Ctx): ParaProps | undefined {
  if (!el) return undefined;
  const p: ParaProps = { run: readRun(kid(el, 'defRPr'), ctx) };
  const marL = attr(el, 'marL');
  if (marL !== null) p.marL = pt(marL);
  const indent = attr(el, 'indent');
  if (indent !== null) p.indent = pt(indent);
  const algn = attr(el, 'algn');
  if (algn) p.algn = algn;
  const rtl = attr(el, 'rtl');
  if (rtl !== null) p.rtl = isTrue(rtl);
  const ln = spacing(kid(el, 'lnSpc'));
  p.lnPct = ln.pct;
  p.lnPts = ln.pts;
  if (ln.pct !== undefined) p.lnPts = undefined;
  const bef = spacing(kid(el, 'spcBef'));
  if (bef.pct !== undefined || bef.pts !== undefined) Object.assign(p, { befPct: bef.pct, befPts: bef.pts });
  const aft = spacing(kid(el, 'spcAft'));
  if (aft.pct !== undefined || aft.pts !== undefined) Object.assign(p, { aftPct: aft.pct, aftPts: aft.pts });
  for (const c of el.children) {
    switch (c.localName) {
      case 'buNone':
        p.bullet = { kind: 'none' };
        break;
      case 'buChar':
        p.bullet = { kind: 'char', char: attr(c, 'char') ?? '•' };
        break;
      case 'buAutoNum':
        p.bullet = { kind: 'num', type: attr(c, 'type') ?? 'arabicPeriod', start: Number(attr(c, 'startAt') ?? 1) };
        break;
      case 'buBlip':
        p.bullet = { kind: 'char', char: '•' };
        break;
      case 'buClrTx':
        p.buColor = 'text';
        break;
      case 'buClr': {
        const col = colorIn(c, ctx);
        if (col) p.buColor = col;
        break;
      }
      case 'buSzTx':
        p.buSizePct = 100;
        break;
      case 'buSzPct':
        p.buSizePct = Number(attr(c, 'val') ?? 100000) / 1000;
        break;
      case 'buSzPts':
        p.buSizePts = Number(attr(c, 'val') ?? 1200) / 100;
        break;
      case 'buFontTx':
        p.buFont = 'text';
        break;
      case 'buFont':
        p.buFont = themeFont(attr(c, 'typeface'), ctx.theme) ?? 'text';
        break;
      default:
    }
  }
  return p;
}

/** Levels 1–9 of a list style (`lstStyle`, `titleStyle`, `defaultTextStyle` …). */
function readListStyle(el: Element | undefined, ctx: Ctx): (ParaProps | undefined)[] {
  const out: (ParaProps | undefined)[] = [];
  if (!el) return out;
  const def = readPara(kid(el, 'defPPr'), ctx);
  for (let i = 0; i < 9; i++) {
    const lvl = readPara(kid(el, `lvl${i + 1}pPr`), ctx);
    out[i] = def ? mergePara(def, lvl) : lvl;
  }
  return out;
}

/** Body properties that inherit from layout and master placeholders. */
type BodyProps = {
  inset: [number?, number?, number?, number?];
  anchor?: 't' | 'ctr' | 'b';
  wrap?: boolean;
  vert?: 0 | 90 | 270;
  autofit?: 'shrink' | 'resize' | 'none';
  fontScale?: number;
  lnReduction?: number;
  rtlCol?: boolean;
};

function readBody(el: Element | undefined): BodyProps {
  const b: BodyProps = { inset: [] };
  if (!el) return b;
  (['lIns', 'tIns', 'rIns', 'bIns'] as const).forEach((k, i) => {
    const v = attr(el, k);
    if (v !== null) b.inset[i] = pt(v);
  });
  const anchor = attr(el, 'anchor');
  if (anchor === 't' || anchor === 'ctr' || anchor === 'b') b.anchor = anchor;
  else if (anchor === 'just' || anchor === 'dist') b.anchor = 'ctr';
  const wrap = attr(el, 'wrap');
  if (wrap) b.wrap = wrap !== 'none';
  const vert = attr(el, 'vert');
  if (vert) b.vert = vert === 'vert' || vert === 'eaVert' || vert === 'wordArtVertRtl' ? 90 : vert === 'vert270' ? 270 : 0;
  if (kid(el, 'normAutofit')) {
    const n = kid(el, 'normAutofit');
    b.autofit = 'shrink';
    const fs = attr(n, 'fontScale');
    if (fs) b.fontScale = Number(fs) / 100000;
    const red = attr(n, 'lnSpcReduction');
    if (red) b.lnReduction = Number(red) / 1000;
  } else if (kid(el, 'spAutoFit')) b.autofit = 'resize';
  else if (kid(el, 'noAutofit')) b.autofit = 'none';
  return b;
}

function mergeBody(a: BodyProps, b: BodyProps): BodyProps {
  const out: BodyProps = assignDefined({ ...a }, { ...b, inset: undefined });
  out.inset = [0, 1, 2, 3].map((i) => b.inset[i] ?? a.inset[i]) as BodyProps['inset'];
  if (b.autofit) {
    out.fontScale = b.fontScale;
    out.lnReduction = b.lnReduction;
  }
  return out;
}

// ── Bullets and numbering ──────────────────────────────────────────────────

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}
function alpha(n: number): string {
  let s = '';
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function autoNumber(type: string, n: number): string {
  const kind = /^(arabic|alphaLc|alphaUc|romanLc|romanUc|circleNumDbPlain|circleNumWdBlackPlain|circleNumWdWhitePlain)/.exec(type)?.[1] ?? 'arabic';
  let label: string;
  switch (kind) {
    case 'alphaLc': label = alpha(n); break;
    case 'alphaUc': label = alpha(n).toUpperCase(); break;
    case 'romanLc': label = roman(n); break;
    case 'romanUc': label = roman(n).toUpperCase(); break;
    case 'circleNumDbPlain':
    case 'circleNumWdWhitePlain':
      return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n);
    case 'circleNumWdBlackPlain':
      return n >= 1 && n <= 10 ? String.fromCodePoint(0x2776 + n - 1) : String(n);
    default: label = String(n);
  }
  if (type.endsWith('ParenBoth')) return `(${label})`;
  if (type.endsWith('ParenR')) return `${label})`;
  if (type.endsWith('Period')) return `${label}.`;
  if (type.endsWith('Minus')) return `- ${label} -`;
  return label;
}

/** Bullets in symbol fonts (Wingdings, Symbol) are private code points: the Unicode look-alikes. */
const WINGDINGS: Record<number, string> = {
  0x6c: '●', 0x6e: '■', 0x6f: '□', 0x71: '❑', 0x72: '❒', 0x75: '◆', 0x76: '❖', 0x77: '⬥', 0xa7: '▪', 0xa8: '◻', 0xd8: '➢',
  0xe0: '➔', 0xe8: '➔', 0xf0: '⇨', 0xfc: '✔', 0xfb: '✘', 0xfe: '☑', 0x9f: '•', 0xa1: '○', 0x3e: '⌨', 0x46: '☞', 0x4a: '☺',
};

function bulletText(char: string, font: string | undefined): string {
  const cp = char.codePointAt(0) ?? 0x2022;
  const f = (font ?? '').toLowerCase();
  const low = cp >= 0xf000 && cp <= 0xf0ff ? cp - 0xf000 : cp;
  if (f.includes('wingdings') || (cp >= 0xf000 && cp <= 0xf0ff)) return WINGDINGS[low] ?? '•';
  if (f === 'symbol') return low === 0xb7 ? '•' : low === 0xae ? '→' : low === 0xde ? '⇒' : '•';
  if (char === 'o' && f.includes('courier')) return '◦';
  if (cp === 0xb7) return '•';
  return char;
}

// ── Fonts ──────────────────────────────────────────────────────────────────

/** A CSS family for a document font name (unknown names are classified, so nothing falls back to serif by accident). */
function family(name: string | undefined): string {
  if (!name) return 'sans-serif';
  const clean = name.replace(/['";<>{}]/g, '').trim();
  return `'${clean}'`;
}

// ── The reader ─────────────────────────────────────────────────────────────

type Placeholder = { type: string; idx: string | null };

type Layer = { part: Part; shapes: Element[]; ctx: Ctx };

type Transform = (b: SlideBox) => SlideBox;
const IDENTITY: Transform = (b) => b;

type Report = {
  slides: number;
  hidden: number;
  charts: number;
  smartArt: number;
  metafilesConverted: number;
  metafilesMissing: number;
  unknownShapes: number;
  media: number;
  ole: number;
  images: number;
};

export type PptxResult = { request: Omit<SlidesRequest, 'outline'>; report: Report };

/** Office Math structures that do not read as plain text (fractions, scripts, radicals …). */
const MATH_STRUCTURES = new Set(['f', 'sSup', 'sSub', 'sSubSup', 'sPre', 'rad', 'nary', 'd', 'm', 'eqArr', 'func', 'acc', 'bar', 'limLow', 'limUpp', 'groupChr', 'borderBox', 'box', 'phant']);

const MEDIA_IMAGE = /\.(png|jpe?g|gif|bmp|tiff?|jfif|jpe)$/i;

function sniff(b: Uint8Array): 'raster' | 'svg' | 'metafile' | 'unknown' {
  if (b.length < 8) return 'unknown';
  if (b[0] === 0x89 && b[1] === 0x50) return 'raster';
  if (b[0] === 0xff && b[1] === 0xd8) return 'raster';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'raster';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'raster';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'raster';
  if (metafileKind(b)) return 'metafile';
  const head = new TextDecoder().decode(b.subarray(0, 256)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return 'unknown';
}

class Reader {
  images: Uint8Array[] = [];
  #imageIndex = new Map<string, number | null>();
  presDefault: (ParaProps | undefined)[] = [];
  tableStyles = new Map<string, Element>();
  report: Report = { slides: 0, hidden: 0, charts: 0, smartArt: 0, metafilesConverted: 0, metafilesMissing: 0, unknownShapes: 0, media: 0, ole: 0, images: 0 };
  slideNumber = 0;

  constructor(readonly pkg: Package) {}

  // Images ------------------------------------------------------------------
  image(part: Part, id: string | null): number | null {
    if (!id) return null;
    const rel = part.rels.get(id);
    if (!rel || rel.external) return null;
    if (this.#imageIndex.has(rel.target)) return this.#imageIndex.get(rel.target) ?? null;
    let bytes = this.pkg.files[rel.target];
    let index: number | null = null;
    if (bytes) {
      const kind = sniff(bytes);
      if (kind === 'metafile') {
        const raster = rasterFromMetafile(bytes);
        if (raster) this.report.metafilesConverted += 1;
        else this.report.metafilesMissing += 1;
        bytes = raster ?? undefined;
      } else if (kind === 'unknown' && !MEDIA_IMAGE.test(rel.target)) bytes = undefined;
      if (bytes) {
        index = this.images.length;
        this.images.push(bytes);
      }
    }
    this.#imageIndex.set(rel.target, index);
    return index;
  }

  // Fills and lines ---------------------------------------------------------
  /** undefined: not set here; null: explicitly none. */
  fill(container: Element | undefined, ctx: Ctx, part: Part): SlideFill | null | undefined {
    if (!container) return undefined;
    for (const c of container.children) {
      switch (c.localName) {
        case 'noFill':
          return null;
        case 'solidFill': {
          const color = colorIn(c, ctx);
          return color ? { kind: 'solid', color } : null;
        }
        case 'gradFill': {
          const stops = kids(kid(c, 'gsLst'), 'gs')
            .map((g) => ({ pos: Number(attr(g, 'pos') ?? 0) / 100000, color: colorIn(g, ctx) }))
            .filter((s): s is { pos: number; color: SlideColor } => !!s.color)
            .sort((a, b) => a.pos - b.pos);
          if (stops.length === 0) return null;
          const lin = kid(c, 'lin');
          return { kind: 'gradient', stops, angle: lin ? Number(attr(lin, 'ang') ?? 0) / 60000 : 90, radial: !lin && !!kid(c, 'path') };
        }
        case 'blipFill': {
          const blip = kid(c, 'blip');
          const image = this.image(part, rid(blip, 'embed'));
          if (image === null) return undefined;
          const a = attr(kid(blip, 'alphaModFix'), 'amt');
          const fr = path(c, 'stretch', 'fillRect');
          const rect = fr ? (['l', 't', 'r', 'b'].map((k) => Number(attr(fr, k) ?? 0) / 100000) as [number, number, number, number]) : undefined;
          return { kind: 'image', image, alpha: a ? Number(a) / 100000 : 1, rect: rect?.some((v) => v !== 0) ? rect : undefined };
        }
        case 'pattFill': {
          const fg = colorIn(kid(c, 'fgClr'), ctx);
          const bg = colorIn(kid(c, 'bgClr'), ctx);
          const col = fg && bg ? { rgb: fg.rgb.map((v, i) => (v + (bg.rgb[i] as number)) / 2) as Rgb, alpha: fg.alpha } : (fg ?? bg);
          return col ? { kind: 'solid', color: col } : null;
        }
        case 'grpFill':
          return undefined;
        default:
      }
    }
    return undefined;
  }

  line(ln: Element | undefined, ctx: Ctx): SlideLine | null | undefined {
    if (!ln) return undefined;
    const w = attr(ln, 'w');
    let color: SlideColor | null | undefined;
    for (const c of ln.children) {
      if (c.localName === 'noFill') color = null;
      else if (c.localName === 'solidFill') color = colorIn(c, ctx);
      else if (c.localName === 'gradFill') color = colorIn(descendant(c, 'gs'), ctx);
    }
    if (color === null) return null;
    if (color === undefined && w === null) return undefined;
    const width = w !== null ? Math.max(0.25, pt(w)) : 0.75;
    const out: SlideLine = { color: color ?? { rgb: [0, 0, 0], alpha: 1 }, width };
    const dash = attr(kid(ln, 'prstDash'), 'val');
    if (dash && dash !== 'solid') {
      const unit = Math.max(1, width);
      out.dash = dash.includes('sysDot') || dash === 'dot' ? [unit, unit * 2] : dash.toLowerCase().includes('dashdot') ? [unit * 4, unit * 2, unit, unit * 2] : [unit * 4, unit * 3];
    }
    const end = (el: Element | undefined) => {
      const t = attr(el, 'type');
      return !t || t === 'none' ? undefined : t === 'oval' || t === 'diamond' ? 'oval' : 'arrow';
    };
    out.head = end(kid(ln, 'headEnd'));
    out.tail = end(kid(ln, 'tailEnd'));
    return out;
  }

  /** A style reference (`fillRef`, `lnRef`) into the theme's style lists. */
  styleFill(ref: Element | undefined, ctx: Ctx, part: Part): SlideFill | null | undefined {
    if (!ref) return undefined;
    const idx = Number(attr(ref, 'idx') ?? 0);
    if (idx === 0) return null;
    const ph = colorIn(ref, ctx) ?? undefined;
    const list = idx >= 1000 ? ctx.theme.bgFills : ctx.theme.fills;
    const el = list[(idx >= 1000 ? idx - 1000 : idx) - 1];
    const wrapper = el ? el.ownerDocument.createElement('w') : null;
    if (!el || !wrapper) return ph ? { kind: 'solid', color: ph } : undefined;
    wrapper.appendChild(el.cloneNode(true));
    return this.fill(wrapper, { ...ctx, ph }, part);
  }

  styleLine(ref: Element | undefined, ctx: Ctx): SlideLine | null | undefined {
    if (!ref) return undefined;
    const idx = Number(attr(ref, 'idx') ?? 0);
    if (idx === 0) return null;
    const ph = colorIn(ref, ctx) ?? undefined;
    const el = ctx.theme.lines[idx - 1];
    if (!el) return ph ? { color: ph, width: 0.75 } : undefined;
    return this.line(el, { ...ctx, ph });
  }

  // Text --------------------------------------------------------------------
  /** Text body → HTML for the layout worker; null when there is no visible text. */
  text(
    txBody: Element | undefined,
    levels: (ParaProps | undefined)[][],
    base: RunProps,
    body: BodyProps,
    ctx: Ctx,
    part: Part,
  ): SlideText | null {
    if (!txBody) return null;
    const paras = kids(txBody, 'p');
    if (!paras.some((p) => kids(p).some((r) => (r.localName === 'r' || r.localName === 'fld') && (kid(r, 't')?.textContent ?? '') !== ''))) return null;
    const own = readListStyle(kid(txBody, 'lstStyle'), ctx);
    const chain = [...levels, own];
    const counters: number[] = [];
    let html = '';
    paras.forEach((p, index) => {
      const pPr = kid(p, 'pPr');
      const lvl = Math.min(8, Math.max(0, Number(attr(pPr, 'lvl') ?? 0)));
      let props: ParaProps = { run: { ...base } };
      // The shape's own default text colour and font (style fontRef) sit under the list styles of the shape.
      for (const list of chain) props = mergePara(props, list[lvl]);
      props = mergePara(props, readPara(pPr, ctx));
      html += this.paragraph(p, props, lvl, index === 0, counters, body, ctx, part);
    });
    const inset = body.inset;
    return {
      html,
      inset: [inset[0] ?? 7.2, inset[1] ?? 3.6, inset[2] ?? 7.2, inset[3] ?? 3.6],
      anchor: body.anchor ?? 't',
      wrap: body.wrap !== false,
      vert: body.vert ?? 0,
      shrink: body.autofit === 'shrink' ? (body.fontScale ?? 1) : false,
    };
  }

  paragraph(p: Element, props: ParaProps, lvl: number, first: boolean, counters: number[], body: BodyProps, ctx: Ctx, part: Part): string {
    const runs: string[] = [];
    let firstSize: number | undefined;
    let firstRun: RunProps | undefined;
    for (const r of p.children) {
      if (r.localName === 'r' || r.localName === 'fld') {
        const rp = assignDefined({ ...props.run }, readRun(kid(r, 'rPr'), ctx));
        let t = kid(r, 't')?.textContent ?? '';
        if (r.localName === 'fld' && attr(r, 'type') === 'slidenum') t = String(this.slideNumber);
        if (!t || rp.hidden) continue;
        const link = kid(kid(r, 'rPr'), 'hlinkClick');
        if (link && rid(link, 'id') && part.rels.get(rid(link, 'id') ?? '')?.external) {
          const c = ctx.theme.colors[ctx.clrMap.hlink ?? 'hlink'] ?? ctx.theme.colors.hlink;
          if (c && !kid(kid(r, 'rPr'), 'solidFill')) rp.color = { rgb: c, alpha: 1 };
          rp.u = true;
        }
        firstSize ??= rp.sz;
        firstRun ??= rp;
        runs.push(this.runHtml(t, rp));
      } else if (r.localName === 'm') {
        // Inline equation (a14:m): its text runs, in the run style they carry.
        for (const mr of [...r.getElementsByTagName('*')].filter((e) => e.localName === 'r')) {
          const t = [...mr.children].filter((c) => c.localName === 't').map((c) => c.textContent ?? '').join('');
          if (!t) continue;
          const rp = assignDefined({ ...props.run }, readRun(kid(mr, 'rPr'), ctx));
          firstSize ??= rp.sz;
          firstRun ??= rp;
          runs.push(this.runHtml(t, rp));
        }
      } else if (r.localName === 'br') {
        runs.push('<br>');
      }
    }
    const endRun = assignDefined({ ...props.run }, readRun(kid(p, 'endParaRPr'), ctx));
    const size = firstSize ?? endRun.sz ?? props.run.sz ?? 18;
    const css: string[] = [];
    const lineFactor = props.lnPct !== undefined ? Math.max(0.5, props.lnPct - (body.lnReduction ?? 0)) / 100 : 1;
    const lineHeight = props.lnPts !== undefined ? `${props.lnPts}pt` : (1.2 * lineFactor).toFixed(3);
    const linePts = props.lnPts ?? size * 1.2 * lineFactor;
    css.push(`font-size:${size}pt`, `line-height:${lineHeight}`);
    const marL = props.marL ?? 0;
    let indent = props.indent ?? 0;
    if (marL) css.push(`margin-left:${marL.toFixed(2)}pt`);
    const algn = props.algn ?? 'l';
    const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' || algn === 'justLow' ? 'justify' : 'left';
    if (align !== 'left') css.push(`text-align:${align}`);
    const before = first ? 0 : (props.befPts ?? ((props.befPct ?? 0) / 100) * size * 1.2);
    const after = props.aftPts ?? ((props.aftPct ?? 0) / 100) * size * 1.2;
    if (before > 0) css.push(`padding-top:${before.toFixed(2)}pt`);
    if (after > 0) css.push(`padding-bottom:${after.toFixed(2)}pt`);
    const dir = props.rtl ? ' dir="rtl"' : '';

    // Bullet or number.
    let bulletHtml = '';
    const bullet = runs.length > 0 ? props.bullet : undefined;
    if (bullet?.kind === 'num') {
      for (let d = lvl + 1; d < counters.length; d++) counters[d] = 0;
      counters[lvl] = (counters[lvl] ?? 0) > 0 ? (counters[lvl] as number) + 1 : bullet.start;
    } else {
      counters.length = Math.min(counters.length, lvl);
    }
    let label = '';
    if (bullet?.kind === 'char') label = bulletText(bullet.char, props.buFont === 'text' ? undefined : props.buFont);
    else if (bullet?.kind === 'num') label = autoNumber(bullet.type, counters[lvl] as number);
    if (label) {
      const r = firstRun ?? props.run;
      const bsize = props.buSizePts ?? (size * (props.buSizePct ?? 100)) / 100;
      const color = props.buColor && props.buColor !== 'text' ? props.buColor : r.color;
      const font = bullet?.kind === 'char' && props.buFont && props.buFont !== 'text' && !/wingdings|symbol|webdings/i.test(props.buFont) ? props.buFont : r.font;
      const bcss = [`font-size:${bsize.toFixed(2)}pt`, `font-family:${family(font)}`, color ? `color:${cssColor(color)}` : '', `line-height:${linePts.toFixed(2)}pt`];
      if (bullet?.kind === 'num') {
        if (r.b) bcss.push('font-weight:bold');
        if (r.i) bcss.push('font-style:italic');
      }
      const lift = Math.max(0, (size - bsize) * 0.3);
      if (indent < -1 && !props.rtl) {
        bulletHtml = `<div style="position:absolute;left:${indent.toFixed(2)}pt;top:0;width:${(-indent).toFixed(2)}pt;text-indent:0;text-align:left;padding-top:${lift.toFixed(2)}pt;${bcss.join(';')}">${esc(label)}</div>`;
        indent = 0;
        css.push('position:relative');
      } else {
        runs.unshift(`<span style="${bcss.filter((c) => !c.startsWith('line-height')).join(';')}">${esc(label)}</span>&#160;`);
      }
    }
    if (indent) css.push(`text-indent:${indent.toFixed(2)}pt`);
    if (runs.length === 0) {
      return `<div${dir} style="${css.join(';')}">&#160;</div>`;
    }
    return `<div${dir} style="${css.join(';')}">${runs.join('')}${bulletHtml}</div>`;
  }

  runHtml(t: string, r: RunProps): string {
    const css: string[] = [`font-family:${family(r.font)}`];
    let size = r.sz ?? 18;
    if (r.baseline && r.baseline !== 0) {
      size *= 0.7;
      css.push(`vertical-align:${r.baseline > 0 ? 'super' : 'sub'}`);
    }
    css.push(`font-size:${size.toFixed(2)}pt`);
    if (r.b) css.push('font-weight:bold');
    if (r.i) css.push('font-style:italic');
    const deco = [r.u ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean);
    if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
    css.push(`color:${cssColor(r.color ?? { rgb: [0, 0, 0], alpha: 1 })}`);
    if (r.highlight) css.push(`background-color:${cssColor(r.highlight)}`);
    if (r.caps) css.push('text-transform:uppercase');
    // Vertical tab is PowerPoint's soft line break inside a run.
    const body = esc(t).replace(/\u000b/g, '<br>');
    return `<span style="${css.join(';')}">${body}</span>`;
  }

  // Shapes ------------------------------------------------------------------
  box(xfrm: Element | undefined): SlideBox | null {
    const off = kid(xfrm, 'off');
    const ext = kid(xfrm, 'ext');
    if (!off || !ext) return null;
    return {
      x: pt(attr(off, 'x')),
      y: pt(attr(off, 'y')),
      w: pt(attr(ext, 'cx')),
      h: pt(attr(ext, 'cy')),
      rot: Number(attr(xfrm, 'rot') ?? 0) / 60000,
      flipH: isTrue(attr(xfrm, 'flipH')),
      flipV: isTrue(attr(xfrm, 'flipV')),
    };
  }

  geometry(spPr: Element | undefined, w: number, h: number): { path: PathCmd[]; open: boolean } {
    const prst = kid(spPr, 'prstGeom');
    if (prst) {
      const name = attr(prst, 'prst') ?? 'rect';
      const adj = new Map<string, number>();
      for (const gd of kids(kid(prst, 'avLst'), 'gd')) {
        const m = /^val\s+(-?\d+)/.exec(attr(gd, 'fmla') ?? '');
        if (m) adj.set(attr(gd, 'name') ?? '', Number(m[1]));
      }
      const p = presetPath(name, w, h, adj);
      if (p) return { path: p, open: LINE_PRESETS.has(name) };
      this.report.unknownShapes += 1;
    }
    const cust = kid(spPr, 'custGeom');
    if (cust) {
      const p = customPath(cust, w, h);
      if (p.length) return { path: p, open: !p.some((c) => c[0] === 'Z') };
    }
    return { path: presetPath('rect', w, h, new Map()) as PathCmd[], open: false };
  }

  placeholderOf(el: Element): Placeholder | null {
    const nv = kids(el).find((c) => c.localName.startsWith('nv'));
    const ph = path(nv, 'nvPr', 'ph');
    if (!ph) return null;
    return { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') };
  }

  /** The matching placeholder on a layout or master. */
  findPlaceholder(layer: Layer | null, ph: Placeholder, byTypeOnly: boolean): Element | undefined {
    if (!layer) return undefined;
    const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' || t === 'body' ? 'body' : t);
    let typeMatch: Element | undefined;
    for (const s of layer.shapes) {
      const other = this.placeholderOf(s);
      if (!other) continue;
      if (!byTypeOnly && ph.idx !== null && other.idx === ph.idx) return s;
      if (!typeMatch && (other.type === ph.type || norm(other.type) === norm(ph.type))) typeMatch = s;
    }
    return typeMatch;
  }

  /** Master text style for a placeholder type. */
  txStyleFor(master: Layer, ph: Placeholder | null): (ParaProps | undefined)[] {
    const styles = path(master.part.doc.documentElement, 'txStyles');
    if (!ph) return [];
    const name = ph.type === 'title' || ph.type === 'ctrTitle' ? 'titleStyle' : ['body', 'subTitle', 'obj', 'tbl', 'chart', 'pic', 'media', 'clipArt', 'dgm'].includes(ph.type) ? 'bodyStyle' : 'otherStyle';
    return readListStyle(kid(styles, name), master.ctx);
  }

  /**
   * Draws a shape tree into `out`. `layers` = [master, layout] for slides
   * (placeholders look up their inherited properties there).
   */
  tree(
    container: Element,
    part: Part,
    ctx: Ctx,
    out: SlideItem[],
    t: Transform,
    env: { master: Layer; layout: Layer | null; isSlide: boolean },
  ): void {
    for (const el of container.children) {
      switch (el.localName) {
        case 'sp':
          this.shape(el, part, ctx, out, t, env);
          break;
        case 'pic':
          this.picture(el, part, ctx, out, t, env);
          break;
        case 'grpSp':
          this.group(el, part, ctx, out, t, env);
          break;
        case 'graphicFrame':
          this.frame(el, part, ctx, out, t, env);
          break;
        case 'cxnSp':
          this.shape(el, part, ctx, out, t, env);
          break;
        case 'AlternateContent': {
          const fallback = kid(el, 'Fallback');
          const choice = kid(el, 'Choice');
          // Pictures and rendered equations live in the fallback; simple inline math is kept as text from the choice.
          const math = choice ? [...choice.getElementsByTagName('*')].filter((e) => e.localName === 'oMath') : [];
          const complexMath = math.some((m) => [...m.getElementsByTagName('*')].some((e) => MATH_STRUCTURES.has(e.localName)));
          const usable = fallback && (descendant(fallback, 'pic') || complexMath || descendant(fallback, 'blipFill')) && (math.length === 0 || complexMath) ? fallback : (choice ?? fallback);
          if (usable) this.tree(usable, part, ctx, out, t, env);
          break;
        }
        default:
      }
    }
  }

  isHidden(el: Element): boolean {
    const nv = kids(el).find((c) => c.localName.startsWith('nv'));
    return isTrue(attr(kid(nv, 'cNvPr'), 'hidden'));
  }

  /** xfrm, fill, line and body properties along the placeholder chain. */
  inherited(el: Element, env: { master: Layer; layout: Layer | null; isSlide: boolean }): { ph: Placeholder | null; chain: Element[] } {
    const ph = this.placeholderOf(el);
    if (!ph || !env.isSlide) return { ph, chain: [] };
    const chain: Element[] = [];
    const onLayout = this.findPlaceholder(env.layout, ph, false);
    if (onLayout) chain.push(onLayout);
    const layoutPh = onLayout ? (this.placeholderOf(onLayout) ?? ph) : ph;
    const onMaster = this.findPlaceholder(env.master, layoutPh, true);
    if (onMaster) chain.push(onMaster);
    return { ph, chain };
  }

  shape(el: Element, part: Part, ctx: Ctx, out: SlideItem[], t: Transform, env: { master: Layer; layout: Layer | null; isSlide: boolean }): void {
    if (this.isHidden(el)) return;
    const { ph, chain } = this.inherited(el, env);
    // Placeholders on layouts and masters are prompts, not content.
    if (ph && !env.isSlide) return;
    const spPr = kid(el, 'spPr');
    let xfrm = kid(spPr, 'xfrm');
    for (const c of chain) xfrm ??= path(c, 'spPr', 'xfrm');
    const raw = this.box(xfrm);
    if (!raw) return;
    const box = t(raw);
    const style = kid(el, 'style');
    // Fill and line: the shape's own, then the inherited placeholder's, then the style reference.
    let fill = this.fill(spPr, ctx, part);
    for (const c of chain) if (fill === undefined) fill = this.fill(path(c, 'spPr'), ctx, part);
    if (fill === undefined) fill = this.styleFill(kid(style, 'fillRef'), ctx, part);
    let line = this.line(kid(spPr, 'ln'), ctx);
    const styleLine = this.styleLine(kid(style, 'lnRef'), ctx);
    if (line === undefined) for (const c of chain) if (line === undefined) line = this.line(path(c, 'spPr', 'ln'), ctx);
    if (line === undefined) line = styleLine;
    else if (line && styleLine && !kid(kid(spPr, 'ln'), 'solidFill') && !kid(kid(spPr, 'ln'), 'gradFill')) line = { ...line, color: styleLine.color };
    const geom = this.geometry(spPr ?? chain.map((c) => kid(c, 'spPr')).find(Boolean), raw.w, raw.h);
    if (geom.open) fill = null;

    // Text: list styles from the presentation, the master (by placeholder type), master and layout placeholders, the shape.
    const levels: (ParaProps | undefined)[][] = [this.presDefault];
    if (ph && env.isSlide) levels.push(this.txStyleFor(env.master, ph));
    for (const c of [...chain].reverse()) levels.push(readListStyle(path(c, 'txBody', 'lstStyle'), ctx));
    const fontRef = kid(style, 'fontRef');
    const base: RunProps = {};
    if (fontRef) {
      const c = colorIn(fontRef, ctx);
      if (c) base.color = c;
      const idx = attr(fontRef, 'idx');
      if (idx === 'major') base.font = ctx.theme.major;
      else if (idx === 'minor') base.font = ctx.theme.minor;
      // The style's colour beats the list styles' default colour: put it in as a level on top of them.
      if (base.color || base.font) levels.push(Array.from({ length: 9 }, () => ({ run: { ...base } })));
    }
    let body: BodyProps = { inset: [] };
    for (const c of [...chain].reverse()) body = mergeBody(body, readBody(path(c, 'txBody', 'bodyPr')));
    const txBody = kid(el, 'txBody');
    body = mergeBody(body, readBody(kid(txBody, 'bodyPr')));
    const text = this.text(txBody, levels, {}, body, ctx, part);

    const txXfrm = kid(el, 'txXfrm');
    if (txXfrm && text) {
      // SmartArt shapes: the text has its own box.
      out.push({ kind: 'shape', box, path: geom.path, fill: fill ?? undefined, line: line ?? undefined });
      const tb = this.box(txXfrm);
      if (tb) out.push({ kind: 'shape', box: t(tb), text });
      return;
    }
    if (!fill && !line && !text) return;
    out.push({ kind: 'shape', box, path: geom.path, fill: fill ?? undefined, line: line ?? undefined, text: text ?? undefined });
  }

  picture(el: Element, part: Part, ctx: Ctx, out: SlideItem[], t: Transform, env: { master: Layer; layout: Layer | null; isSlide: boolean }): void {
    if (this.isHidden(el)) return;
    const { ph, chain } = this.inherited(el, env);
    if (ph && !env.isSlide) return;
    const spPr = kid(el, 'spPr');
    let xfrm = kid(spPr, 'xfrm');
    for (const c of chain) xfrm ??= path(c, 'spPr', 'xfrm');
    const raw = this.box(xfrm);
    if (!raw) return;
    const box = t(raw);
    const blipFill = kid(el, 'blipFill');
    const blip = kid(blipFill, 'blip');
    if (descendant(kids(el).find((c) => c.localName.startsWith('nv')), 'videoFile') || descendant(kids(el).find((c) => c.localName.startsWith('nv')), 'audioFile')) this.report.media += 1;
    const image = this.image(part, rid(blip, 'embed'));
    const line = this.line(kid(spPr, 'ln'), ctx) ?? this.styleLine(path(el, 'style', 'lnRef'), ctx) ?? undefined;
    if (image === null) {
      if (rid(blip, 'embed')) out.push({ kind: 'missing', box, label: 'Picture in a format that cannot be drawn here' });
      return;
    }
    this.report.images += 1;
    const src = kid(blipFill, 'srcRect');
    const crop: [number, number, number, number] | undefined = src
      ? (['l', 't', 'r', 'b'].map((k) => Number(attr(src, k) ?? 0) / 100000) as [number, number, number, number])
      : undefined;
    const prst = attr(kid(spPr, 'prstGeom'), 'prst');
    const clip = prst && prst !== 'rect' ? this.geometry(spPr, raw.w, raw.h).path : kid(spPr, 'custGeom') ? this.geometry(spPr, raw.w, raw.h).path : undefined;
    const a = attr(kid(blip, 'alphaModFix'), 'amt');
    out.push({
      kind: 'image',
      box,
      image,
      crop: crop && crop.some((v) => Math.abs(v) > 1e-4) ? crop : undefined,
      alpha: a ? Number(a) / 100000 : undefined,
      clip,
      line: line ?? undefined,
    });
  }

  group(el: Element, part: Part, ctx: Ctx, out: SlideItem[], t: Transform, env: { master: Layer; layout: Layer | null; isSlide: boolean }): void {
    if (this.isHidden(el)) return;
    const xfrm = path(el, 'grpSpPr', 'xfrm');
    const own = this.box(xfrm);
    const chOff = kid(xfrm, 'chOff');
    const chExt = kid(xfrm, 'chExt');
    let inner: Transform = IDENTITY;
    if (own && chOff && chExt) {
      const cx = pt(attr(chOff, 'x'));
      const cy = pt(attr(chOff, 'y'));
      const cw = pt(attr(chExt, 'cx'));
      const ch = pt(attr(chExt, 'cy'));
      const sx = cw > 0 ? own.w / cw : 1;
      const sy = ch > 0 ? own.h / ch : 1;
      const gcx = own.x + own.w / 2;
      const gcy = own.y + own.h / 2;
      const rad = (own.rot * Math.PI) / 180;
      inner = (b) => {
        const w = b.w * sx;
        const h = b.h * sy;
        let ccx = own.x + (b.x - cx) * sx + w / 2;
        let ccy = own.y + (b.y - cy) * sy + h / 2;
        let rot = b.rot;
        let flipH = b.flipH;
        let flipV = b.flipV;
        if (own.flipH) {
          ccx = 2 * gcx - ccx;
          flipH = !flipH;
          rot = -rot;
        }
        if (own.flipV) {
          ccy = 2 * gcy - ccy;
          flipV = !flipV;
          rot = -rot;
        }
        if (own.rot) {
          const dx = ccx - gcx;
          const dy = ccy - gcy;
          ccx = gcx + dx * Math.cos(rad) - dy * Math.sin(rad);
          ccy = gcy + dx * Math.sin(rad) + dy * Math.cos(rad);
          rot += own.rot;
        }
        return { x: ccx - w / 2, y: ccy - h / 2, w, h, rot, flipH, flipV };
      };
    }
    // The group's own fill is what `grpFill` children use: not modelled (rare); children are drawn as they are.
    this.tree(el, part, ctx, out, (b) => t(inner(b)), env);
  }

  frame(el: Element, part: Part, ctx: Ctx, out: SlideItem[], t: Transform, env: { master: Layer; layout: Layer | null; isSlide: boolean }): void {
    if (this.isHidden(el)) return;
    const { chain } = this.inherited(el, env);
    let xfrm = kid(el, 'xfrm');
    for (const c of chain) xfrm ??= kid(c, 'xfrm');
    const raw = this.box(xfrm);
    if (!raw) return;
    const box = t(raw);
    const data = path(el, 'graphic', 'graphicData');
    const uri = attr(data, 'uri') ?? '';
    if (uri.endsWith('/table')) {
      const tbl = kid(data, 'tbl');
      if (tbl) this.table(tbl, box, part, ctx, out);
      return;
    }
    if (uri.endsWith('/chart') || uri.includes('chartex')) {
      this.report.charts += 1;
      const chartPart = this.pkg.part(part.rels.get(rid(kid(data, 'chart'), 'id') ?? '')?.target ?? '');
      const title = chartPart ? [...chartPart.doc.getElementsByTagName('*')].filter((e) => e.localName === 'title').map((e) => [...e.getElementsByTagName('*')].filter((x) => x.localName === 't').map((x) => x.textContent).join(''))[0] : '';
      out.push({ kind: 'missing', box, label: `Chart${title ? `: ${title}` : ''} (charts are not drawn)` });
      return;
    }
    if (uri.endsWith('/diagram')) {
      const drawn = this.smartArt(data, part, ctx, out, box, env);
      if (drawn) this.report.smartArt += 1;
      else out.push({ kind: 'missing', box, label: 'SmartArt (no stored drawing in the file)' });
      return;
    }
    if (uri.endsWith('/ole')) {
      // OLE objects carry a picture of themselves.
      const pic = descendant(data, 'pic');
      this.report.ole += 1;
      if (pic) {
        const holder = el.ownerDocument.createElement('holder');
        const clone = pic.cloneNode(true) as Element;
        holder.appendChild(clone);
        // The preview takes the frame's box when it has none of its own.
        this.tree(holder, part, ctx, out, (b) => (b.w > 0 ? t(b) : box), env);
        return;
      }
      out.push({ kind: 'missing', box, label: 'Embedded object' });
    }
  }

  smartArt(data: Element | undefined, part: Part, ctx: Ctx, out: SlideItem[], box: SlideBox, env: { master: Layer; layout: Layer | null; isSlide: boolean }): boolean {
    const relIds = kid(data, 'relIds');
    const dm = this.pkg.part(part.rels.get(rid(relIds, 'dm') ?? '')?.target ?? '');
    const extId = dm ? attr(descendant(dm.doc.documentElement, 'dataModelExt'), 'relId') : null;
    let target = extId ? part.rels.get(extId)?.target : undefined;
    if (!target) target = [...part.rels.values()].find((r) => r.type.endsWith('/diagramDrawing'))?.target;
    const drawing = target ? this.pkg.part(target) : null;
    const tree = drawing ? descendant(drawing.doc.documentElement, 'spTree') : undefined;
    if (!drawing || !tree) return false;
    this.tree(tree, drawing, ctx, out, (b) => ({ ...b, x: b.x + box.x, y: b.y + box.y }), { ...env, isSlide: false });
    return true;
  }

  // Tables ------------------------------------------------------------------
  table(tbl: Element, box: SlideBox, part: Part, ctx: Ctx, out: SlideItem[]): void {
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => pt(attr(g, 'w')));
    const trs = kids(tbl, 'tr');
    const rows = trs.map((tr) => pt(attr(tr, 'h')));
    const tblPr = kid(tbl, 'tblPr');
    const flags = {
      firstRow: isTrue(attr(tblPr, 'firstRow')),
      lastRow: isTrue(attr(tblPr, 'lastRow')),
      firstCol: isTrue(attr(tblPr, 'firstCol')),
      lastCol: isTrue(attr(tblPr, 'lastCol')),
      bandRow: isTrue(attr(tblPr, 'bandRow')),
      bandCol: isTrue(attr(tblPr, 'bandCol')),
    };
    const styleId = kid(tblPr, 'tableStyleId')?.textContent?.trim() ?? '';
    const style = this.tableStyles.get(styleId) ?? (styleId ? builtinTableStyle(styleId) : null);
    const tableFill = this.fill(tblPr, ctx, part);
    const nR = trs.length;
    const nC = cols.length;
    const cells: SlideTableCell[] = [];
    trs.forEach((tr, r) => {
      let c = 0;
      for (const tc of kids(tr, 'tc')) {
        const col = c;
        c += 1;
        if (isTrue(attr(tc, 'hMerge')) || isTrue(attr(tc, 'vMerge'))) continue;
        const colSpan = Math.max(1, Number(attr(tc, 'gridSpan') ?? 1));
        const rowSpan = Math.max(1, Number(attr(tc, 'rowSpan') ?? 1));
        // Table style parts, lowest priority first.
        const parts: string[] = ['wholeTbl'];
        if (flags.bandCol) parts.push((col - (flags.firstCol ? 1 : 0)) % 2 === 0 ? 'band1V' : 'band2V');
        const bodyRow = r - (flags.firstRow ? 1 : 0);
        if (flags.bandRow && !(flags.firstRow && r === 0) && !(flags.lastRow && r === nR - 1)) parts.push(bodyRow % 2 === 0 ? 'band1H' : 'band2H');
        if (flags.lastCol && col + colSpan - 1 === nC - 1) parts.push('lastCol');
        if (flags.firstCol && col === 0) parts.push('firstCol');
        if (flags.lastRow && r + rowSpan - 1 === nR - 1) parts.push('lastRow');
        if (flags.firstRow && r === 0) parts.push('firstRow');
        let fill: SlideFill | null | undefined = tableFill;
        const borders: (SlideLine | null)[] = [null, null, null, null];
        const run: RunProps = {};
        for (const name of parts) {
          const sp = style ? kid(style, name) : undefined;
          if (!sp) continue;
          const tcStyle = kid(sp, 'tcStyle');
          const f = this.fill(kid(tcStyle, 'fill'), ctx, part) ?? (kid(tcStyle, 'fillRef') ? this.styleFill(kid(tcStyle, 'fillRef'), ctx, part) : undefined);
          if (f !== undefined) fill = f;
          const bdr = kid(tcStyle, 'tcBdr');
          const side = (n: string) => {
            const b = kid(bdr, n);
            if (!b) return undefined;
            const ln = kid(b, 'ln');
            if (ln) return this.line(ln, ctx);
            const ref = kid(b, 'lnRef');
            return ref ? this.styleLine(ref, ctx) : undefined;
          };
          const isTop = r === 0;
          const isBottom = r + rowSpan === nR;
          const isLeft = col === 0;
          const isRight = col + colSpan === nC;
          const edge = (outer: string, inside: string, isOuter: boolean, wholeTbl: boolean) => (wholeTbl ? side(isOuter ? outer : inside) : (side(outer) ?? (isOuter ? undefined : side(inside))));
          const whole = name === 'wholeTbl';
          const vals = [
            edge('left', 'insideV', isLeft, whole),
            edge('top', 'insideH', isTop, whole),
            edge('right', 'insideV', isRight, whole),
            edge('bottom', 'insideH', isBottom, whole),
          ];
          vals.forEach((v, i) => {
            if (v !== undefined) borders[i] = v;
          });
          const tx = kid(sp, 'tcTxStyle');
          if (tx) {
            if (attr(tx, 'b') === 'on') run.b = true;
            if (attr(tx, 'i') === 'on') run.i = true;
            const col2 = colorIn(tx, ctx) ?? colorIn(kid(tx, 'fontRef'), ctx);
            if (col2) run.color = col2;
          }
        }
        const tcPr = kid(tc, 'tcPr');
        const own = this.fill(tcPr, ctx, part);
        if (own !== undefined) fill = own;
        (['lnL', 'lnT', 'lnR', 'lnB'] as const).forEach((n, i) => {
          const ln = kid(tcPr, n);
          if (ln) {
            const l = this.line(ln, ctx);
            if (l !== undefined) borders[i] = l;
          }
        });
        const body: BodyProps = {
          inset: [pt(attr(tcPr, 'marL'), 7.2), pt(attr(tcPr, 'marT'), 3.6), pt(attr(tcPr, 'marR'), 7.2), pt(attr(tcPr, 'marB'), 3.6)],
          anchor: (attr(tcPr, 'anchor') as 't' | 'ctr' | 'b' | null) ?? 't',
          wrap: true,
          vert: attr(tcPr, 'vert') === 'vert270' ? 270 : attr(tcPr, 'vert') === 'vert' ? 90 : 0,
        };
        const levels: (ParaProps | undefined)[][] = [this.presDefault, Array.from({ length: 9 }, () => ({ run: { ...run } }))];
        const text = this.text(kid(tc, 'txBody'), levels, {}, body, ctx, part) ?? {
          html: '',
          inset: body.inset as [number, number, number, number],
          anchor: body.anchor ?? 't',
          wrap: true,
          vert: 0,
          shrink: false,
        };
        cells.push({
          col,
          row: r,
          colSpan,
          rowSpan,
          fill: fill ?? undefined,
          borders: borders as SlideTableCell['borders'],
          text: {
            ...text,
            html: text.html || `<div style="font-size:${Number(attr(path(tc, 'txBody', 'p', 'endParaRPr'), 'sz') ?? 1800) / 100}pt;line-height:1.2">&#160;</div>`,
          },
        });
      }
    });
    out.push({ kind: 'table', box, cols, rows, cells });
  }

  // Backgrounds ---------------------------------------------------------------
  background(part: Part, ctx: Ctx): SlideFill | null | undefined {
    const bg = path(part.doc.documentElement, 'cSld', 'bg');
    if (!bg) return undefined;
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) return this.fill(bgPr, ctx, part);
    const ref = kid(bg, 'bgRef');
    if (ref) return this.styleFill(ref, ctx, part);
    return undefined;
  }
}

/** PowerPoint's built-in table styles are not always written into the file: the default one, approximated. */
function builtinTableStyle(id: string): Element | null {
  // {5C22544A-7EE6-4342-B048-85BDC9FD1C3A} Medium Style 2 – Accent 1, and its siblings for accents 2–6.
  const accents: Record<string, string> = {
    '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1',
    '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'accent2',
    '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3',
    '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4',
    '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5',
    '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6',
    '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'dk1',
  };
  const accent = accents[id.toUpperCase()];
  if (!accent) return null;
  const ln = `<a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln>`;
  const xml = `<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:left>${ln}</a:left><a:right>${ln}</a:right><a:top>${ln}</a:top><a:bottom>${ln}</a:bottom><a:insideH>${ln}</a:insideH><a:insideV>${ln}</a:insideV></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="${accent}"><a:tint val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>
<a:band1H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="${accent}"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H>
<a:band1V><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="${accent}"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1V>
<a:lastCol><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="${accent}"/></a:solidFill></a:fill></a:tcStyle></a:lastCol>
<a:firstCol><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="${accent}"/></a:solidFill></a:fill></a:tcStyle></a:firstCol>
<a:lastRow><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:top><a:ln w="38100"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="${accent}"/></a:solidFill></a:fill></a:tcStyle></a:lastRow>
<a:firstRow><a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:bottom><a:ln w="38100"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="${accent}"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>
</a:tblStyle>`;
  return new DOMParser().parseFromString(xml, 'application/xml').documentElement;
}

/** The text of a slide's title placeholder, for its bookmark. */
function titleOf(items: Element, reader: Reader): string | undefined {
  for (const sp of items.getElementsByTagName('*')) {
    if (sp.localName !== 'sp') continue;
    const ph = reader.placeholderOf(sp);
    if (!ph || (ph.type !== 'title' && ph.type !== 'ctrTitle')) continue;
    const text = kids(kid(sp, 'txBody'), 'p')
      .map((p) => [...p.getElementsByTagName('*')].filter((e) => e.localName === 't').map((e) => e.textContent ?? '').join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }
  return undefined;
}

export type PptxOptions = { includeHidden: boolean };

export function readPptx(data: ArrayBuffer, o: PptxOptions): PptxResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error('This file is not a valid PowerPoint presentation (.pptx). Old .ppt files need to be saved as .pptx first.');
  }
  const pkg = new Package(files);
  const mainTarget =
    [...(pkg.xml('_rels/.rels')?.getElementsByTagName('Relationship') ?? [])].find((r) => (r.getAttribute('Type') ?? '').endsWith('/officeDocument'))?.getAttribute('Target') ?? 'ppt/presentation.xml';
  const pres = pkg.part(mainTarget.replace(/^\//, ''));
  if (!pres || pres.doc.documentElement.localName !== 'presentation') {
    if (files['word/document.xml']) throw new Error('This is a Word document, not a presentation. Use Word to PDF.');
    if (files['xl/workbook.xml']) throw new Error('This is a spreadsheet, not a presentation. Use Excel to PDF.');
    if (files['content.xml']) throw new Error('OpenDocument presentations (.odp) are not supported; save it as .pptx first.');
    throw new Error('This file is not a valid PowerPoint presentation (no readable presentation.xml).');
  }
  const presEl = pres.doc.documentElement;
  const sz = kid(presEl, 'sldSz');
  const width = pt(attr(sz, 'cx'), 720);
  const height = pt(attr(sz, 'cy'), 540);
  const reader = new Reader(pkg);

  // Table styles written into the file.
  const tsPart = [...pres.rels.values()].find((r) => r.type.endsWith('/tableStyles'));
  const ts = tsPart ? pkg.xml(tsPart.target) : null;
  for (const s of kids(ts?.documentElement, 'tblStyle')) reader.tableStyles.set((attr(s, 'styleId') ?? '').toUpperCase(), s);
  for (const [k, v] of [...reader.tableStyles]) reader.tableStyles.set(k.toUpperCase(), v);
  const getStyle = reader.tableStyles.get.bind(reader.tableStyles);
  reader.tableStyles.get = (k: string) => getStyle(k.toUpperCase());

  const slides: Slide[] = [];
  const themes = new Map<string, Theme>();
  const masters = new Map<string, Layer>();
  let lang: string | undefined;

  const ids = kids(kid(presEl, 'sldIdLst'), 'sldId');
  for (const sid of ids) {
    const rel = pres.rels.get(rid(sid, 'id') ?? '');
    if (!rel) continue;
    const slide = pkg.part(rel.target);
    if (!slide) continue;
    const sldEl = slide.doc.documentElement;
    if (attr(sldEl, 'show') === '0' && !o.includeHidden) {
      reader.report.hidden += 1;
      continue;
    }
    const layoutPart = pkg.related(slide, '/slideLayout');
    const masterPart = layoutPart ? pkg.related(layoutPart, '/slideMaster') : null;
    if (!masterPart) continue;
    let master = masters.get(masterPart.path);
    if (!master) {
      const themePart = pkg.related(masterPart, '/theme');
      let theme = themes.get(themePart?.path ?? '');
      if (!theme) {
        theme = readTheme(themePart?.doc ?? null);
        themes.set(themePart?.path ?? '', theme);
      }
      const ctx: Ctx = { theme, clrMap: readClrMap(kid(masterPart.doc.documentElement, 'clrMap')) };
      master = { part: masterPart, shapes: kids(path(masterPart.doc.documentElement, 'cSld', 'spTree')), ctx };
      masters.set(masterPart.path, master);
      if (reader.presDefault.length === 0) reader.presDefault = readListStyle(kid(presEl, 'defaultTextStyle'), ctx);
    }
    const override = (el: Element): Ctx => {
      const ovr = path(el, 'clrMapOvr', 'overrideClrMapping');
      return ovr ? { ...master.ctx, clrMap: readClrMap(ovr) } : master.ctx;
    };
    const layoutCtx = layoutPart ? override(layoutPart.doc.documentElement) : master.ctx;
    const layout: Layer | null = layoutPart ? { part: layoutPart, shapes: kids(path(layoutPart.doc.documentElement, 'cSld', 'spTree')), ctx: layoutCtx } : null;
    const slideCtx = override(sldEl);

    reader.slideNumber = ids.indexOf(sid) + 1;
    const items: SlideItem[] = [];
    const env = { master, layout, isSlide: false };
    const showMaster = attr(sldEl, 'showMasterSp') !== '0';
    const layoutShowsMaster = !layoutPart || attr(layoutPart.doc.documentElement, 'showMasterSp') !== '0';
    const masterTree = path(masterPart.doc.documentElement, 'cSld', 'spTree');
    if (showMaster && layoutShowsMaster && masterTree) reader.tree(masterTree, masterPart, master.ctx, items, IDENTITY, env);
    const layoutTree = layoutPart ? path(layoutPart.doc.documentElement, 'cSld', 'spTree') : undefined;
    if (showMaster && layoutTree && layoutPart) reader.tree(layoutTree, layoutPart, layoutCtx, items, IDENTITY, env);
    const slideTree = path(sldEl, 'cSld', 'spTree');
    if (slideTree) reader.tree(slideTree, slide, slideCtx, items, IDENTITY, { ...env, isSlide: true });

    const background =
      reader.background(slide, slideCtx) ??
      (layoutPart ? reader.background(layoutPart, layoutCtx) : undefined) ??
      reader.background(masterPart, master.ctx) ??
      undefined;
    if (!lang) {
      const l = descendant(slideTree, 'rPr')?.getAttribute('lang');
      if (l) lang = l;
    }
    slides.push({ background: background ?? undefined, items, title: slideTree ? titleOf(slideTree, reader) : undefined, number: reader.slideNumber });
  }
  reader.report.slides = slides.length;
  if (slides.length === 0) {
    throw new Error(reader.report.hidden > 0 ? 'Every slide in this presentation is hidden. Turn on "Include hidden slides".' : 'This presentation has no slides.');
  }
  const core = pkg.xml('docProps/core.xml');
  const meta = (name: string) => [...(core?.getElementsByTagName('*') ?? [])].find((e) => e.localName === name)?.textContent?.trim() || undefined;
  return {
    request: { width, height, slides, images: reader.images, title: meta('title'), author: meta('creator'), lang },
    report: reader.report,
  };
}

