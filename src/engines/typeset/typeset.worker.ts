// Document layout in a module worker: HTML (from Markdown, text, CSV, Word
// …) or an e-book goes in, a PDF with real, selectable text comes out.
// MuPDF's HTML engine does the layout (CSS, tables, images, HarfBuzz shaping,
// bidirectional text, line breaking); this worker adds fonts for the scripts
// and symbols MuPDF does not ship, tables with measured columns and repeated
// headers, page numbers, bookmarks, links and font subsetting.
//
// MuPDF.js is served unbundled from /vendor/mupdf (see src/engines/mupdf).
import { expose } from 'comlink';
import { unzipSync } from 'fflate';
import type * as M from 'mupdf';
import { FontSet, installFontSet } from './fonts';
import { documentHtml, measureTable, PAGE_BREAK, type Measure, tableHtml, type TableRender, wrapSymbolRuns } from './html';
import { rotateGeometry } from './page';
import { renderSlides } from './slides';
import { type Clusters, collectClusters, fixToUnicode, needsClusters } from './tounicode';
import type { Orientation, PageGeometry, ProgressFn, ReflowRequest, RunningText, SlidesRequest, TableBlock, TextBoxRequest, TypesetRequest } from './types';

type Mupdf = typeof M;

let lib: Promise<Mupdf> | null = null;
function load(): Promise<Mupdf> {
  lib ??= (
    import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/mupdf/mupdf.js', self.location.origin).href
    ) as Promise<Mupdf>
  ).then((m) => {
    // MuPDF's warnings (unknown EPUB versions, unsupported CSS) are noise here; errors still throw.
    m.setLog({ warning: () => undefined, error: (msg) => console.warn(`MuPDF: ${msg}`) });
    return m;
  });
  return lib;
}

const encoder = new TextEncoder();

function isWide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f300;
}

/** Text width in em with Nimbus Sans metrics (what table cells are set in unless the theme says otherwise). */
function makeMeasure(m: Mupdf): { measure: Measure; destroy: () => void } {
  const fonts = [new m.Font('Helvetica'), new m.Font('Helvetica-Bold')] as const;
  const caches = [new Map<number, number>(), new Map<number, number>()];
  const measure: Measure = (text, bold) => {
    const font = fonts[bold ? 1 : 0];
    const cache = caches[bold ? 1 : 0] as Map<number, number>;
    let w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0) as number;
      let a = cache.get(cp);
      if (a === undefined) {
        const gid = font.encodeCharacter(cp);
        a = gid > 0 ? font.advanceGlyph(gid) : isWide(cp) ? 1 : 0.6;
        cache.set(cp, a);
      }
      w += a;
    }
    return w;
  };
  return { measure, destroy: () => fonts.forEach((f) => f.destroy()) };
}

function contentWidth(g: PageGeometry): number {
  return g.width - g.margin.left - g.margin.right;
}

function layoutDoc(m: Mupdf, html: string, g: PageGeometry, em: number, height = g.height): M.Document {
  const doc = m.Document.openDocument(encoder.encode(html), 'text/html');
  doc.layout(g.width, height, em);
  return doc;
}

const MARKER = /^#mmr(\d+)-(\d+)$/;

/** Page of every marked row of every table (-1 when the row has no marker: empty rows). */
function rowPages(doc: M.Document, tables: TableRender[]): Int32Array[] {
  const pages = tables.map((t) => new Int32Array(t.block.rows.length).fill(-1));
  const n = doc.countPages();
  for (let p = 0; p < n; p++) {
    const page = doc.loadPage(p);
    for (const link of page.getLinks()) {
      const hit = MARKER.exec(link.getURI());
      if (!hit) continue;
      const arr = pages[Number(hit[1])];
      const row = Number(hit[2]);
      if (arr && row < arr.length && arr[row] === -1) arr[row] = p;
      link.destroy();
    }
    page.destroy();
  }
  return pages;
}

