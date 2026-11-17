// Text extraction: plain text, layout-preserving text and positioned lines,
// built on MuPDF's structured text.
import type * as M from 'mupdf';
import type { Box, PageText, QuadPoints, SearchHit, TextBlock, TextMode } from '../types';
import type { Doc, Mupdf } from './common';

type JsonBox = { x: number; y: number; w: number; h: number };
type JsonLine = { bbox: JsonBox; font?: { name?: string; size?: number }; x: number; y: number; text: string; wmode?: number };
type JsonBlock = { type: string; bbox: JsonBox; lines?: JsonLine[] };

const toBox = (b: JsonBox): Box => [b.x, b.y, b.x + b.w, b.y + b.h];

export const STEXT_OPTIONS = 'preserve-whitespace,clip';

/** Positioned lines of one page (MuPDF page space: points, top-left origin). */
export function pageText(page: M.Page, index: number): PageText {
  const [x0, y0, x1, y1] = page.getBounds();
  const stext = page.toStructuredText(STEXT_OPTIONS);
  try {
    const json = JSON.parse(stext.asJSON()) as { blocks?: JsonBlock[] };
    const blocks: TextBlock[] = [];
    for (const b of json.blocks ?? []) {
      if (b.type !== 'text' || !b.lines) continue;
      blocks.push({
        bbox: toBox(b.bbox),
        lines: b.lines.map((l) => ({
          text: l.text,
          bbox: toBox(l.bbox),
          fontSize: l.font?.size ?? Math.max(1, l.bbox.h),
          font: l.font?.name ?? '',
        })),
      });
    }
    return { index, width: x1 - x0, height: y1 - y0, blocks };
  } finally {
    stext.destroy();
  }
}

function plainText(page: M.Page): string {
  const stext = page.toStructuredText(STEXT_OPTIONS);
  try {
    return stext.asText();
  } finally {
    stext.destroy();
  }
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? fallback;
}

/**
 * Lays lines out on a character grid, like `pdftotext -layout`: columns from
 * x positions (median character width), rows from baselines, so tables and
 * multi-column pages keep their shape in a monospaced viewer.
 */
export function layoutText(text: PageText): string {
  const lines = text.blocks.flatMap((b) => b.lines).filter((l) => l.text.trim().length > 0);
  if (lines.length === 0) return '';
  const charWidth = Math.max(
    1,
    median(
      lines.map((l) => (l.bbox[2] - l.bbox[0]) / Math.max(1, l.text.length)),
      5,
    ),
  );
  const lineHeight = Math.max(1, median(lines.map((l) => l.bbox[3] - l.bbox[1]), 12));
  const left = Math.min(...lines.map((l) => l.bbox[0]));

  // Group lines whose vertical centres are within half a line into one row.
  const sorted = [...lines].sort((a, b) => (a.bbox[1] + a.bbox[3]) / 2 - (b.bbox[1] + b.bbox[3]) / 2);
  const rows: { y: number; items: typeof lines }[] = [];
  for (const line of sorted) {
    const y = (line.bbox[1] + line.bbox[3]) / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - y) < lineHeight * 0.5) row.items.push(line);
    else rows.push({ y, items: [line] });
  }

  // The usual distance between consecutive rows (line pitch), so only gaps
  // clearly larger than normal line spacing become blank lines.
  const steps = rows.slice(1).map((row, i) => row.y - (rows[i]?.y ?? row.y)).filter((d) => d > lineHeight * 0.5);
  const pitch = Math.max(lineHeight, median(steps, lineHeight * 1.2));

  const out: string[] = [];
  let lastY: number | null = null;
  for (const row of rows) {
    if (lastY !== null) {
      // Keep visible vertical gaps (paragraph spacing), capped at two blank lines.
      const gap = Math.round((row.y - lastY) / pitch - 0.25) - 1;
      for (let i = 0; i < Math.min(2, Math.max(0, gap)); i += 1) out.push('');
    }
    lastY = row.y;
    let s = '';
    for (const item of row.items.sort((a, b) => a.bbox[0] - b.bbox[0])) {
      const col = Math.round((item.bbox[0] - left) / charWidth);
      if (s.length < col) s += ' '.repeat(col - s.length);
      else if (s.length > 0 && !s.endsWith(' ')) s += ' ';
      s += item.text;
    }
    out.push(s.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

/** Text of each page, in order. */
export function extractText(doc: Doc, mode: TextMode, progress?: (done: number, total: number) => void): string[] {
  const total = doc.countPages();
  const pages: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const page = doc.loadPage(i);
    try {
      pages.push(mode === 'layout' ? layoutText(pageText(page, i)) : plainText(page).replace(/\s+$/, ''));
    } catch {
      pages.push('');
    } finally {
      page.destroy();
    }
    progress?.(i + 1, total);
  }
  return pages;
}

/** Every occurrence of `needle` (case-insensitive, as MuPDF searches), page by page. */
export function searchText(_m: Mupdf, doc: Doc, needle: string, pages?: number[]): SearchHit[] {
  const hits: SearchHit[] = [];
  const list = pages ?? Array.from({ length: doc.countPages() }, (_, i) => i);
  for (const i of list) {
    const page = doc.loadPage(i);
    try {
      for (const quads of page.search(needle, undefined)) {
        hits.push({ page: i, quads: quads.map((q) => [...q] as QuadPoints), text: needle });
      }
    } finally {
      page.destroy();
    }
  }
  return hits;
}
