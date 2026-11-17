/**
 * Page layout for reflowing PDFs: tables (ruled grids, and columns of
 * aligned text separated by white space) and the reading order of
 * multi-column pages. Pure functions on what the extraction worker reads.
 */
import type { Rect, Word } from './types';

export type TableCell = { text: string; colSpan: number; bold: boolean };
export type FoundTable = { bbox: Rect; rows: TableCell[][]; header: boolean; ruled: boolean; columns: number };

type HLine = { y: number; x0: number; x1: number };
type VLine = { x: number; y0: number; y1: number };

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function mergeH(lines: HLine[]): HLine[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out: HLine[] = [];
  for (const l of sorted) {
    const last = out.findLast((o) => near(o.y, l.y, 1.5) && l.x0 <= o.x1 + 3);
    if (last) {
      last.x1 = Math.max(last.x1, l.x1);
      last.x0 = Math.min(last.x0, l.x0);
    } else out.push({ ...l });
  }
  return out;
}

function mergeV(lines: VLine[]): VLine[] {
  const sorted = [...lines].sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const out: VLine[] = [];
  for (const l of sorted) {
    const last = out.findLast((o) => near(o.x, l.x, 1.5) && l.y0 <= o.y1 + 3);
    if (last) {
      last.y1 = Math.max(last.y1, l.y1);
      last.y0 = Math.min(last.y0, l.y0);
    } else out.push({ ...l });
  }
  return out;
}

/** Distinct values (merged within `tol`), sorted. */
function distinct(values: number[], tol: number): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length && v - (out[out.length - 1] as number) <= tol) continue;
    out.push(v);
  }
  return out;
}

function center(r: Rect): [number, number] {
  return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
}

function inside(r: Rect, box: Rect, pad = 1): boolean {
  const [cx, cy] = center(r);
  return cx >= box[0] - pad && cx <= box[2] + pad && cy >= box[1] - pad && cy <= box[3] + pad;
}

/** Words → text in reading order (lines top to bottom, words left to right). */
function joinWords(words: Word[]): string {
  const lines = wordRows(words);
  return lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
}

type WordRow = { y: number; top: number; bottom: number; size: number; words: Word[] };

/** Words grouped into text lines by their vertical centre. */
export function wordRows(words: Word[]): WordRow[] {
  const sorted = [...words].sort((a, b) => (a.bbox[1] + a.bbox[3]) / 2 - (b.bbox[1] + b.bbox[3]) / 2 || a.bbox[0] - b.bbox[0]);
  const rows: WordRow[] = [];
  for (const w of sorted) {
    const c = (w.bbox[1] + w.bbox[3]) / 2;
    const h = w.bbox[3] - w.bbox[1];
    const row = rows[rows.length - 1];
    if (row && Math.abs(c - row.y) < Math.max(2, Math.min(h, row.bottom - row.top) * 0.5)) {
      row.words.push(w);
      row.y = (row.y * (row.words.length - 1) + c) / row.words.length;
      row.top = Math.min(row.top, w.bbox[1]);
      row.bottom = Math.max(row.bottom, w.bbox[3]);
    } else rows.push({ y: c, top: w.bbox[1], bottom: w.bbox[3], size: w.size, words: [w] });
  }
  for (const r of rows) r.words.sort((a, b) => a.bbox[0] - b.bbox[0]);
  return rows;
}

// ── Ruled tables ──────────────────────────────────────────────────────────

