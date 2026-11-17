// Worker-only: copy and search for shaped scripts (Devanagari, Bengali,
// Tamil …). HarfBuzz turns several characters into one glyph (conjuncts
// such as क्ष); MuPDF's PDF writer builds each font's ToUnicode map from the
// font's character map, so those glyphs extract as U+FFFD. The laid-out
// text knows better: every glyph is followed by the extra characters of its
// cluster (glyph id -1). This collects glyph → cluster text per font while a
// page is drawn and rewrites the ToUnicode maps of the finished PDF.
import type * as M from 'mupdf';

type Mupdf = typeof M;

/** Font name → glyph id → cluster text → how often. */
export type Clusters = Map<string, Map<number, Map<string, number>>>;

/** Scripts whose shaping makes ligature glyphs (worth collecting for). */
export function needsClusters(text: string): boolean {
  return /[ऀ-෿ༀ-࿿က-႟ក-៿؀-ۿ฀-໿]/.test(text);
}

/** Records the glyph → text clusters of everything drawn on `page`. */
export function collectClusters(m: Mupdf, page: M.Page, into: Clusters): void {
  let font: string | null = null;
  let gid = -1;
  let text = '';
  const flush = () => {
    if (font !== null && gid >= 0 && text) {
      let glyphs = into.get(font);
      if (!glyphs) {
        glyphs = new Map();
        into.set(font, glyphs);
      }
      let counts = glyphs.get(gid);
      if (!counts) {
        counts = new Map();
        glyphs.set(gid, counts);
      }
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    gid = -1;
    text = '';
  };
  const walk = (t: M.Text) => {
    t.walk({
      showGlyph(f, _trm, glyph, unicode) {
        if (glyph < 0) {
          if (unicode >= 0) text += String.fromCodePoint(unicode);
          return;
        }
        flush();
        font = f.getName();
        gid = glyph;
        text = unicode >= 0 ? String.fromCodePoint(unicode) : '';
      },
    });
    flush();
  };
  const dev = new m.Device({
    fillText: (t) => walk(t),
    strokeText: (t) => walk(t),
    clipText: (t) => walk(t),
    ignoreText: (t) => walk(t),
  });
  try {
    page.run(dev, m.Matrix.identity);
  } finally {
    dev.close();
    dev.destroy();
  }
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

function utf16(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x10000) out += hex4(c);
    else {
      const v = c - 0x10000;
      out += hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 1023));
    }
  }
  return out;
}

function fromUtf16(h: string): string {
  const units: number[] = [];
  for (let i = 0; i + 4 <= h.length; i += 4) units.push(parseInt(h.slice(i, i + 4), 16));
  return String.fromCharCode(...units);
}

/** The bfchar / bfrange entries of a ToUnicode CMap. */
function parseCMap(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const e of (block[1] as string).matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(e[1] as string, 16), fromUtf16(e[2] as string));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const e of (block[1] as string).matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(e[1] as string, 16);
      const hi = parseInt(e[2] as string, 16);
      const dst = e[3] as string;
      if (hi - lo > 0xffff) continue;
      if (dst.startsWith('[')) {
        const items = [...dst.matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => fromUtf16(x[1] as string));
        items.forEach((s, k) => map.set(lo + k, s));
      } else {
        const base = (dst.slice(1, -1) as string).padStart(4, '0');
        const head = base.slice(0, -4);
        const last = parseInt(base.slice(-4), 16);
        for (let c = lo; c <= hi; c++) map.set(c, fromUtf16(head + hex4(last + (c - lo))));
      }
    }
  }
  return map;
}

function writeCMap(map: Map<number, string>): string {
  const entries = [...map.entries()].filter(([, s]) => s.length > 0).sort((a, b) => a[0] - b[0]);
  let body = '';
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    body += `${chunk.length} beginbfchar\n${chunk.map(([c, s]) => `<${hex4(c)}> <${utf16(s)}>`).join('\n')}\nendbfchar\n`;
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

/**
 * Rewrites the ToUnicode maps of the Type0 fonts in `pdf` with the
 * collected clusters (only glyphs whose cluster has more than one
 * character, or that the old map did not know). Returns the glyphs fixed.
 */
export function fixToUnicode(pdf: M.PDFDocument, clusters: Clusters): number {
  if (clusters.size === 0) return 0;
  let fixed = 0;
  const done = new Set<number>();
  const n = pdf.countPages();
  for (let i = 0; i < n; i++) {
    const fonts = pdf.findPage(i).get('Resources').get('Font');
    if (!fonts.isDictionary()) continue;
    fonts.forEach((ref) => {
      const num = ref.isIndirect() ? ref.asIndirect() : -1;
      if (num >= 0 && done.has(num)) return;
      if (num >= 0) done.add(num);
      const font = ref.resolve();
      if (font.get('Subtype').asName() !== 'Type0') return;
      const name = font.get('BaseFont').asName().replace(/^[A-Z]{6}\+/, '');
      const glyphs = clusters.get(name);
      const tu = font.get('ToUnicode');
      if (!glyphs || !tu.isStream()) return;
      const map = parseCMap(tu.readStream().asString());
      let changed = 0;
      for (const [gid, counts] of glyphs) {
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!best) continue;
        const old = map.get(gid);
        if (old === best) continue;
        if ([...best].length > 1 || old === undefined || old === '�') {
          map.set(gid, best);
          changed += 1;
        }
      }
      if (changed > 0) {
        tu.writeStream(new TextEncoder().encode(writeCMap(map)));
        fixed += changed;
      }
    });
  }
  return fixed;
}
