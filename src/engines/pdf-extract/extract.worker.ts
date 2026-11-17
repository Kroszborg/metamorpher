// Reads the structure of PDF pages for the "PDF to Word / HTML / EPUB /
// Excel" tools: styled text lines, images and links (MuPDF structured text),
// or positioned words for table detection. MuPDF.js is served from
// /vendor/mupdf, like the other MuPDF workers.
import { expose, transfer } from 'comlink';
import type * as M from 'mupdf';
import { openPdf } from '../mupdf/ops/common';
import type { ExtractProgress, ImageBlock, Line, RawPage, Rect, Span, TextBlock, Word, WordPage } from './types';

type Mupdf = typeof M;

let lib: Promise<Mupdf> | null = null;
function load(): Promise<Mupdf> {
  lib ??= (
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/mupdf/mupdf.js', self.location.origin).href
    ) as Promise<Mupdf>
  ).then((m) => {
    m.setLog({ warning: () => undefined, error: (msg) => console.warn(`MuPDF: ${msg}`) });
    return m;
  });
  return lib;
}

const STEXT = 'preserve-images,preserve-whitespace,dehyphenate,clip';

type FontInfo = { name: string; bold: boolean; italic: boolean; mono: boolean };

function hex(color: M.Color): string {
  const c = color.length === 1 ? [color[0], color[0], color[0]] : color.length === 4 ? cmyk(color) : color;
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0')).join('')}`;
}
function cmyk([c, m, y, k]: number[]): number[] {
  return [(1 - (c ?? 0)) * (1 - (k ?? 0)), (1 - (m ?? 0)) * (1 - (k ?? 0)), (1 - (y ?? 0)) * (1 - (k ?? 0))];
}

/** "ABCDEF+Calibri-BoldItalic" → "Calibri". */
function familyOf(name: string): string {
  const base = name.replace(/^[A-Z]{6}\+/, '');
  return base.replace(/[-,](Bold|Italic|Oblique|Regular|Roman|Medium|Light|Semibold|SemiBold|Black|Heavy|Book|MT|PS|PSMT|Condensed)+.*$/i, '').replace(/(PSMT|MT|PS)$/, '') || base;
}

function union(a: Rect | null, q: M.Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const r: Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return a ? [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])] : r;
}

function encodeImage(m: Mupdf, image: M.Image, maxSide: number): { bytes: Uint8Array<ArrayBuffer>; mime: 'image/png' | 'image/jpeg'; px: [number, number] } | null {
  let pix: M.Pixmap | null = null;
  try {
    pix = image.toPixmap();
    const cs = pix.getColorSpace();
    if (cs && !cs.isRGB() && !cs.isGray()) {
      const rgb = pix.convertToColorSpace(m.ColorSpace.DeviceRGB, true);
      pix.destroy();
      pix = rgb;
    }
    const w = pix.getWidth();
    const h = pix.getHeight();
    if (w * h > maxSide * maxSide * 4) return null; // absurdly large: skip rather than run out of memory
    const alpha = pix.getAlpha() > 0;
    const photo = !alpha && w * h > 40000 && (pix.getNumberOfComponents() >= 3 || !image.getImageMask());
    const data = photo ? pix.asJPEG(88, false) : pix.asPNG();
    return { bytes: new Uint8Array(data), mime: photo ? 'image/jpeg' : 'image/png', px: [w, h] };
  } catch {
    return null;
  } finally {
    pix?.destroy();
  }
}

/**
 * Thin horizontal and vertical lines drawn on the page (filled hairline
 * rectangles, stroked segments and rectangle edges): the rules of tables.
 */
function readRules(m: Mupdf, page: M.Page, x0: number, y0: number): Rect[] {
  const rules: Rect[] = [];
  let count = 0;
  const add = (ax: number, ay: number, bx: number, by: number, width: number) => {
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    if (w <= 2.5 && h >= 4) rules.push([Math.min(ax, bx) - width / 2 - x0, Math.min(ay, by) - y0, Math.max(ax, bx) + width / 2 - x0, Math.max(ay, by) - y0]);
    else if (h <= 2.5 && w >= 4) rules.push([Math.min(ax, bx) - x0, Math.min(ay, by) - width / 2 - y0, Math.max(ax, bx) - x0, Math.max(ay, by) + width / 2 - y0]);
  };
  const subpaths = (path: M.Path, ctm: M.Matrix): [number, number][][] => {
    const out: [number, number][][] = [];
    const t = (x: number, y: number): [number, number] => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    path.walk({
      moveTo: (x, y) => void out.push([t(x, y)]),
      lineTo: (x, y) => void out[out.length - 1]?.push(t(x, y)),
      // Curves are not rules: mark the subpath so it is skipped.
      curveTo: () => void out[out.length - 1]?.push([Number.NaN, Number.NaN]),
      closePath: () => {
        const sp = out[out.length - 1];
        if (sp?.[0]) sp.push(sp[0]);
      },
    });
    return out;
  };
  const dev = new m.Device({
    fillPath(path, _evenOdd, ctm) {
      if (++count > 20000) return;
      for (const sp of subpaths(path, ctm)) {
        if (sp.some((q) => Number.isNaN(q[0]))) continue;
        const xs = sp.map((q) => q[0]);
        const ys = sp.map((q) => q[1]);
        add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 0);
      }
    },
    strokePath(path, stroke, ctm) {
      if (++count > 20000) return;
      const width = Math.max(0.3, stroke.getLineWidth() * Math.hypot(ctm[0], ctm[1]));
      for (const sp of subpaths(path, ctm)) {
        if (sp.some((q) => Number.isNaN(q[0]))) continue;
        for (let i = 1; i < sp.length; i++) {
          const a = sp[i - 1] as [number, number];
          const b = sp[i] as [number, number];
          add(a[0], a[1], b[0], b[1], width);
        }
      }
    },
  });
  try {
    page.run(dev, m.Matrix.identity);
  } catch {
    // A broken content stream: no rules.
  } finally {
    dev.close();
    dev.destroy();
  }
  return rules.length > 5000 ? [] : rules;
}

