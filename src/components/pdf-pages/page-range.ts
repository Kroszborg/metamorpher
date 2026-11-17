/**
 * Page-range text ↔ page indices. Text is 1-based, as people type it
 * ("1-3, 8, 12-"); everything returned is 0-based.
 *
 * Accepted pieces, separated by commas, semicolons or spaces:
 *   7        one page
 *   2-5      a range (5-2 is the same range, backwards)
 *   9-       page 9 to the end          -4    pages 1 to 4
 *   last     the last page (also in ranges: 3-last)
 *   all, odd, even
 *
 * This module has no imports so it runs under `node --test` as is.
 */

/** A run of pages, 0-based and inclusive. `start > end` means backwards. */
export type PageRange = { start: number; end: number };

export type ParsedPageRanges = {
  /** One entry per piece of text, in the order written. */
  ranges: PageRange[];
  /** A human-readable problem with the text, or null. */
  error: string | null;
};

const DASHES = /[‐-―−]/g;

function pageNumber(token: string, total: number): number | string {
  const t = token.toLowerCase();
  if (t === 'last' || t === 'end' || t === 'z') return total;
  if (!/^\d+$/.test(t)) return `"${token}" is not a page number.`;
  const n = Number(t);
  if (n < 1) return 'Pages start at 1.';
  if (n > total) return `Page ${n} does not exist; the PDF has ${total} ${total === 1 ? 'page' : 'pages'}.`;
  return n;
}

export function parsePageRanges(text: string, total: number): ParsedPageRanges {
  const ranges: PageRange[] = [];
  const cleaned = text.replace(DASHES, '-').replace(/\s*-\s*/g, '-').trim();
  if (cleaned === '') return { ranges, error: null };
  if (total < 1) return { ranges, error: 'The PDF has no pages.' };

  for (const piece of cleaned.split(/[,;\s]+/)) {
    if (piece === '') continue;
    const word = piece.toLowerCase();
    if (word === 'all') {
      ranges.push({ start: 0, end: total - 1 });
      continue;
    }
    if (word === 'odd' || word === 'even') {
      for (let p = word === 'odd' ? 0 : 1; p < total; p += 2) ranges.push({ start: p, end: p });
      continue;
    }
    const parts = piece.split('-');
    if (parts.length > 2) return { ranges: [], error: `"${piece}" is not a valid range.` };
    if (parts.length === 1) {
      const n = pageNumber(piece, total);
      if (typeof n === 'string') return { ranges: [], error: n };
      ranges.push({ start: n - 1, end: n - 1 });
      continue;
    }
    const [a = '', b = ''] = parts;
    if (a === '' && b === '') return { ranges: [], error: `"${piece}" is not a valid range.` };
    const from = a === '' ? 1 : pageNumber(a, total);
    if (typeof from === 'string') return { ranges: [], error: from };
    const to = b === '' ? total : pageNumber(b, total);
    if (typeof to === 'string') return { ranges: [], error: to };
    ranges.push({ start: from - 1, end: to - 1 });
  }
  return { ranges, error: null };
}

/** Every page of `ranges`, in order (backwards ranges count down; repeats are kept). */
export function rangesToIndices(ranges: readonly PageRange[]): number[] {
  const out: number[] = [];
  for (const { start, end } of ranges) {
    const step = start <= end ? 1 : -1;
    for (let p = start; step > 0 ? p <= end : p >= end; p += step) out.push(p);
  }
  return out;
}

/** The set of pages the text names, or the error. */
export function parsePageSelection(text: string, total: number): { pages: Set<number>; error: string | null } {
  const { ranges, error } = parsePageRanges(text, total);
  return { pages: new Set(rangesToIndices(ranges)), error };
}

/** Consecutive runs of the sorted, unique indices. */
export function toRuns(indices: Iterable<number>): PageRange[] {
  const sorted = [...new Set(indices)].filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => a - b);
  const runs: PageRange[] = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last.end + 1) last.end = n;
    else runs.push({ start: n, end: n });
  }
  return runs;
}

/** "1-3, 8, 12-20" for 0-based indices (sorted, de-duplicated). */
export function formatPageRanges(indices: Iterable<number>): string {
  return toRuns(indices)
    .map(({ start, end }) => (start === end ? `${start + 1}` : `${start + 1}-${end + 1}`))
    .join(', ');
}

/**
 * A file-name fragment for a set of pages: "page-5", "pages-1-3", "pages-1-3_8".
 * Long selections are summarised ("12-pages") so names stay readable.
 */
export function pagesLabel(indices: Iterable<number>, maxLength = 40): string {
  const runs = toRuns(indices);
  const count = runs.reduce((sum, r) => sum + r.end - r.start + 1, 0);
  if (count === 0) return 'no-pages';
  if (count === 1 && runs[0]) return `page-${runs[0].start + 1}`;
  const body = runs.map(({ start, end }) => (start === end ? `${start + 1}` : `${start + 1}-${end + 1}`)).join('_');
  return body.length + 6 <= maxLength ? `pages-${body}` : `${count}-pages`;
}

/** Splits `total` pages into consecutive groups of `size` (the last may be shorter). */
export function chunkPages(total: number, size: number): PageRange[] {
  const n = Math.max(1, Math.floor(size));
  const out: PageRange[] = [];
  for (let s = 0; s < total; s += n) out.push({ start: s, end: Math.min(total, s + n) - 1 });
  return out;
}
