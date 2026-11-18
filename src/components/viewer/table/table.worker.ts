/// <reference lib="webworker" />
/**
 * The CSV viewer's worker: parses the file (streaming, CSV/TSV, or a workbook
 * through SheetJS), keeps the table, and answers row, sort, filter, search,
 * statistics and export requests, so the page never holds the data.
 */
import { expose } from 'comlink';
import {
  type ColumnInfo,
  type ColumnStats,
  columnLetter,
  columnStats,
  compileFilter,
  CsvParser,
  csvCell,
  detectDelimiter,
  detectEncoding,
  detectQuote,
  exportCsv,
  exportJson,
  type Filter,
  filterRows,
  inferTypes,
  jsonValue,
  looksLikeHeader,
  searchCells,
  type SortKey,
  sortRows,
  Table,
} from './engine';

export type OpenOptions = {
  delimiter: string;
  quote: string;
  encoding: string;
  header: 'auto' | 'yes' | 'no';
  sheet: number;
};

export type TableMeta = {
  kind: 'csv' | 'workbook';
  rows: number;
  columns: ColumnInfo[];
  delimiter: string;
  quote: string;
  encoding: string;
  header: boolean;
  sheets: string[];
  sheet: number;
  done: boolean;
  truncated: boolean;
  ragged: number;
  ms: number;
  read: number;
  size: number;
};

export type ViewResult = { count: number; ms: number; error?: { col: number; message: string } };
export type SearchResult = { positions: Uint32Array; cols: Uint16Array; capped: boolean; ms: number };

/** Stop storing rows past this much memory (the tab would otherwise run out). */
const BUDGET = 1400 * 1024 * 1024;

let table = new Table();
let meta: TableMeta | null = null;
let view: Uint32Array | null = null;
let inverse: Int32Array | null = null;
let keyCache = new Map<number, Float64Array>();
let generation = 0;
let workbook: import('xlsx').WorkBook | null = null;
let workbookFile: Blob | null = null;

const decimalComma = () => (meta?.delimiter ?? ',') !== ',' && meta?.kind === 'csv';

function identity(): Uint32Array {
  const base = table.base;
  const out = new Uint32Array(table.rows);
  for (let i = 0; i < out.length; i++) out[i] = i + base;
  return out;
}

function currentView(): Uint32Array {
  return view ?? identity();
}

function placeholderColumns(): ColumnInfo[] {
  return table.names().map((name) => ({ name, type: 'text' as const, fit: 1 }));
}

function snapshot(done: boolean, extra: Partial<TableMeta>): TableMeta {
  return {
    ...(meta as TableMeta),
    ...extra,
    rows: table.rows,
    columns: done ? inferTypes(table, decimalComma()) : placeholderColumns(),
    header: table.header,
    ragged: table.ragged,
    done,
  };
}