function readPage(m: Mupdf, page: M.Page, opts: { images: boolean; maxSide: number; rules: boolean }, fonts: Map<string, FontInfo>): RawPage {
  const [x0, y0, x1, y1] = page.getBounds();
  const blocks: (TextBlock | ImageBlock)[] = [];
  const stext = page.toStructuredText(opts.images ? STEXT : STEXT.replace('preserve-images,', ''));
  let block: TextBlock | null = null;
  let line: { bbox: Rect | null; spans: Span[] } | null = null;
  const words: Word[] = [];
  let word: { text: string; bbox: Rect | null; size: number; bold: boolean } | null = null;
  const endWord = () => {
    if (word?.bbox && word.text.trim()) words.push({ text: word.text, bbox: word.bbox, size: word.size, bold: word.bold });
    word = null;
  };
  const info = (font: M.Font): FontInfo => {
    const name = font.getName();
    let f = fonts.get(name);
    if (!f) {
      f = {
        name: familyOf(name),
        bold: font.isBold() || /bold|black|heavy|semibold|demi/i.test(name),
        italic: font.isItalic() || /italic|oblique/i.test(name),
        mono: font.isMono() || /mono|courier|consol/i.test(name),
      };
      fonts.set(name, f);
    }
    return f;
  };
  try {
    stext.walk({
      onImageBlock(bbox, _transform, image) {
        if (!opts.images) return;
        const enc = encodeImage(m, image, opts.maxSide);
        if (enc) blocks.push({ kind: 'image', bbox: [bbox[0] - x0, bbox[1] - y0, bbox[2] - x0, bbox[3] - y0], ...enc });
      },
      beginTextBlock(bbox) {
        block = { kind: 'text', bbox: [bbox[0] - x0, bbox[1] - y0, bbox[2] - x0, bbox[3] - y0], lines: [] };
      },
      beginLine() {
        line = { bbox: null, spans: [] };
        endWord();
      },
      onChar(c, _origin, font, size, quad, color) {
        if (!line) return;
        // A wide gap inside a line (text columns drawn line by line): the rest is a separate line.
        if (c !== ' ' && line.bbox && quad[0] - x0 - line.bbox[2] > Math.max(18, size * 2.2) && line.spans.some((sp) => sp.text.trim())) {
          if (block) block.lines.push({ bbox: line.bbox, spans: line.spans } as Line);
          line = { bbox: null, spans: [] };
        }
        const f = info(font);
        if (/\s/.test(c)) endWord();
        else {
          const wq = quadOffset(quad, x0, y0);
          if (word?.bbox && wq[0] - word.bbox[2] > size * 0.6) endWord();
          word ??= { text: '', bbox: null, size, bold: f.bold };
          word.text += c;
          word.bbox = union(word.bbox, wq);
        }
        const col = hex(color);
        let last = line.spans[line.spans.length - 1];
        const sz = Math.round(size * 10) / 10;
        if (last && last.font === f.name && last.size === sz && last.bold === f.bold && last.italic === f.italic && last.color === col) last.text += c;
        else if (last && c === ' ') last.text += c;
        else {
          last = { text: c, font: f.name, size: sz, bold: f.bold, italic: f.italic, mono: f.mono, color: col };
          line.spans.push(last);
        }
        if (c !== ' ') {
          const q = quadOffset(quad, x0, y0);
          line.bbox = union(line.bbox, q);
          last.bbox = union(last.bbox ?? null, q);
        }
      },
      endLine() {
        endWord();
        if (block && line?.bbox && line.spans.some((s) => s.text.trim())) block.lines.push({ bbox: line.bbox, spans: line.spans } as Line);
        line = null;
      },
      endTextBlock() {
        if (block && block.lines.length) blocks.push(block);
        block = null;
      },
    });
  } finally {
    stext.destroy();
  }
  const links: RawPage['links'] = [];
  for (const l of page.getLinks()) {
    if (l.isExternal()) {
      const b = l.getBounds();
      links.push({ bbox: [b[0] - x0, b[1] - y0, b[2] - x0, b[3] - y0], uri: l.getURI() });
    }
    l.destroy();
  }
  return { width: x1 - x0, height: y1 - y0, blocks, links, words, rules: opts.rules ? readRules(m, page, x0, y0) : undefined };
}

