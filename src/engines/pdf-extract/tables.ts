/**
 * Table detection from word positions: rows from baselines, cells from wide
 * gaps, columns from the vertical "rivers" of white space that run through
 * the rows with several cells. Works for text PDFs with aligned columns;
 * cells that wrap onto several lines are merged back into one cell.
 */
import { mergeWrappedRows, ruledTables } from './layout';
import type { Word, WordPage } from './types';

export type CellValue = string | number;
export type PageTable = { rows: CellValue[][]; columns: number; tabularRows: number };

type Cell = { text: string; x0: number; x1: number };

function rowsOf(words: Word[]): Word[][] {
  const sorted = [...words].sort((a, b) => (a.bbox[1] + a.bbox[3]) / 2 - (b.bbox[1] + b.bbox[3]) / 2 || a.bbox[0] - b.bbox[0]);
  const rows: { center: number; height: number; words: Word[] }[] = [];
  for (const w of sorted) {
    const c = (w.bbox[1] + w.bbox[3]) / 2;
    const h = w.bbox[3] - w.bbox[1];
    const row = rows[rows.length - 1];
    if (row && Math.abs(c - row.center) < Math.max(2, Math.min(h, row.height) * 0.5)) {
      row.words.push(w);
      row.center = (row.center * (row.words.length - 1) + c) / row.words.length;
    } else rows.push({ center: c, height: h, words: [w] });
  }
  return rows.map((r) => r.words.sort((a, b) => a.bbox[0] - b.bbox[0]));
}

function cellsOf(row: Word[]): Cell[] {
  const cells: Cell[] = [];
  for (const w of row) {
    const last = cells[cells.length - 1];
    const gap = last ? w.bbox[0] - last.x1 : Infinity;
    if (last && gap < Math.max(3, w.size * 0.9)) {
      last.text += ` ${w.text}`;
      last.x1 = Math.max(last.x1, w.bbox[2]);
    } else cells.push({ text: w.text, x0: w.bbox[0], x1: w.bbox[2] });
  }
  return cells;
}

/** "1,234.56", "(12)", "-3.5%", "$1,000", "1.234,56" → numbers; anything else stays text. */
export function parseNumber(text: string): number | null {
  let t = text.trim().replace(/[−–]/g, '-');
  if (!/\d/.test(t) || t.length > 30) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/^[$€£¥₹]\s?|\s?[$€£¥₹]$/g, '');
  const percent = t.endsWith('%');
  if (percent) t = t.slice(0, -1).trim();
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^[-+]?\d+,\d+$/.test(t) && !/^[-+]?\d{1,3},\d{3}$/.test(t)) t = t.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  // Leading zeros (ZIP codes, IDs) stay text.
  if (/^[-+]?0\d/.test(t)) return null;
  let n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (percent) n /= 100;
  return negative ? -n : n;
}

const PAGE_NUMBER = /^(page\s*)?\d+(\s*(\/|of)\s*\d+)?$/i;

export function detectTable(page: WordPage, { numbers }: { numbers: boolean }): PageTable {
  // Page numbers in the top or bottom band are not table content.
  const band = page.height * 0.06;
  // Ruled tables: their grid gives the cells (wrapped text stays in its cell); the rest by alignment.
  const ruled = page.rules?.length ? ruledTables(page.rules, page.words) : [];
  const inRuled = (w: Word) => ruled.some((t) => {
    const cx = (w.bbox[0] + w.bbox[2]) / 2;
    const cy = (w.bbox[1] + w.bbox[3]) / 2;
    return cx >= t.bbox[0] - 2 && cx <= t.bbox[2] + 2 && cy >= t.bbox[1] - 2 && cy <= t.bbox[3] + 2;
  });
  const free = ruled.length ? page.words.filter((w) => !inRuled(w)) : page.words;
  const kept = rowsOf(free).filter((r) => {
    const top = Math.min(...r.map((w) => w.bbox[1]));
    const bottom = Math.max(...r.map((w) => w.bbox[3]));
    const inBand = bottom < band || top > page.height - band;
    return !(inBand && PAGE_NUMBER.test(r.map((w) => w.text).join(' ')));
  });
  const rows = kept.map(cellsOf);
  const maxCell = page.width * 0.45;
  // Columns: merge the x-ranges of cells in rows that have several cells.
  const tabular = rows.filter((r) => r.length >= 2);
  const spans = tabular.flatMap((r) => r.filter((c) => c.x1 - c.x0 < maxCell).map((c): [number, number] => [c.x0, c.x1]));
  spans.sort((a, b) => a[0] - b[0]);
  const columns: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = columns[columns.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else columns.push([a, b]);
  }
  if (columns.length === 0) columns.push([0, page.width]);
  const colOf = (c: Cell): number => {
    let best = 0;
    let bestOverlap = -Infinity;
    columns.forEach(([a, b], i) => {
      const overlap = Math.min(b, c.x1) - Math.max(a, c.x0);
      const score = overlap > 0 ? overlap : -Math.min(Math.abs(c.x0 - a), Math.abs(c.x1 - b));
      if (score > bestOverlap) {
        bestOverlap = score;
        best = i;
      }
    });
    return best;
  };
  const texts: string[][] = rows.map((r) => {
    const values: string[] = new Array<string>(columns.length).fill('');
    if (r.length === 1 && (r[0] as Cell).x1 - (r[0] as Cell).x0 >= maxCell) {
      values[colOf(r[0] as Cell)] = (r[0] as Cell).text;
    } else {
      for (const c of r) {
        const i = colOf(c);
        values[i] = values[i] ? `${values[i]} ${c.text}` : c.text;
      }
    }
    return values;
  });
  // Cells that wrap onto several lines: merged back into their row.
  const merged = mergeWrappedRows(
    texts.map((values, i) => {
      const r = kept[i] as Word[];
      const top = Math.min(...r.map((w) => w.bbox[1]));
      const bottom = Math.max(...r.map((w) => w.bbox[3]));
      return { y: (top + bottom) / 2, top, bottom, bold: r.every((w) => w.bold), cells: values.map((text) => ({ text })) };
    }),
    (a, b) => ({ text: `${a.text} ${b.text}`.trim() }),
  );
  // Rows of the ruled tables, in page order with the rest (a merged cell fills its first column).
  const entries: { y: number; cells: string[] }[] = merged.map((r) => ({ y: r.top, cells: r.cells.map((c) => c.text) }));
  for (const t of ruled) {
    t.rows.forEach((row, k) => {
      const cells: string[] = [];
      for (const c of row) cells.push(c.text, ...new Array<string>(Math.max(0, c.colSpan - 1)).fill(''));
      entries.push({ y: t.bbox[1] + k * 0.001, cells });
    });
  }
  entries.sort((a, b) => a.y - b.y);
  const widest = Math.max(columns.length, ...entries.map((e) => e.cells.length));
  const out: CellValue[][] = entries.map((e) =>
    Array.from({ length: widest }, (_, i) => e.cells[i] ?? '').map((v) => {
      if (!numbers) return v;
      const n = parseNumber(v);
      return n === null ? v : n;
    }),
  );
  // Trim empty trailing columns.
  let width = widest;
  while (width > 1 && out.every((r) => r[width - 1] === '')) width -= 1;
  return { rows: out.map((r) => r.slice(0, width)), columns: width, tabularRows: tabular.length + ruled.reduce((n, t) => n + t.rows.length, 0) };
}