export function ruledTables(rules: Rect[], words: Word[]): FoundTable[] {
  const hs = mergeH(rules.filter((r) => r[3] - r[1] <= 2.5).map((r) => ({ y: (r[1] + r[3]) / 2, x0: r[0], x1: r[2] })));
  const vs = mergeV(rules.filter((r) => r[2] - r[0] <= 2.5).map((r) => ({ x: (r[0] + r[2]) / 2, y0: r[1], y1: r[3] })));
  if (hs.length < 2) return [];
  // Connected groups of lines that touch.
  const nodes: ({ kind: 'h'; l: HLine } | { kind: 'v'; l: VLine })[] = [...hs.map((l) => ({ kind: 'h' as const, l })), ...vs.map((l) => ({ kind: 'v' as const, l }))];
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  hs.forEach((h, i) => {
    vs.forEach((v, j) => {
      if (v.x >= h.x0 - 3 && v.x <= h.x1 + 3 && h.y >= v.y0 - 3 && h.y <= v.y1 + 3) join(i, hs.length + j);
    });
  });
  // Horizontal-only tables (rules between rows, no verticals): stack lines of about the same span.
  hs.forEach((a, i) => {
    hs.forEach((b, j) => {
      if (j <= i) return;
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (overlap > 0.9 * Math.max(a.x1 - a.x0, b.x1 - b.x0) && Math.abs(a.y - b.y) < 80) join(i, j);
    });
  });
  const groups = new Map<number, number[]>();
  nodes.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const tables: FoundTable[] = [];
  for (const members of groups.values()) {
    const gh = members.filter((i) => i < hs.length).map((i) => hs[i] as HLine);
    const gv = members.filter((i) => i >= hs.length).map((i) => vs[i - hs.length] as VLine);
    if (gh.length < 2) continue;
    const x0 = Math.min(...gh.map((h) => h.x0), ...gv.map((v) => v.x));
    const x1 = Math.max(...gh.map((h) => h.x1), ...gv.map((v) => v.x));
    const ys = distinct(gh.map((h) => h.y), 2);
    if (ys.length < 2 || x1 - x0 < 40) continue;
    const box: Rect = [x0, ys[0] as number, x1, ys[ys.length - 1] as number];
    const inner = words.filter((w) => inside(w.bbox, box));
    if (inner.length === 0) continue;
    let xs = distinct([x0, x1, ...gv.filter((v) => v.y1 - v.y0 > 4).map((v) => v.x)], 3);
    if (xs.length < 3) {
      // Only an outer frame or row rules: columns from the white space between words.
      const cols = whitespaceColumns(wordRows(inner), x1 - x0);
      if (cols.length < 2) continue;
      xs = [x0, ...cols.slice(1).map((c) => c[0] - 1), x1];
    }
    if (xs.length < 3) continue;
    const rows: TableCell[][] = [];
    for (let r = 0; r + 1 < ys.length; r++) {
      const top = ys[r] as number;
      const bottom = ys[r + 1] as number;
      if (bottom - top < 3) continue;
      const row: TableCell[] = [];
      for (let c = 0; c + 1 < xs.length; c++) {
        // A vertical rule missing between two cells of this row: they are one merged cell.
        let end = c + 1;
        while (end + 1 < xs.length && gv.length > 0) {
          const bx = xs[end] as number;
          const ruled = gv.some((v) => near(v.x, bx, 2) && v.y0 <= top + (bottom - top) * 0.3 && v.y1 >= bottom - (bottom - top) * 0.3);
          if (ruled) break;
          end += 1;
        }
        const cellBox: Rect = [xs[c] as number, top, xs[end] as number, bottom];
        const cw = inner.filter((w) => inside(w.bbox, cellBox, 0));
        row.push({ text: joinWords(cw), colSpan: end - c, bold: cw.length > 0 && cw.every((w) => w.bold) });
        c = end - 1;
      }
      const band = inner.filter((w) => inside(w.bbox, [x0, top, x1, bottom], 0));
      const lines = wordRows(band);
      if (gv.length === 0 && lines.length > 1) {
        // Rules only between groups of rows (no vertical rules): every text line is a row, wrapped cells merged.
        const lineRows = lines.map((l) => {
          const cellsOfLine = xs.slice(0, -1).map((cx, k) => {
            const ws = l.words.filter((w) => {
              const mid = (w.bbox[0] + w.bbox[2]) / 2;
              return mid >= cx && mid < (xs[k + 1] as number);
            });
            return { text: ws.map((w) => w.text).join(' '), colSpan: 1, bold: ws.length > 0 && ws.every((w) => w.bold) };
          });
          return { y: l.y, top: l.top, bottom: l.bottom, bold: l.words.every((w) => w.bold), cells: cellsOfLine };
        });
        for (const m of mergeWrappedRows(lineRows, (a, b) => ({ ...a, text: `${a.text} ${b.text}`.trim(), bold: a.bold && b.bold }))) rows.push(m.cells);
        continue;
      }
      if (row.some((cell) => cell.text)) rows.push(row);
    }
    const columns = xs.length - 1;
    // A frame around one block of text is not a table.
    if (rows.length === 0 || (columns < 2 && rows.length < 2) || rows.every((r) => r.length === 1)) continue;
    tables.push({ bbox: box, rows, header: (rows[0] ?? []).every((c) => c.bold || !c.text), ruled: true, columns });
  }
  return tables;
}