function quadOffset(q: M.Quad, x0: number, y0: number): M.Quad {
  return [q[0] - x0, q[1] - y0, q[2] - x0, q[3] - y0, q[4] - x0, q[5] - y0, q[6] - x0, q[7] - y0];
}

function readWords(m: Mupdf, page: M.Page): WordPage {
  const [x0, y0, x1, y1] = page.getBounds();
  const words: Word[] = [];
  const stext = page.toStructuredText('preserve-whitespace,clip');
  let cur: { text: string; bbox: Rect | null; size: number; bold: boolean } | null = null;
  const flush = () => {
    if (cur?.bbox && cur.text.trim()) words.push({ text: cur.text, bbox: cur.bbox, size: cur.size, bold: cur.bold });
    cur = null;
  };
  try {
    stext.walk({
      beginLine() {
        flush();
      },
      onChar(c, _o, font, size, quad) {
        if (/\s/.test(c)) {
          flush();
          return;
        }
        // A wide gap inside a "word" (justified columns glued together) also ends it.
        const q = quadOffset(quad, x0, y0);
        if (cur?.bbox && q[0] - cur.bbox[2] > size * 0.6) flush();
        cur ??= { text: '', bbox: null, size, bold: font.isBold() || /bold/i.test(font.getName()) };
        cur.text += c;
        cur.bbox = union(cur.bbox, q);
      },
      endLine() {
        flush();
      },
    });
  } finally {
    stext.destroy();
  }
  return { width: x1 - x0, height: y1 - y0, words, rules: readRules(m, page, x0, y0) };
}

const api = {
  async structure(file: Blob, opts: { password?: string; images: boolean; maxSide?: number; rules?: boolean }, progress?: ExtractProgress) {
    const m = await load();
    const doc = openPdf(m, new Uint8Array(await file.arrayBuffer()), opts.password);
    const fonts = new Map<string, FontInfo>();
    try {
      const n = doc.countPages();
      const pages: RawPage[] = [];
      for (let i = 0; i < n; i++) {
        const page = doc.loadPage(i);
        try {
          pages.push(readPage(m, page, { images: opts.images, maxSide: opts.maxSide ?? 4096, rules: opts.rules !== false }, fonts));
        } finally {
          page.destroy();
        }
        progress?.(i + 1, n, `Reading page ${i + 1} of ${n}`);
      }
      const title = doc.getMetaData('info:Title') || undefined;
      const author = doc.getMetaData('info:Author') || undefined;
      const buffers = pages.flatMap((p) => p.blocks.flatMap((b) => (b.kind === 'image' ? [b.bytes.buffer] : [])));
      return transfer({ pages, title, author }, buffers);
    } finally {
      doc.destroy();
    }
  },

  async words(file: Blob, opts: { password?: string }, progress?: ExtractProgress): Promise<WordPage[]> {
    const m = await load();
    const doc = openPdf(m, new Uint8Array(await file.arrayBuffer()), opts.password);
    try {
      const n = doc.countPages();
      const pages: WordPage[] = [];
      for (let i = 0; i < n; i++) {
        const page = doc.loadPage(i);
        try {
          pages.push(readWords(m, page));
        } finally {
          page.destroy();
        }
        progress?.(i + 1, n, `Reading page ${i + 1} of ${n}`);
      }
      return pages;
    } finally {
      doc.destroy();
    }
  },

  /** MuPDF's positioned HTML of every page (absolute positions, images inline). */
  async fixedHtml(file: Blob, opts: { password?: string }, progress?: ExtractProgress): Promise<{ pages: string[]; title?: string }> {
    const m = await load();
    const doc = openPdf(m, new Uint8Array(await file.arrayBuffer()), opts.password);
    try {
      const n = doc.countPages();
      const pages: string[] = [];
      for (let i = 0; i < n; i++) {
        const page = doc.loadPage(i);
        const stext = page.toStructuredText('preserve-images,preserve-whitespace,clip');
        try {
          pages.push(stext.asHTML(i));
        } finally {
          stext.destroy();
          page.destroy();
        }
        progress?.(i + 1, n, `Reading page ${i + 1} of ${n}`);
      }
      return { pages, title: doc.getMetaData('info:Title') || undefined };
    } finally {
      doc.destroy();
    }
  },
};

export type ExtractWorkerApi = typeof api;
expose(api);
