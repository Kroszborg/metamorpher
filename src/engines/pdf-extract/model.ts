/**
 * Rebuilds a flowing document from positioned PDF text: paragraphs from
 * lines, headings from font sizes (and bold lines), alignment and indents,
 * list items, images in reading order, running headers, footers and page
 * numbers removed. Pure functions: runs anywhere.
 */
import { findTables, readingOrder, type TableCell } from './layout';
import type { ImageBlock, Line, RawPage, Rect, Span, TextBlock } from './types';

export type RunStyle = { bold: boolean; italic: boolean; mono: boolean; size: number; color: string; font: string; link?: string };
export type Run = RunStyle & { text: string };
export type Para = {
  kind: 'para';
  /** 0 = body text, 1–4 = heading level. */
  level: number;
  runs: Run[];
  align: 'left' | 'center' | 'right' | 'justify';
  /** Left indent in points, from the text margin. */
  indent: number;
  size: number;
  list: boolean;
  /** Page index the paragraph came from. */
  page: number;
};
export type DocImage = { kind: 'image'; bytes: Uint8Array<ArrayBuffer>; mime: 'image/png' | 'image/jpeg'; width: number; height: number; page: number };
/** A table found on a page (ruled grid or aligned columns); `header`: the first row is a header row. */
export type DocTable = { kind: 'table'; rows: TableCell[][]; header: boolean; columns: number; page: number };
export type DocBlock = Para | DocImage | DocTable | { kind: 'page-break' };

export type DocModel = {
  blocks: DocBlock[];
  bodySize: number;
  bodyFont: string;
  page: { width: number; height: number; margin: { top: number; right: number; bottom: number; left: number } };
  title?: string;
  author?: string;
  pages: number;
  chars: number;
  images: number;
  /** Pages with images but no text: probably scans that need OCR. */
  scannedPages: number;
  tables: number;
  /** Pages read column by column. */
  columnPages: number;
};

const BULLET = /^\s*([•●○◦▪■□‣⁃–—\-*·]|\(?\d{1,3}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])\s+/;
const CJK = /[　-鿿가-힯＀-￯]/;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

function lineText(l: Line): string {
  return l.spans.map((s) => s.text).join('');
}

function blockText(b: TextBlock): string {
  return b.lines.map(lineText).join(' ');
}

function chars(spans: readonly Span[]): number {
  return spans.reduce((n, s) => n + s.text.trim().length, 0);
}

/** The size (or font) that most characters use. */
function mode<T>(entries: Iterable<[T, number]>, fallback: T): T {
  const counts = new Map<T, number>();
  for (const [k, n] of entries) counts.set(k, (counts.get(k) ?? 0) + n);
  let best = fallback;
  let max = -1;
  for (const [k, n] of counts) if (n > max) {
    best = k;
    max = n;
  }
  return best;
}

function percentile(values: number[], p: number, fallback: number): number {
  if (!values.length) return fallback;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] as number;
}