/** Chunk starts: a new chunk wherever the next marked row is on a later page. */
function chunksFrom(pageOfRow: Int32Array): number[] {
  const starts = [0];
  let current = -1;
  for (let r = 0; r < pageOfRow.length; r++) {
    const p = pageOfRow[r] as number;
    if (p < 0) continue;
    if (current >= 0 && p !== current && r !== starts[starts.length - 1]) starts.push(r);
    current = p;
  }
  return starts;
}

/** Splits chunks whose rows spilled onto a following page. Returns null when nothing spilled. */
function fixChunks(chunks: number[], pageOfRow: Int32Array): number[] | null {
  const next = [...chunks];
  let changed = false;
  for (let k = 0; k < chunks.length; k++) {
    const from = chunks[k] as number;
    const to = k + 1 < chunks.length ? (chunks[k + 1] as number) : pageOfRow.length;
    let page = -1;
    for (let r = from; r < to; r++) {
      const p = pageOfRow[r] as number;
      if (p < 0) continue;
      if (page < 0) page = p;
      else if (p !== page) {
        if (r !== from) {
          next.push(r);
          changed = true;
        }
        break;
      }
    }
  }
  return changed ? [...new Set(next)].sort((a, b) => a - b) : null;
}

type WriteOptions = {
  pageNumbers: boolean;
  outline: boolean;
  title?: string;
  author?: string;
  lang?: string;
  progress?: ProgressFn;
  /** Progress fraction already used before writing starts. */
  base: number;
  /** Destinations from MuPDF's HTML layout are measured from the top margin. */
  marginTop: number;
  /** Draws headers, footers and footnotes on page `i` of `n`. */
  decorate?: (dev: M.Device, i: number, n: number, bounds: M.Rect) => void;
  /** Glyph clusters of shaped scripts, collected while drawing, for the ToUnicode maps (see tounicode.ts). */
  clusters?: Clusters;
};

/** A small HTML fragment laid out at a given width (headers, footers, footnotes). */
function layoutFragment(m: Mupdf, body: string, css: string, width: number, lang?: string): { doc: M.Document; page: M.Page; height: number } {
  const html = documentHtml(body, css, { width, height: 20000, margin: { top: 0, right: 0, bottom: 0, left: 0 } }, lang);
  const doc = m.Document.openDocument(encoder.encode(html), 'text/html');
  doc.layout(Math.max(10, width), 20000, 12);
  const page = doc.loadPage(0);
  let height = 0;
  const st = page.toStructuredText('preserve-whitespace');
  st.walk({
    beginLine(bbox) {
      if (bbox[3] > height) height = bbox[3];
    },
    onImageBlock(bbox) {
      if (bbox[3] > height) height = bbox[3];
    },
  });
  st.destroy();
  return { doc, page, height };
}

function runningFor(r: RunningText | undefined, i: number): string | undefined {
  if (!r) return undefined;
  if (i === 0 && r.first !== undefined) return r.first;
  if ((i + 1) % 2 === 0 && r.even !== undefined) return r.even;
  return r.default;
}

const FOOTNOTE_GAP = 8;
const FOOTNOTE_RULE = '<div style="width:30%;border-top:0.6pt solid #000;margin:0 0 3pt;height:0"></div>';

/** Page of the first reference to every footnote (by id). */
function footnotePages(doc: M.Document): Map<string, number> {
  const pages = new Map<string, number>();
  const n = doc.countPages();
  for (let p = 0; p < n; p++) {
    const page = doc.loadPage(p);
    for (const link of page.getLinks()) {
      const hit = /^#mm-fn-(.+)$/.exec(link.getURI());
      if (hit && !pages.has(hit[1] as string)) pages.set(hit[1] as string, p);
      link.destroy();
    }
    page.destroy();
  }
  return pages;
}