// ── Tables of aligned text ────────────────────────────────────────────────

type Cell = { text: string; x0: number; x1: number; bold: boolean };

function cellsOf(row: WordRow, gapFactor: number): Cell[] {
  const cells: Cell[] = [];
  for (const w of row.words) {
    const last = cells[cells.length - 1];
    const gap = last ? w.bbox[0] - last.x1 : Infinity;
    if (last && gap < Math.max(4, w.size * gapFactor)) {
      last.text += ` ${w.text}`;
      last.x1 = Math.max(last.x1, w.bbox[2]);
      last.bold &&= w.bold;
    } else cells.push({ text: w.text, x0: w.bbox[0], x1: w.bbox[2], bold: w.bold });
  }
  return cells;
}

/** Column x-ranges from cells of several rows: x-ranges that overlap merge. */
function columnsFrom(cells: Cell[][]): [number, number][] {
  const spans = cells.flatMap((r) => r.map((c): [number, number] => [c.x0, c.x1])).sort((a, b) => a[0] - b[0]);
  const cols: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = cols[cols.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else cols.push([a, b]);
  }
  return cols;
}

function whitespaceColumns(rows: WordRow[], width: number): [number, number][] {
  const cells = rows.map((r) => cellsOf(r, 1.2)).filter((c) => c.length >= 2 && c.every((x) => x.x1 - x.x0 < width * 0.6));
  return cells.length ? columnsFrom(cells) : [];
}