/** Text of a block with digits blurred, to spot running headers and page numbers. */
function signature(text: string): string {
  return text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isRunningBlock(b: TextBlock, page: RawPage): boolean {
  const band = page.height * 0.08;
  return b.bbox[3] < band || b.bbox[1] > page.height - band;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.mono === b.mono && Math.abs(a.size - b.size) < 0.6 && a.color === b.color && a.font === b.font && a.link === b.link;
}

function pushRun(runs: Run[], run: Run): void {
  const last = runs[runs.length - 1];
  if (last && sameStyle(last, run)) last.text += run.text;
  else runs.push({ ...run });
}

export function buildDocument(
  raw: { pages: RawPage[]; title?: string; author?: string },
  opts: {
    dropRunning: boolean;
    pageBreaks: boolean;
    /** Find tables (ruled and aligned) and emit them as table blocks. */
    tables?: boolean;
    /** Read multi-column pages column by column. */
    columns?: boolean;
  },
): DocModel {
  const { pages } = raw;
  // Body text: the most common size and font.
  const allSpans = pages.flatMap((p) => p.blocks.flatMap((b) => (b.kind === 'text' ? b.lines.flatMap((l) => l.spans) : [])));
  const bodySize = mode(allSpans.map((s): [number, number] => [Math.round(s.size * 2) / 2, s.text.length]), 11);
  const bodyFont = mode(allSpans.map((s): [string, number] => [s.font, s.text.length]), 'Helvetica');
  const totalChars = chars(allSpans);

  // Running headers/footers: the same text (digits aside) in the top or bottom band of many pages.
  const running = new Set<string>();
  if (opts.dropRunning && pages.length >= 2) {
    const seen = new Map<string, Set<number>>();
    pages.forEach((p, i) => {
      for (const b of p.blocks) {
        if (b.kind !== 'text' || !isRunningBlock(b, p)) continue;
        const sig = signature(blockText(b));
        if (!sig) continue;
        const set = seen.get(sig) ?? new Set<number>();
        set.add(i);
        seen.set(sig, set);
      }
    });
    const need = Math.max(2, Math.ceil(pages.length * 0.4));
    for (const [sig, set] of seen) if (set.size >= need || /^(page\s*)?#(\s*(of|\/)\s*#)?$/.test(sig)) running.add(sig);
  }

  // Text margins.
  const lefts: number[] = [];
  const rights: number[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (const p of pages) for (const b of p.blocks) if (b.kind === 'text') {
    lefts.push(b.bbox[0]);
    rights.push(p.width - b.bbox[2]);
    tops.push(b.bbox[1]);
    bottoms.push(p.height - b.bbox[3]);
  }
  const first = pages[0] ?? { width: 612, height: 792 };
  const margin = {
    left: Math.max(18, Math.min(108, percentile(lefts, 0.1, 72))),
    right: Math.max(18, Math.min(108, percentile(rights, 0.1, 72))),
    top: Math.max(18, Math.min(108, percentile(tops, 0.1, 72))),
    bottom: Math.max(18, Math.min(108, percentile(bottoms, 0.1, 72))),
  };

  const blocks: DocBlock[] = [];
  let images = 0;
  let scannedPages = 0;
  let tableCount = 0;
  let columnPages = 0;
  pages.forEach((page, pi) => {
    if (pi > 0 && opts.pageBreaks) blocks.push({ kind: 'page-break' });
    const textChars = page.blocks.reduce((n, b) => n + (b.kind === 'text' ? b.lines.reduce((k, l) => k + chars(l.spans), 0) : 0), 0);
    if (textChars === 0 && page.blocks.some((b) => b.kind === 'image')) scannedPages += 1;
    const area = { x0: margin.left, x1: page.width - margin.right };
    // Tables: their text leaves the flow and comes back as one table block.
    const tables = opts.tables && page.words?.length ? findTables(page.words, page.rules ?? [], page.width) : [];
    const inTable = (r: Rect) => tables.some((t) => {
      const cx = (r[0] + r[2]) / 2;
      const cy = (r[1] + r[3]) / 2;
      return cx >= t.bbox[0] - 2 && cx <= t.bbox[2] + 2 && cy >= t.bbox[1] - 2 && cy <= t.bbox[3] + 2;
    });
    type Item = { bbox: Rect; chars: number; block?: TextBlock | ImageBlock; table?: (typeof tables)[number] };
    const items: Item[] = [];
    const pageBlocks = opts.columns ? page.blocks.flatMap((b): (TextBlock | ImageBlock)[] => (b.kind === 'text' ? splitColumns(b) : [b])) : page.blocks;
    const splitPage = pageBlocks.length !== page.blocks.length;
    for (const b of pageBlocks) {
      if (b.kind === 'text' && tables.length) {
        const lines = b.lines.filter((l) => !inTable(l.bbox));
        if (lines.length === 0) continue;
        if (lines.length !== b.lines.length) {
          const bbox: Rect = [Math.min(...lines.map((l) => l.bbox[0])), Math.min(...lines.map((l) => l.bbox[1])), Math.max(...lines.map((l) => l.bbox[2])), Math.max(...lines.map((l) => l.bbox[3]))];
          const kept: TextBlock = { kind: 'text', bbox, lines };
          items.push({ bbox, chars: lines.reduce((n, l) => n + chars(l.spans), 0), block: kept });
          continue;
        }
      }
      items.push({ bbox: b.bbox, chars: b.kind === 'text' ? b.lines.reduce((n, l) => n + chars(l.spans), 0) : 0, block: b });
    }
    for (const t of tables) {
      // In the flow before the first item that starts below the table's top.
      const at = items.findIndex((it) => it.bbox[1] >= t.bbox[1] - 1);
      items.splice(at < 0 ? items.length : at, 0, { bbox: t.bbox, chars: t.rows.flat().reduce((n, c) => n + c.text.length, 0), table: t });
    }
    let order = items.map((_, i) => i);
    if (opts.columns) {
      order = readingOrder(items, page.width);
      if (splitPage || order.some((v, i) => v !== i)) columnPages += 1;
    }
    for (const index of order) {
      const item = items[index] as Item;
      if (item.table) {
        blocks.push({ kind: 'table', rows: item.table.rows, header: item.table.header, columns: item.table.columns, page: pi });
        tableCount += 1;
        continue;
      }
      const b = item.block as TextBlock | ImageBlock;
      if (b.kind === 'image') {
        const w = b.bbox[2] - b.bbox[0];
        const h = b.bbox[3] - b.bbox[1];
        if (w < 8 || h < 8) continue;
        blocks.push(imageBlock(b, pi));
        images += 1;
        continue;
      }
      if (running.has(signature(blockText(b))) && isRunningBlock(b, page)) continue;
      for (const para of paragraphs(b, page, area, bodySize, pi)) blocks.push(para);
    }
  });

  // Headings: distinct larger sizes rank 1, 2, 3 …; short bold body-size lines come next.
  const paras = blocks.filter((b): b is Para => b.kind === 'para');
  const headingSizes = [...new Set(paras.filter((p) => isHeadingCandidate(p) && p.size >= bodySize * 1.18).map((p) => Math.round(p.size)))].sort((a, b) => b - a).slice(0, 3);
  for (const p of paras) {
    if (!isHeadingCandidate(p)) continue;
    const rank = headingSizes.indexOf(Math.round(p.size));
    if (p.size >= bodySize * 1.18 && rank >= 0) p.level = rank + 1;
    else if (p.runs.every((r) => r.bold || !r.text.trim()) && p.size >= bodySize * 0.95 && plain(p).length <= 80 && !/[.,;:]$/.test(plain(p).trim()) && !p.list) {
      p.level = Math.min(4, headingSizes.length + 1);
    }
  }

  return {
    blocks,
    bodySize,
    bodyFont,
    page: { width: first.width, height: first.height, margin },
    title: raw.title,
    author: raw.author,
    pages: pages.length,
    chars: totalChars,
    images,
    scannedPages,
    tables: tableCount,
    columnPages,
  };
}

/**
 * A text block whose lines sit in two or more separate x-ranges (columns
 * that MuPDF read line by line across the page): one block per column.
 */
function splitColumns(b: TextBlock): TextBlock[] {
  if (b.lines.length < 6) return [b];
  const spans = b.lines.map((l): [number, number] => [l.bbox[0], l.bbox[2]]).sort((a, c) => a[0] - c[0]);
  const cuts: number[] = [];
  let reach = spans[0]?.[1] ?? 0;
  for (const [a, e] of spans) {
    if (a - reach >= 12) cuts.push((a + reach) / 2);
    reach = Math.max(reach, e);
  }
  if (cuts.length === 0) return [b];
  const groups = new Map<number, Line[]>();
  for (const l of b.lines) {
    const k = cuts.filter((x) => (l.bbox[0] + l.bbox[2]) / 2 > x).length;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const parts = [...groups.entries()].sort((a, c) => a[0] - c[0]).map(([, lines]) => lines);
  // Real columns of prose: several lines each, of some length (not a label/value list).
  const prose = parts.every((lines) => lines.length >= 3 && lines.reduce((n, l) => n + lineText(l).trim().length, 0) / lines.length > 25);
  if (!prose) return [b];
  return parts.map((lines): TextBlock => ({
    kind: 'text',
    lines,
    bbox: [Math.min(...lines.map((l) => l.bbox[0])), Math.min(...lines.map((l) => l.bbox[1])), Math.max(...lines.map((l) => l.bbox[2])), Math.max(...lines.map((l) => l.bbox[3]))],
  }));
}

function plain(p: Para): string {
  return p.runs.map((r) => r.text).join('');
}

function isHeadingCandidate(p: Para): boolean {
  const t = plain(p).trim();
  return t.length > 0 && t.length <= 160 && !p.list && /\p{L}/u.test(t);
}

function imageBlock(b: ImageBlock, page: number): DocImage {
  return { kind: 'image', bytes: b.bytes, mime: b.mime, width: b.bbox[2] - b.bbox[0], height: b.bbox[3] - b.bbox[1], page };
}

/** Splits a MuPDF text block into paragraphs and builds their runs. */
function paragraphs(b: TextBlock, page: RawPage, area: { x0: number; x1: number }, bodySize: number, pi: number): Para[] {
  const out: Para[] = [];
  const width = b.bbox[2] - b.bbox[0];
  let current: Line[] = [];
  const flush = () => {
    if (current.length) out.push(makePara(current, page, area, pi));
    current = [];
  };
  b.lines.forEach((line, i) => {
    const prev = b.lines[i - 1];
    if (prev) {
      const prevText = lineText(prev).trim();
      const prevWidth = prev.bbox[2] - prev.bbox[0];
      const gap = line.bbox[1] - prev.bbox[3];
      const lineH = prev.bbox[3] - prev.bbox[1];
      const short = prevWidth < width * 0.72 && /[.!?:;"”’)\]]$/.test(prevText);
      const bigGap = gap > lineH * 0.9;
      const bullet = BULLET.test(lineText(line));
      const styleChange = Math.abs(dominantSize(line) - dominantSize(prev)) > bodySize * 0.15;
      if (short || bigGap || bullet || styleChange) flush();
    }
    current.push(line);
  });
  flush();
  return out;
}

function dominantSize(l: Line): number {
  return mode(l.spans.map((s): [number, number] => [s.size, s.text.length]), 10);
}

function makePara(lines: Line[], page: RawPage, area: { x0: number; x1: number }, pi: number): Para {
  const runs: Run[] = [];
  lines.forEach((line, i) => {
    if (i > 0) {
      const last = runs[runs.length - 1];
      const next = line.spans[0]?.text ?? '';
      if (last) {
        const trimmed = last.text.replace(/\s+$/, '');
        if (/\p{L}-$/u.test(trimmed) && /^\p{Ll}/u.test(next)) last.text = trimmed.slice(0, -1);
        else if (CJK.test(trimmed.slice(-1)) && CJK.test(next.slice(0, 1))) last.text = trimmed;
        else last.text = `${trimmed} `;
      }
    }
    line.spans.forEach((s, k) => {
      const text = k === 0 ? s.text.replace(/^\s+/, '') : s.text;
      if (!text) return;
      const link = linkFor(s.bbox ?? line.bbox, page) ?? (URL_RE.test(text.trim()) ? text.trim() : undefined);
      pushRun(runs, { text, bold: s.bold, italic: s.italic, mono: s.mono, size: s.size, color: s.color, font: s.font, link });
    });
  });
  const lastRun = runs[runs.length - 1];
  if (lastRun) lastRun.text = lastRun.text.replace(/\s+$/, '');
  const size = mode(runs.map((r): [number, number] => [r.size, r.text.length]), 10);
  const x0 = Math.min(...lines.map((l) => l.bbox[0]));
  const x1 = Math.max(...lines.map((l) => l.bbox[2]));
  const areaW = area.x1 - area.x0;
  const centred = lines.every((l) => Math.abs((l.bbox[0] + l.bbox[2]) / 2 - (area.x0 + area.x1) / 2) < areaW * 0.04) && x1 - x0 < areaW * 0.85;
  const rightAligned = !centred && lines.every((l) => Math.abs(l.bbox[2] - area.x1) < 6) && x0 - area.x0 > areaW * 0.3;
  const justified = lines.length > 2 && lines.slice(0, -1).every((l) => Math.abs(l.bbox[2] - x1) < 3 && Math.abs(l.bbox[0] - x0) < 3);
  const text = runs.map((r) => r.text).join('');
  return {
    kind: 'para',
    level: 0,
    runs,
    align: centred ? 'center' : rightAligned ? 'right' : justified ? 'justify' : 'left',
    indent: centred || rightAligned ? 0 : Math.max(0, Math.round(x0 - area.x0)),
    size,
    list: BULLET.test(text),
    page: pi,
  };
}

/** The external link that covers most of a span. */
function linkFor(box: Rect, page: RawPage): string | undefined {
  for (const l of page.links) {
    const overlap = Math.min(l.bbox[2], box[2]) - Math.max(l.bbox[0], box[0]);
    const vert = Math.min(l.bbox[3], box[3]) - Math.max(l.bbox[1], box[1]);
    if (overlap > (box[2] - box[0]) * 0.6 && vert > 0) return l.uri;
  }
  return undefined;
}

export type { Rect };