function footnoteHtml(notes: { id: string; html: string }[], onPage: Map<string, number>, page: number): string {
  const here = notes.filter((nt) => onPage.get(nt.id) === page);
  return here.length ? FOOTNOTE_RULE + here.map((nt) => nt.html).join('') : '';
}

/** Draws the laid-out document into a new PDF: page content, numbers, links, bookmarks, metadata, subset fonts. */
function writePdf(m: Mupdf, doc: M.Document, o: WriteOptions): { bytes: Uint8Array<ArrayBuffer>; pages: number; bookmarks: number } {
  const n = doc.countPages();
  const buf = new m.Buffer();
  const writer = new m.DocumentWriter(buf, 'pdf', '');
  const numberFont = o.pageNumbers ? new m.Font('Helvetica') : null;
  type PendingLink = { page: number; rect: M.Rect; uri: string };
  const links: PendingLink[] = [];
  const total = n + Math.ceil(n / 4) + 1;
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const bounds = page.getBounds();
    const dev = writer.beginPage(bounds);
    page.run(dev, m.Matrix.identity);
    if (o.clusters) collectClusters(m, page, o.clusters);
    o.decorate?.(dev, i, n, bounds);
    if (numberFont) {
      const label = `${i + 1} / ${n}`;
      const size = 8.5;
      let w = 0;
      for (const ch of label) w += numberFont.advanceGlyph(numberFont.encodeCharacter(ch)) * size;
      const text = new m.Text();
      const x = (bounds[0] + bounds[2]) / 2 - w / 2;
      const y = bounds[3] - Math.max(14, Math.min(28, (bounds[3] - bounds[1]) * 0.03));
      text.showString(numberFont, [size, 0, 0, -size, x, y], label);
      dev.fillText(text, m.Matrix.identity, m.ColorSpace.DeviceRGB, [0.42, 0.45, 0.5], 1);
      text.destroy();
    }
    writer.endPage();
    for (const link of page.getLinks()) {
      const uri = link.getURI();
      if (uri.startsWith('#mm')) continue;
      if (link.isExternal()) {
        if (/^(https?:|mailto:)/i.test(uri)) links.push({ page: i, rect: link.getBounds(), uri });
      } else {
        try {
          const dest = doc.resolveLinkDestination(uri);
          if (dest.page >= 0) links.push({ page: i, rect: link.getBounds(), uri: `#page=${dest.page + 1}` });
        } catch {
          // A link to an anchor that does not exist: leave it out.
        }
      }
      link.destroy();
    }
    page.destroy();
    o.progress?.(o.base + (1 - o.base) * ((i + 1) / total), total, `Writing page ${i + 1} of ${n}`);
  }
  writer.close();
  numberFont?.destroy();

  const pdf = new m.PDFDocument(buf);
  try {
    let lastPage = -1;
    let pdfPage: M.PDFPage | null = null;
    for (const l of links) {
      if (l.page !== lastPage) {
        pdfPage?.destroy();
        pdfPage = pdf.loadPage(l.page);
        lastPage = l.page;
      }
      pdfPage?.createLink(l.rect, l.uri);
    }
    pdfPage?.destroy();

    let bookmarks = 0;
    if (o.outline) {
      const outline = doc.loadOutline();
      if (outline?.length) {
        const it = pdf.outlineIterator();
        type Item = NonNullable<ReturnType<M.Document['loadOutline']>>[number];
        const add = (items: Item[], depth: number) => {
          for (const item of items) {
            let page = item.page ?? 0;
            let y = 0;
            if (item.uri) {
              try {
                const dest = doc.resolveLinkDestination(item.uri);
                if (dest.page >= 0) page = dest.page;
                y = Number.isFinite(dest.y) ? Math.max(0, dest.y + o.marginTop - 6) : 0;
              } catch {
                // keep the item's own page
              }
            }
            const uri = pdf.formatLinkURI({ type: 'FitH', chapter: 0, page, x: 0, y, width: 0, height: 0, zoom: 0 });
            it.insert({ title: (item.title ?? '').trim() || 'Untitled', uri, open: depth === 0 });
            bookmarks += 1;
            if (item.down?.length) {
              it.prev();
              it.down();
              add(item.down, depth + 1);
              it.up();
              it.next();
            }
          }
        };
        add(outline, 0);
        it.destroy();
      }
    }

    if (o.title) pdf.setMetaData('info:Title', o.title);
    if (o.author) pdf.setMetaData('info:Author', o.author);
    pdf.setMetaData('info:Producer', 'Metamorpher (MuPDF)');
    pdf.setMetaData('info:Creator', 'Metamorpher');
    if (o.lang) pdf.setLanguage(o.lang);
    o.progress?.(0.97, 1, 'Embedding fonts');
    pdf.subsetFonts();
    if (o.clusters) fixToUnicode(pdf, o.clusters);
    const out = pdf.saveToBuffer('garbage=compact,compress,compress-fonts').asUint8Array();
    return { bytes: new Uint8Array(out), pages: n, bookmarks };
  } finally {
    pdf.destroy();
    buf.destroy();
  }
}