async function openCsv(file: Blob, opts: OpenOptions, onProgress: (m: TableMeta) => void, gen: number): Promise<TableMeta> {
  const started = performance.now();
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const guess = detectEncoding(head);
  const encoding = opts.encoding === 'auto' ? guess.encoding : opts.encoding;
  const bom = opts.encoding === 'auto' || opts.encoding === guess.encoding ? guess.bom : 0;
  const sample = new TextDecoder(encoding).decode(head.subarray(bom));
  const name = (file as File).name ?? '';
  let delimiter = opts.delimiter;
  if (delimiter === 'auto') delimiter = /\.(tsv|tab)$/i.test(name) && sample.includes('\t') ? '\t' : detectDelimiter(sample);
  const quote = opts.quote === 'auto' ? detectQuote(sample, delimiter) : opts.quote;
  table = new Table(Math.max(1024, Math.ceil(file.size / Math.max(16, sample.indexOf('\n') + 1 || 64)) + 64));
  meta = {
    kind: 'csv',
    rows: 0,
    columns: [],
    delimiter,
    quote,
    encoding,
    header: true,
    sheets: [],
    sheet: 0,
    done: false,
    truncated: false,
    ragged: 0,
    ms: 0,
    read: 0,
    size: file.size,
  };
  const firstLine = sample.split('\n', 1)[0] ?? '';
  const width = Math.max(1, firstLine.split(delimiter).length);
  const parser = new CsvParser(table, delimiter, quote, { cellHint: Math.ceil((file.size / width) * 1.02) + 1024, budget: BUDGET });
  const utf8 = encoding === 'utf-8';
  const decoder = utf8 ? null : new TextDecoder(encoding);
  const encoder = new TextEncoder();
  let headerDecided = opts.header !== 'auto';
  table.header = opts.header !== 'no';
  const decideHeader = () => {
    if (headerDecided) return;
    headerDecided = true;
    table.header = looksLikeHeader(table, delimiter !== ',');
  };
  const reader = file.slice(bom).stream().getReader();
  let read = bom;
  let lastReport = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (gen !== generation) {
      void reader.cancel();
      throw new DOMException('Superseded', 'AbortError');
    }
    if (done) break;
    read += value.length;
    const bytes = decoder ? encoder.encode(decoder.decode(value, { stream: true })) : value;
    parser.feed(bytes, false);
    if (parser.truncated) {
      void reader.cancel();
      break;
    }
    if (!headerDecided && table.n >= 200) decideHeader();
    const now = performance.now();
    if (now - lastReport > 250 || lastReport === 0) {
      if (table.n > 0) {
        if (lastReport === 0 && !headerDecided && table.n >= 2) decideHeader();
        lastReport = now;
        onProgress(snapshot(false, { read, ms: now - started }));
        // Let row requests in between.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  if (decoder && !parser.truncated) parser.feed(encoder.encode(decoder.decode()), false);
  if (!parser.truncated) parser.feed(new Uint8Array(0), true);
  decideHeader();
  table.finish();
  meta = snapshot(true, { read: parser.truncated ? read : file.size, ms: performance.now() - started, truncated: parser.truncated });
  return meta;
}

function loadSheet(index: number, opts: OpenOptions, XLSX: typeof import('xlsx'), started: number): TableMeta {
  const wb = workbook!;
  const name = wb.SheetNames[index] ?? wb.SheetNames[0]!;
  const ws = wb.Sheets[name];
  table = new Table(1024);
  if (ws?.['!ref']) {
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
    for (const row of rows) table.pushStrings(row.map((v) => (v == null ? '' : String(v))));
  }
  table.header = opts.header === 'auto' ? looksLikeHeader(table, false) : opts.header === 'yes';
  table.finish();
  meta = {
    kind: 'workbook',
    rows: table.rows,
    columns: inferTypes(table, false),
    delimiter: ',',
    quote: '"',
    encoding: 'utf-8',
    header: table.header,
    sheets: wb.SheetNames,
    sheet: wb.SheetNames.indexOf(name),
    done: true,
    truncated: false,
    ragged: 0,
    ms: performance.now() - started,
    read: workbookFile?.size ?? 0,
    size: workbookFile?.size ?? 0,
  };
  return meta;
}

async function openWorkbook(file: Blob, opts: OpenOptions): Promise<TableMeta> {
  const started = performance.now();
  const XLSX = await import('xlsx');
  if (workbookFile !== file || !workbook) {
    const data = new Uint8Array(await file.arrayBuffer());
    try {
      workbook = XLSX.read(data, { type: 'array', dense: true, cellDates: false, cellStyles: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/password|encrypt/i.test(msg)) throw new Error('This workbook is password-protected; it cannot be opened here.');
      throw new Error(`This file could not be read as a spreadsheet (${msg}).`);
    }
    workbookFile = file;
    if (!workbook.SheetNames?.length) throw new Error('This workbook has no sheets.');
  }
  return loadSheet(Math.max(0, Math.min(opts.sheet, workbook.SheetNames.length - 1)), opts, XLSX, started);
}

const api = {
  async open(file: Blob, kind: 'csv' | 'workbook', opts: OpenOptions, onProgress: (m: TableMeta) => void): Promise<TableMeta> {
    const gen = ++generation;
    view = null;
    inverse = null;
    keyCache = new Map();
    if (kind === 'workbook') return openWorkbook(file, opts);
    workbook = null;
    workbookFile = null;
    return openCsv(file, opts, onProgress, gen);
  },

  /** Applies sort keys and filters; later row requests follow the new order. */
  setView(sort: SortKey[], filters: Filter[]): ViewResult {
    const started = performance.now();
    const info = meta?.columns ?? [];
    const matchers = [];
    for (const f of filters) {
      if (!f.query.trim()) continue;
      const m = compileFilter(f, info[f.col] ?? { name: '', type: 'text', fit: 1 }, decimalComma());
      if (typeof m === 'string') return { count: currentView().length, ms: 0, error: { col: f.col, message: m } };
      matchers.push(m);
    }
    let rows = matchers.length ? filterRows(table, matchers) : null;
    if (sort.length) rows = sortRows(table, rows ?? identity(), sort, info, decimalComma(), keyCache);
    view = rows;
    inverse = null;
    return { count: currentView().length, ms: performance.now() - started };
  },

  /** Rows at view positions [from, from + count), every column as text. */
  rows(from: number, count: number): string[][] {
    const v = view;
    const total = v ? v.length : table.rows;
    const out: string[][] = [];
    const width = table.width;
    const base = table.base;
    for (let i = from; i < Math.min(total, from + count); i++) {
      const r = v ? v[i]! : i + base;
      const row = new Array<string>(width);
      for (let c = 0; c < width; c++) row[c] = table.cell(c, r);
      out.push(row);
    }
    return out;
  },

  /** The source row number (1-based, as in the file) of a view position. */
  sourceRow(pos: number): number {
    const r = view ? view[pos] : pos + table.base;
    return r === undefined ? -1 : r + 1;
  },

  /** Tab-separated text of a rectangle (view rows × the given columns), for the clipboard. */
  range(fromRow: number, toRow: number, cols: number[], withHeader: boolean): string {
    const v = currentView();
    const names = table.names();
    const lines: string[] = withHeader ? [cols.map((c) => names[c] ?? '').join('\t')] : [];
    const clean = (s: string) => (/[\t\r\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (let i = fromRow; i <= Math.min(toRow, v.length - 1); i++) {
      const r = v[i]!;
      lines.push(cols.map((c) => clean(table.cell(c, r))).join('\t'));
    }
    return lines.join('\n');
  },

  search(query: string, cols: number[], limit = 1_000_000): SearchResult {
    const started = performance.now();
    if (!query) return { positions: new Uint32Array(0), cols: new Uint16Array(0), capped: false, ms: 0 };
    const hits = searchCells(table, query, cols, limit);
    // Map source rows to view positions and order by (position, column order).
    if (view && !inverse) {
      inverse = new Int32Array(table.n).fill(-1);
      for (let i = 0; i < view.length; i++) inverse[view[i]!] = i;
    }
    const order = new Map(cols.map((c, i) => [c, i]));
    const n = hits.rows.length;
    const pos = new Float64Array(n);
    let k = 0;
    const keep = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const r = hits.rows[i]!;
      const p = inverse ? inverse[r]! : r - table.base;
      if (p < 0) continue;
      pos[k] = p * 65536 + (order.get(hits.cols[i]!) ?? 0);
      keep[k++] = i;
    }
    const idx = Array.from({ length: k }, (_, i) => i).sort((a, b) => pos[a]! - pos[b]!);
    const positions = new Uint32Array(k);
    const outCols = new Uint16Array(k);
    idx.forEach((j, i) => {
      positions[i] = Math.floor(pos[j]! / 65536);
      outCols[i] = hits.cols[keep[j]!]!;
    });
    return { positions, cols: outCols, capped: hits.capped, ms: performance.now() - started };
  },

  stats(col: number): ColumnStats {
    const info = meta?.columns[col] ?? { name: columnLetter(col), type: 'text' as const, fit: 1 };
    return columnStats(table, col, currentView(), info, decimalComma());
  },

  async exportView(format: 'csv' | 'json' | 'xlsx', cols: number[]): Promise<Blob> {
    const rows = currentView();
    const names = table.names();
    const info = meta?.columns ?? [];
    if (format === 'csv') return new Blob(exportCsv(table, rows, cols, names), { type: 'text/csv;charset=utf-8' });
    if (format === 'json') return new Blob(exportJson(table, rows, cols, names, info, decimalComma()), { type: 'application/json' });
    if (rows.length > 1_048_575) throw new Error('Excel sheets hold at most 1,048,576 rows. Filter the table first, or export CSV.');
    const XLSX = await import('xlsx');
    const aoa: unknown[][] = [cols.map((c) => names[c] ?? '')];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      aoa.push(cols.map((c) => jsonValue(table.cell(c, r), info[c], decimalComma()) ?? ''));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  },

  /** A small CSV cell quoter for the page (copying a row). */
  quote(values: string[]): string {
    return values.map((v) => csvCell(v)).join(',');
  },
};

export type TableWorkerApi = typeof api;
expose(api);