function colIndex(cols: [number, number][], c: { x0: number; x1: number }): number {
  let best = 0;
  let bestScore = -Infinity;
  cols.forEach(([a, b], i) => {
    const overlap = Math.min(b, c.x1) - Math.max(a, c.x0);
    const score = overlap > 0 ? overlap : -Math.min(Math.abs(c.x0 - a), Math.abs(c.x1 - b));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * Rows of a table whose cells wrap onto several lines come out as extra
 * rows with only some cells filled: those are merged into the row above when
 * a column that is filled in nearly every row is empty, and the line sits
 * closer to the row above than rows usually do (or its first cell is empty).
 */
export function mergeWrappedRows<T extends { text: string }>(rows: { y: number; top: number; bottom: number; bold: boolean; cells: T[] }[], join: (a: T, b: T) => T): { cells: T[]; top: number; bottom: number }[] {
  if (rows.length < 3) return rows;
  const nCols = Math.max(...rows.map((r) => r.cells.length));
  // Columns filled in nearly every row that has several cells.
  const multi = rows.filter((r) => r.cells.filter((c) => c.text !== '').length >= 2);
  const basis = multi.length >= 2 ? multi : rows;
  const filled = Array.from({ length: nCols }, (_, c) => basis.filter((r) => (r.cells[c]?.text ?? '') !== '').length / basis.length);
  const dense = filled.map((f) => f >= 0.7);
  const pitches = rows.slice(1).map((r, i) => r.y - (rows[i] as { y: number }).y).sort((a, b) => a - b);
  const median = pitches[Math.floor(pitches.length / 2)] ?? 0;
  const out: { cells: T[]; top: number; bottom: number; y: number; bold: boolean }[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      const pitch = r.y - prev.y;
      const emptyDense = r.cells.some((c, i) => dense[i] && c.text === '');
      const firstEmpty = (r.cells[0]?.text ?? '') === '';
      const tight = pitch < median * 0.85 || r.top - prev.bottom < (r.bottom - r.top) * 0.35;
      const filled = (cells: T[]) => cells.filter((c) => c.text !== '').length;
      const close = r.top - prev.bottom < (r.bottom - r.top) * 0.6;
      if (emptyDense && close && (tight || firstEmpty) && r.bold === prev.bold && filled(r.cells) > 0 && filled(prev.cells) >= 2 && filled(r.cells) < filled(prev.cells)) {
        prev.cells = prev.cells.map((c, i) => (r.cells[i] && r.cells[i].text ? join(c, r.cells[i]) : c));
        prev.bottom = r.bottom;
        prev.y = r.y;
        continue;
      }
    }
    out.push({ cells: [...r.cells], top: r.top, bottom: r.bottom, y: r.y, bold: r.bold });
  }
  return out;
}

const BULLET_CELL = /^([•●○◦▪■□‣⁃–—\-*·]|\(?\d{1,3}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])$/;

function alignedTables(words: Word[], pageWidth: number): FoundTable[] {
  const rows = wordRows(words);
  const cells = rows.map((r) => cellsOf(r, 1.2));
  const tables: FoundTable[] = [];
  let i = 0;
  while (i < rows.length) {
    const ok = (k: number) => {
      const c = cells[k] as Cell[];
      return c.length >= 2 && c.every((x) => x.x1 - x.x0 < pageWidth * 0.45);
    };
    if (!ok(i)) {
      i += 1;
      continue;
    }
    // Extend while rows stay close together; single-cell rows may sit inside (wrapped cells).
    let j = i;
    let last = i;
    for (let k = i + 1; k < rows.length; k++) {
      const gap = (rows[k] as WordRow).top - (rows[k - 1] as WordRow).bottom;
      const lineH = (rows[k] as WordRow).bottom - (rows[k] as WordRow).top;
      if (gap > Math.max(lineH * 1.8, 14)) break;
      if (ok(k)) {
        last = k;
        j = k;
      } else if ((cells[k] as Cell[]).length > 1 || k - last > 2) break;
    }
    // Wrapped lines of the last row's cells (indented past the first column, right below it).
    const firstX = Math.min(...(cells.slice(i, j + 1).flat().map((c) => c.x0)));
    for (let k = j + 1; k < rows.length && k <= j + 3; k++) {
      const c = cells[k] as Cell[];
      const gap = (rows[k] as WordRow).top - (rows[k - 1] as WordRow).bottom;
      if (c.length !== 1 || gap > ((rows[k] as WordRow).bottom - (rows[k] as WordRow).top) * 0.8 || (c[0] as Cell).x0 < firstX + 10) break;
      j = k;
    }
    const run = rows.slice(i, j + 1);
    const runCells = cells.slice(i, j + 1);
    i = j + 1;
    const multi = runCells.filter((c) => c.length >= 2);
    if (multi.length < 3) continue;
    const cols = columnsFrom(multi);
    if (cols.length < 2 || cols.length > 14) continue;
    // Lists ("1." + text) and two text columns are not tables.
    if (cols.length === 2 && multi.every((c) => BULLET_CELL.test((c[0] as Cell).text))) continue;
    const avg = multi.flat().reduce((n, c) => n + c.text.length, 0) / multi.flat().length;
    if (cols.length === 2 && avg > 30) continue;
    const usage = cols.map((_, ci) => multi.filter((r) => r.some((c) => colIndex(cols, c) === ci)).length / multi.length);
    if (usage.filter((u) => u >= 0.5).length < 2) continue;
    const grid = run.map((r, k) => {
      const values: Cell[] = cols.map(() => ({ text: '', x0: 0, x1: 0, bold: false }));
      for (const c of runCells[k] as Cell[]) {
        const ci = colIndex(cols, c);
        const v = values[ci] as Cell;
        values[ci] = v.text ? { ...v, text: `${v.text} ${c.text}`, bold: v.bold && c.bold } : c;
      }
      return { y: r.y, top: r.top, bottom: r.bottom, bold: (runCells[k] as Cell[]).every((c) => c.bold), cells: values };
    });
    const merged = mergeWrappedRows(grid, (a, b) => ({ ...a, text: `${a.text} ${b.text}`.trim(), bold: a.bold && b.bold }));
    const bbox: Rect = [
      Math.min(...run.flatMap((r) => r.words.map((w) => w.bbox[0]))),
      (run[0] as WordRow).top,
      Math.max(...run.flatMap((r) => r.words.map((w) => w.bbox[2]))),
      (run[run.length - 1] as WordRow).bottom,
    ];
    const out = merged.map((r) => r.cells.map((c) => ({ text: c.text, colSpan: 1, bold: c.bold && !!c.text })));
    tables.push({ bbox, rows: out, header: (out[0] ?? []).filter((c) => c.text).every((c) => c.bold), ruled: false, columns: cols.length });
  }
  return tables;
}

/** Tables on a page: ruled grids first, then aligned text outside them. */
export function findTables(words: Word[], rules: Rect[], pageWidth: number): FoundTable[] {
  const ruled = ruledTables(rules, words);
  const rest = words.filter((w) => !ruled.some((t) => inside(w.bbox, t.bbox, 2)));
  return [...ruled, ...alignedTables(rest, pageWidth)].sort((a, b) => a.bbox[1] - b.bbox[1]);
}

// ── Reading order ─────────────────────────────────────────────────────────

/**
 * Order of page items for reading: on pages with two or three text columns,
 * each column top to bottom, left to right, with items that span the
 * columns (titles, wide figures, tables) as breaks between column sections.
 * Pages without columns keep their order.
 */
export function readingOrder(items: { bbox: Rect; chars: number }[], pageWidth: number): number[] {
  const order = items.map((_, i) => i);
  const text = items.filter((it) => it.chars > 0);
  if (text.length < 4) return order;
  const x0 = Math.min(...text.map((t) => t.bbox[0]));
  const x1 = Math.max(...text.map((t) => t.bbox[2]));
  const width = x1 - x0;
  if (width < pageWidth * 0.3) return order;
  const narrow = items.filter((it) => it.bbox[2] - it.bbox[0] < width * 0.62);
  // Gutters: x-ranges inside the text area no narrow item covers.
  const spans = narrow.map((it): [number, number] => [it.bbox[0], it.bbox[2]]).sort((a, b) => a[0] - b[0]);
  const gutters: [number, number][] = [];
  let reach = x0;
  for (const [a, b] of spans) {
    if (a - reach >= 6 && reach > x0 + width * 0.15 && a < x1 - width * 0.15) gutters.push([reach, a]);
    reach = Math.max(reach, b);
  }
  if (gutters.length === 0 || gutters.length > 2) return order;
  const columnOf = (r: Rect) => gutters.filter((g) => (r[0] + r[2]) / 2 > g[1]).length;
  // Enough text on each side of every gutter.
  const charsBy = new Array<number>(gutters.length + 1).fill(0);
  for (const it of narrow) charsBy[columnOf(it.bbox)] = (charsBy[columnOf(it.bbox)] as number) + it.chars;
  const total = charsBy.reduce((a, b) => a + b, 0);
  if (charsBy.some((c) => c < total * 0.15)) return order;
  const spansGutter = (r: Rect) => gutters.some((g) => r[0] < g[0] - 2 && r[2] > g[1] + 2);
  const byTop = [...order].sort((a, b) => (items[a] as { bbox: Rect }).bbox[1] - (items[b] as { bbox: Rect }).bbox[1]);
  const out: number[] = [];
  let section: number[] = [];
  const flush = () => {
    section.sort((a, b) => {
      const ra = (items[a] as { bbox: Rect }).bbox;
      const rb = (items[b] as { bbox: Rect }).bbox;
      return columnOf(ra) - columnOf(rb) || ra[1] - rb[1];
    });
    out.push(...section);
    section = [];
  };
  for (const i of byTop) {
    if (spansGutter((items[i] as { bbox: Rect }).bbox)) {
      flush();
      out.push(i);
    } else section.push(i);
  }
  flush();
  return out;
}