const FONT_NAME = /font-family\s*:\s*([^;"}<>]+)/gi;

function fontNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(FONT_NAME)) {
    for (const part of (m[1] as string).split(',')) names.add(part.replace(/["']|&quot;/g, '').trim().toLowerCase());
  }
  return [...names];
}

function missingList(fonts: FontSet): string[] {
  return [...fonts.missing].slice(0, 12).map((cp) => String.fromCodePoint(cp));
}

const api = {
  async render(req: TypesetRequest, progress?: ProgressFn) {
    const m = await load();
    progress?.(0.02, 1, 'Loading fonts');
    const tables = req.blocks.filter((b): b is TableBlock => b.kind === 'table');
    const htmlText = req.blocks.map((b) => (b.kind === 'html' ? b.html : '')).join('\n');
    let cellText = '';
    for (const t of tables) {
      cellText += `${t.title ?? ''}\n${(t.header ?? []).join('\t')}\n`;
      for (const row of t.rows) cellText += `${row.join('\t')}\n`;
    }
    const fonts = new FontSet(m);
    // Monospace text: code in the HTML, or a monospace body (the theme's code rules alone do not count).
    const monospace =
      /<(pre|code|kbd|samp|tt)\b/i.test(htmlText) ||
      /font-family\s*:[^;"]*monospace/i.test(htmlText) ||
      /body\s*\{[^}]*font-family\s*:\s*monospace/i.test(req.css);
    const extraText = [req.header?.default, req.header?.first, req.header?.even, req.footer?.default, req.footer?.first, req.footer?.even, ...(req.footnotes ?? []).map((f) => f.html)]
      .filter(Boolean)
      .join('\n');
    await fonts.prepare(`${req.title ?? ''}\n${htmlText}\n${cellText}\n${extraText}`, {
      monospace,
      names: fontNames(`${req.css}\n${htmlText}\n${extraText}`),
    });
    installFontSet(m, fonts);
    const meter = makeMeasure(m);
    const docs: M.Document[] = [];
    try {
      let page = req.page;
      let orientation: Orientation = page.width > page.height ? 'landscape' : 'portrait';
      const tableFont = req.tableFontSize ?? req.fontSize;
      let layouts = tables.map((t) => measureTable(t, tableFont, contentWidth(page), meter.measure));
      if (req.orientation === 'auto' && orientation === 'portrait' && layouts.some((l) => l.natural > contentWidth(page) + 1)) {
        page = rotateGeometry(page);
        orientation = 'landscape';
        layouts = tables.map((t) => measureTable(t, tableFont, contentWidth(page), meter.measure));
      }
      const renders: TableRender[] = tables.map((block, index) => ({
        index,
        block,
        widths: (layouts[index] as { widths: number[] }).widths,
        chunks: [0],
        markers: block.repeatHeader !== false && !!block.header && block.rows.length > 0,
      }));
      const renderOf = new Map(tables.map((t, i) => [t, renders[i] as TableRender]));
      const body = () =>
        wrapSymbolRuns(
          req.blocks
            .map((b) =>
              b.kind === 'html' ? b.html : b.kind === 'page-break' ? PAGE_BREAK : tableHtml(renderOf.get(b) as TableRender),
            )
            .join('\n'),
          fonts,
        );
      const html = () => documentHtml(body(), req.css, page, req.lang);
      const notes = req.footnotes ?? [];
      const noteWidth = contentWidth(page);
      const noteHeight = (pageIndex: number, onPage: Map<string, number>) => {
        const h = footnoteHtml(notes, onPage, pageIndex);
        if (!h) return 0;
        const f = layoutFragment(m, wrapSymbolRuns(h, fonts), req.css, noteWidth, req.lang);
        const height = f.height;
        f.page.destroy();
        f.doc.destroy();
        return height;
      };
      const bottomMargin = page.margin.bottom;
      if (notes.length > 0) {
        // Keep room at the bottom of every page for the footnotes of the page that needs most.
        progress?.(0.05, 1, 'Placing footnotes');
        let reserve = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          const probe = layoutDoc(m, html(), page, req.fontSize);
          const onPage = footnotePages(probe);
          const count = probe.countPages();
          probe.destroy();
          let need = 0;
          for (let p = 0; p < count; p++) need = Math.max(need, noteHeight(p, onPage));
          need = Math.min(need + FOOTNOTE_GAP, (page.height - page.margin.top - bottomMargin) * 0.5);
          if (need <= reserve + 0.5) break;
          reserve = need;
          page = { ...page, margin: { ...page.margin, bottom: bottomMargin + reserve } };
        }
      }

      const chunked = renders.filter((r) => r.markers);
      let doc: M.Document;
      if (chunked.length === 0) {
        progress?.(0.08, 1, 'Laying out pages');
        doc = layoutDoc(m, html(), page, req.fontSize);
        docs.push(doc);
      } else {
        // Header height, from a two-row sample of each table.
        let headerHeight = 0;
        for (const r of chunked) {
          const block = r.block;
          const sample: TableRender = { ...r, block: { ...block, title: undefined, rows: [block.header?.map(() => 'X') ?? ['X']] }, chunks: [0] };
          const probe = layoutDoc(m, documentHtml(tableHtml(sample), req.css, page, req.lang), page, req.fontSize, 100000);
          const first = probe.loadPage(0);
          const tops = new Map(first.getLinks().map((l) => [l.getURI(), l.getBounds()[1]]));
          first.destroy();
          probe.destroy();
          const head = tops.get(`#mmh${r.index}`);
          const row = tops.get(`#mmr${r.index}-0`);
          if (head !== undefined && row !== undefined) headerHeight = Math.max(headerHeight, row - head);
        }
        // Pass 1: lay out on pages shorter by one header row; each page's rows become one chunk.
        progress?.(0.08, 1, 'Measuring tables');
        const measureDoc = layoutDoc(m, html(), page, req.fontSize, page.height - headerHeight);
        let pages = rowPages(measureDoc, chunked);
        measureDoc.destroy();
        chunked.forEach((r, i) => (r.chunks = chunksFrom(pages[i] as Int32Array)));
        // Pass 2+: the real layout, checked; chunks that still spill are split.
        progress?.(0.3, 1, 'Laying out pages');
        doc = layoutDoc(m, html(), page, req.fontSize);
        for (let attempt = 0; attempt < 3; attempt++) {
          pages = rowPages(doc, chunked);
          let changed = false;
          chunked.forEach((r, i) => {
            const fixed = fixChunks(r.chunks, pages[i] as Int32Array);
            if (fixed) {
              r.chunks = fixed;
              changed = true;
            }
          });
          if (!changed) break;
          doc.destroy();
          doc = layoutDoc(m, html(), page, req.fontSize);
        }
        docs.push(doc);
      }
      const onPage = notes.length > 0 ? footnotePages(doc) : new Map<string, number>();
      const clusters: Clusters | undefined = needsClusters(`${htmlText}\n${cellText}\n${extraText}`) ? new Map() : undefined;
      const fragment = (dev: M.Device, body: string, x: number, y: number | null, bottom: number | null) => {
        const f = layoutFragment(m, wrapSymbolRuns(body, fonts), req.css, noteWidth, req.lang);
        const top = y ?? (bottom as number) - f.height;
        f.page.run(dev, m.Matrix.translate(x, top));
        if (clusters) collectClusters(m, f.page, clusters);
        f.page.destroy();
        f.doc.destroy();
      };
      const fill = (h: string, i: number, n: number) => h.replace(/\{\{PAGE\}\}/g, String(i + 1)).replace(/\{\{NUMPAGES\}\}/g, String(n));
      const decorate =
        req.header || req.footer || notes.length > 0
          ? (dev: M.Device, i: number, n: number, bounds: M.Rect) => {
              const head = runningFor(req.header, i);
              if (head && req.header) fragment(dev, fill(head, i, n), page.margin.left, req.header.distance, null);
              const foot = runningFor(req.footer, i);
              if (foot && req.footer) fragment(dev, fill(foot, i, n), page.margin.left, null, bounds[3] - req.footer.distance);
              const h = notes.length > 0 ? footnoteHtml(notes, onPage, i) : '';
              if (h) fragment(dev, h, page.margin.left, null, bounds[3] - bottomMargin);
            }
          : undefined;
      const { bytes, pages, bookmarks } = writePdf(m, doc, {
        decorate,
        clusters,
        pageNumbers: req.pageNumbers,
        outline: req.outline,
        title: req.title,
        author: req.author,
        lang: req.lang,
        progress,
        base: 0.55,
        marginTop: page.margin.top,
      });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      return { blob, pages, orientation, bookmarks, fonts: fonts.labels(), missing: missingList(fonts) };
    } finally {
      for (const d of docs) d.destroy();
      meter.destroy();
      installFontSet(m, null);
      fonts.destroy();
    }
  },

  /**
   * Text boxes, one per page of their own size, laid out by the HTML engine
   * (any script the fonts cover, shaped by HarfBuzz), fonts subsetted once
   * for all of them. For drawing into another PDF as forms (Edit PDF).
   */
  async textBoxes(boxes: TextBoxRequest[], css: string) {
    const m = await load();
    const allHtml = boxes.map((b) => b.html).join('\n');
    const fonts = new FontSet(m);
    await fonts.prepare(allHtml.replace(/<[^>]*>/g, ' '), { monospace: /mm-noto-sans-mono|monospace/.test(allHtml), names: fontNames(`${css}\n${allHtml}`) });
    installFontSet(m, fonts);
    const buf = new m.Buffer();
    const clusters: Clusters | undefined = needsClusters(allHtml) ? new Map() : undefined;
    try {
      const writer = new m.DocumentWriter(buf, 'pdf', '');
      for (const box of boxes) {
        const w = Math.max(4, box.width);
        const h = Math.max(4, box.height);
        const html = documentHtml(wrapSymbolRuns(box.html, fonts), css, { width: w, height: 20000, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
        const doc = m.Document.openDocument(encoder.encode(html), 'text/html');
        try {
          doc.layout(w, 20000, 12);
          const page = doc.loadPage(0);
          const dev = writer.beginPage([0, 0, w, h]);
          page.run(dev, m.Matrix.identity);
          if (clusters) collectClusters(m, page, clusters);
          writer.endPage();
          page.destroy();
        } finally {
          doc.destroy();
        }
      }
      writer.close();
      const pdf = new m.PDFDocument(buf);
      try {
        pdf.subsetFonts();
        if (clusters) fixToUnicode(pdf, clusters);
        const bytes = new Uint8Array(pdf.saveToBuffer('garbage=compact,compress,compress-fonts').asUint8Array());
        return { bytes, fonts: fonts.labels(), missing: missingList(fonts) };
      } finally {
        pdf.destroy();
      }
    } finally {
      buf.destroy();
      installFontSet(m, null);
      fonts.destroy();
    }
  },

  /** Presentations: every slide drawn at its own size, text boxes laid out one by one. */
  async slides(req: SlidesRequest, progress?: ProgressFn) {
    const m = await load();
    return renderSlides(m, req, progress);
  },

  /** EPUB, FB2, MOBI, XHTML: MuPDF parses and lays out the book itself. */
  async reflow(file: Blob, req: ReflowRequest, progress?: ProgressFn) {
    const m = await load();
    const bytes = new Uint8Array(await file.arrayBuffer());
    progress?.(0.02, 1, 'Reading the book');
    // Text for choosing fonts: the (X)HTML inside the ZIP, or the file itself.
    let text = '';
    let names: string[] = [];
    let monospace = false;
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(bytes, { filter: (f) => /\.(x?html?|xml|ncx|opf|css)$/i.test(f.name) });
      } catch {
        throw new Error('This file is not a valid EPUB (the ZIP container is damaged).');
      }
      const decoder = new TextDecoder();
      for (const [name, data] of Object.entries(entries)) {
        const s = decoder.decode(data);
        if (/\.css$/i.test(name)) {
          names = names.concat(fontNames(s));
          monospace ||= /monospace/i.test(s);
        } else {
          monospace ||= /<(pre|code|kbd|samp|tt)\b/i.test(s);
          text += s.replace(/<[^>]*>/g, ' ');
        }
      }
    } else {
      text = new TextDecoder().decode(bytes);
      monospace = /<(pre|code|kbd|samp|tt)\b/i.test(text);
    }
    const fonts = new FontSet(m);
    await fonts.prepare(text, { monospace, names });
    installFontSet(m, fonts);
    const g = req.page;
    const userCss = `@page{margin:${g.margin.top}pt ${g.margin.right}pt ${g.margin.bottom}pt ${g.margin.left}pt}${req.css ?? ''}`;
    let doc: M.Document | null = null;
    try {
      try {
        doc = m.Document.openDocument(bytes, req.magic);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/drm/i.test(msg)) throw new Error('This e-book is protected with DRM and cannot be converted.');
        throw new Error(`This file could not be read (${msg}).`);
      }
      if (doc.needsPassword()) throw new Error('This e-book is protected with DRM and cannot be converted.');
      doc.style(true, userCss);
      progress?.(0.08, 1, 'Laying out pages');
      doc.layout(g.width, g.height, req.fontSize);
      if (doc.countPages() === 0) throw new Error('This book has no readable content.');
      const title = doc.getMetaData('info:Title') || undefined;
      const author = doc.getMetaData('info:Author') || undefined;
      const out = writePdf(m, doc, {
        pageNumbers: req.pageNumbers,
        outline: req.outline,
        title,
        author,
        progress,
        base: 0.4,
        marginTop: g.margin.top,
        clusters: needsClusters(text) ? new Map() : undefined,
      });
      return {
        blob: new Blob([out.bytes], { type: 'application/pdf' }),
        pages: out.pages,
        orientation: (g.width > g.height ? 'landscape' : 'portrait') as Orientation,
        bookmarks: out.bookmarks,
        fonts: fonts.labels(),
        missing: missingList(fonts),
        title,
      };
    } finally {
      doc?.destroy();
      installFontSet(m, null);
      fonts.destroy();
    }
  },
};

export type TypesetWorkerApi = typeof api;

expose(api);

