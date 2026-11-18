/**
 * The table engine behind the CSV viewer: a streaming CSV parser that works on
 * UTF-8 bytes and stores every column as one byte pool plus row offsets (about
 * the file's size plus 4 bytes a cell, no string per cell), type inference,
 * sorting, filtering, search, statistics and export. Pure: runs in a worker,
 * and in Node for benchmarks.
 */

export type ColType = 'number' | 'date' | 'boolean' | 'text' | 'empty';

export type ColumnInfo = {
  name: string;
  type: ColType;
  /** Share of sampled non-empty cells that fit the type (1 = all). */
  fit: number;
  /** Day-month order for slash dates (03/04/2024 = 3 April). */
  dmy?: boolean;
};

export type SortKey = { col: number; desc: boolean };

export type Filter = { col: number; query: string };

export type ColumnStats = {
  col: number;
  type: ColType;
  rows: number;
  count: number;
  nulls: number;
  distinct: number;
  distinctCapped: boolean;
  min?: string;
  max?: string;
  mean?: number;
  sum?: number;
  std?: number;
  minLength?: number;
  maxLength?: number;
  meanLength?: number;
  histogram?: { from: number; to: number; count: number; label: string }[];
  top?: { value: string; count: number }[];
  ms: number;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// ── Column storage ─────────────────────────────────────────────────────────

export class Column {
  bytes: Uint8Array;
  len = 0;

  constructor(cap: number) {
    this.bytes = new Uint8Array(Math.max(1024, cap));
  }

  reserve(extra: number): void {
    const need = this.len + extra;
    if (need <= this.bytes.length) return;
    let cap = this.bytes.length;
    while (cap < need) cap = Math.ceil(cap * 1.6);
    const next = new Uint8Array(cap);
    next.set(this.bytes.subarray(0, this.len));
    this.bytes = next;
  }

  /** Copies bytes [a, b) of `src`; `esc` collapses doubled quote bytes `q`. */
  write(src: Uint8Array, a: number, b: number, esc: boolean, q: number): void {
    const n = b - a;
    if (n <= 0) return;
    this.reserve(n);
    const out = this.bytes;
    let o = this.len;
    if (esc) {
      for (let i = a; i < b; i++) {
        const c = src[i]!;
        out[o++] = c;
        if (c === q && src[i + 1] === q) i++;
      }
    } else if (n < 24) {
      for (let i = a; i < b; i++) out[o++] = src[i]!;
    } else {
      out.set(src.subarray(a, b), o);
      o += n;
    }
    this.len = o;
  }

  shrink(): void {
    if (this.bytes.length > this.len * 1.05 + 1024) this.bytes = this.bytes.slice(0, this.len);
  }
}

/** A cell's bytes as a string; plain ASCII skips the decoder. */
export function decodeRange(bytes: Uint8Array, a: number, b: number): string {
  const n = b - a;
  if (n <= 0) return '';
  if (n <= 40) {
    let s = '';
    for (let i = a; i < b; i++) {
      const c = bytes[i]!;
      if (c > 127) return textDecoder.decode(bytes.subarray(a, b));
      s += String.fromCharCode(c);
    }
    return s;
  }
  return textDecoder.decode(bytes.subarray(a, b));
}

export class Table {
  cols: Column[] = [];
  /** offs[c][r] .. offs[c][r + 1] is cell (r, c). */
  offs: Uint32Array[] = [];
  /** Rows stored, including the header row when there is one. */
  n = 0;
  cap: number;
  header = true;
  /** Rows whose field count differs from the first row's. */
  ragged = 0;
  firstWidth = -1;
  /** Total bytes held, for the memory budget. */
  held = 0;

  constructor(rowCapacity = 1024) {
    this.cap = Math.max(16, rowCapacity);
  }

  get base(): number {
    return this.header && this.n > 0 ? 1 : 0;
  }

  /** Data rows (without the header). */
  get rows(): number {
    return Math.max(0, this.n - this.base);
  }

  get width(): number {
    return this.cols.length;
  }

  addColumn(cellHint: number): number {
    this.cols.push(new Column(cellHint));
    this.offs.push(new Uint32Array(this.cap + 1));
    return this.cols.length - 1;
  }

  growRows(): void {
    const cap = Math.ceil(this.cap * 1.5) + 16;
    for (let c = 0; c < this.offs.length; c++) {
      const next = new Uint32Array(cap + 1);
      next.set(this.offs[c]!.subarray(0, this.n + 1));
      this.offs[c] = next;
    }
    this.cap = cap;
  }

  cell(c: number, r: number): string {
    const col = this.cols[c];
    if (!col || r >= this.n) return '';
    const o = this.offs[c]!;
    return decodeRange(col.bytes, o[r]!, o[r + 1]!);
  }

  cellLength(c: number, r: number): number {
    const o = this.offs[c]!;
    return o[r + 1]! - o[r]!;
  }

  names(): string[] {
    const out: string[] = [];
    for (let c = 0; c < this.width; c++) {
      const name = this.header && this.n > 0 ? this.cell(c, 0).trim() : '';
      out.push(name || columnLetter(c));
    }
    return out;
  }

  /** Appends one row from string cells (workbooks, SQL results). */
  pushStrings(cells: readonly string[]): void {
    const width = cells.length;
    while (this.width < width) this.addColumn(1024);
    if (this.n + 1 >= this.cap) this.growRows();
    for (let c = 0; c < this.width; c++) {
      const col = this.cols[c]!;
      const v = c < width ? cells[c]! : '';
      if (v) {
        col.reserve(v.length * 3);
        const { written } = textEncoder.encodeInto(v, col.bytes.subarray(col.len));
        col.len += written;
      }
      this.offs[c]![this.n + 1] = col.len;
    }
    this.n++;
  }

  finish(): void {
    for (const col of this.cols) col.shrink();
    this.held = this.cols.reduce((s, c) => s + c.bytes.length, 0) + this.offs.reduce((s, o) => s + o.byteLength, 0);
  }
}

export function columnLetter(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

const LF = 10;
const CR = 13;

/**
 * Streaming CSV/TSV parser over UTF-8 bytes. RFC 4180 quoting (doubled quotes
 * inside quoted fields, line breaks inside quotes), CRLF/LF/CR line ends,
 * blank lines skipped, ragged rows padded.
 */
export class CsvParser {
  table: Table;
  #delim: number;
  #quote: number;
  #carry: Uint8Array | null = null;
  #fs = new Int32Array(256);
  #fe = new Int32Array(256);
  #fq = new Uint8Array(256);
  #cellHint: number;
  /** Stop storing rows once this many bytes are held. */
  budget: number;
  truncated = false;

  constructor(table: Table, delimiter: string, quote: string, opts: { cellHint?: number; budget?: number } = {}) {
    this.table = table;
    this.#delim = delimiter.charCodeAt(0);
    this.#quote = quote ? quote.charCodeAt(0) : -1;
    this.#cellHint = opts.cellHint ?? 4096;
    this.budget = opts.budget ?? Number.POSITIVE_INFINITY;
  }

  #commit(buf: Uint8Array, nf: number): void {
    const t = this.table;
    // Skip blank lines.
    if (nf === 1 && this.#fs[0] === this.#fe[0]) return;
    if (t.firstWidth < 0) t.firstWidth = nf;
    else if (nf !== t.firstWidth) t.ragged++;
    while (t.width < nf) t.addColumn(this.#cellHint);
    if (t.n + 1 >= t.cap) t.growRows();
    const row = t.n;
    const q = this.#quote;
    const cols = t.cols;
    const offs = t.offs;
    const width = t.width;
    for (let f = 0; f < width; f++) {
      const col = cols[f]!;
      if (f < nf) col.write(buf, this.#fs[f]!, this.#fe[f]!, this.#fq[f] === 1, q);
      offs[f]![row + 1] = col.len;
    }
    t.n = row + 1;
  }

  #field(nf: number, a: number, b: number, esc: boolean): number {
    if (nf >= this.#fs.length) {
      const grow = (x: Int32Array) => {
        const y = new Int32Array(x.length * 2);
        y.set(x);
        return y;
      };
      this.#fs = grow(this.#fs);
      this.#fe = grow(this.#fe);
      const fq = new Uint8Array(this.#fq.length * 2);
      fq.set(this.#fq);
      this.#fq = fq;
    }
    this.#fs[nf] = a;
    this.#fe[nf] = b;
    this.#fq[nf] = esc ? 1 : 0;
    return nf + 1;
  }

  /** Parses `chunk`; with `final`, the rest of the input too. Returns rows stored so far. */
  feed(chunk: Uint8Array, final: boolean): number {
    if (this.truncated) return this.table.n;
    let buf = chunk;
    if (this.#carry && this.#carry.length) {
      buf = new Uint8Array(this.#carry.length + chunk.length);
      buf.set(this.#carry);
      buf.set(chunk, this.#carry.length);
    }
    this.#carry = null;
    const end = buf.length;
    const D = this.#delim;
    const Q = this.#quote;
    let pos = 0;
    let checkBudget = 0;
    rows: while (pos < end) {
      let nf = 0;
      let i = pos;
      for (;;) {
        // One field.
        if (i < end && buf[i] === Q) {
          let j = i + 1;
          let esc = false;
          for (;;) {
            j = buf.indexOf(Q, j);
            if (j < 0) {
              if (!final) break rows;
              j = end;
              break;
            }
            if (j + 1 >= end && !final) break rows;
            if (buf[j + 1] === Q) {
              esc = true;
              j += 2;
              continue;
            }
            break;
          }
          nf = this.#field(nf, i + 1, Math.min(j, end), esc);
          i = j + 1;
          // Text after a closing quote is ignored up to the next delimiter or line end.
          while (i < end) {
            const c = buf[i];
            if (c === D || c === LF || c === CR) break;
            i++;
          }
        } else {
          let j = i;
          while (j < end) {
            const c = buf[j];
            if (c === D || c === LF || c === CR) break;
            j++;
          }
          nf = this.#field(nf, i, j, false);
          i = j;
        }
        if (i >= end) {
          if (!final) break rows;
          this.#commit(buf, nf);
          pos = end;
          break rows;
        }
        const c = buf[i];
        if (c === D) {
          i++;
          if (i >= end) {
            if (!final) break rows;
            nf = this.#field(nf, i, i, false);
            this.#commit(buf, nf);
            pos = end;
            break rows;
          }
          continue;
        }
        // Line end: CRLF, LF or a lone CR.
        if (c === CR) {
          if (i + 1 >= end && !final) break rows;
          i += buf[i + 1] === LF ? 2 : 1;
        } else {
          i += 1;
        }
        this.#commit(buf, nf);
        pos = i;
        if (++checkBudget === 4096) {
          checkBudget = 0;
          if (this.#held() > this.budget) {
            this.truncated = true;
            return this.table.n;
          }
        }
        break;
      }
    }
    if (pos < end && !final) this.#carry = buf.slice(pos);
    return this.table.n;
  }

  #held(): number {
    const t = this.table;
    let s = 0;
    for (const c of t.cols) s += c.bytes.length;
    return s + t.offs.length * (t.cap + 1) * 4;
  }
}

// ── Detection ───────────────────────────────────────────────────────────────

export const DELIMITERS = [',', ';', '\t', '|', ':', ' '] as const;

/** The delimiter that splits the sample's lines most consistently (quotes respected). */
export function detectDelimiter(sample: string, quote = '"'): string {
  const lines: string[] = [];
  let inQ = false;
  let start = 0;
  for (let i = 0; i < sample.length && lines.length < 50; i++) {
    const ch = sample[i];
    if (ch === quote) inQ = !inQ;
    else if (ch === '\n' && !inQ) {
      lines.push(sample.slice(start, i));
      start = i + 1;
    }
  }
  if (!lines.length) lines.push(sample);
  const filled = lines.filter((l) => l.trim() !== '');
  let best = ',';
  let bestScore = -1;
  const qre = quote ? new RegExp(`${quote === '"' ? '"' : "'"}[^${quote === '"' ? '"' : "'"}]*${quote === '"' ? '"' : "'"}`, 'g') : null;
  for (const d of DELIMITERS) {
    const counts = filled.map((l) => (qre ? l.replace(qre, '') : l).split(d).length - 1);
    if (!counts.length || counts[0] === 0) continue;
    const first = counts[0]!;
    const same = counts.filter((n) => n === first).length / counts.length;
    // Consistency first, then more columns; a space only wins when nothing else does.
    const score = same * 1000 + Math.min(first, 200) - (d === ' ' ? 500 : 0) - (d === ':' ? 300 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** `'` when fields are quoted with apostrophes, otherwise `"`. */
export function detectQuote(sample: string, delimiter: string): string {
  const d = delimiter === '\t' ? '\\t' : delimiter.replace(/[|\\^$*+?.()[\]{}]/g, '\\$&');
  const dq = (sample.match(new RegExp(`(^|${d})"`, 'gm')) ?? []).length;
  const sq = (sample.match(new RegExp(`(^|${d})'[^']*'(?=${d}|$)`, 'gm')) ?? []).length;
  return sq > dq * 2 && sq > 2 ? "'" : '"';
}

export type EncodingGuess = { encoding: string; bom: number };

/** BOM, then UTF-16 zero-byte patterns, then UTF-8 validity, else Windows-1252. */
export function detectEncoding(b: Uint8Array): EncodingGuess {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { encoding: 'utf-8', bom: 3 };
  if (b[0] === 0xff && b[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
  if (b[0] === 0xfe && b[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
  let even = 0;
  let odd = 0;
  const n = Math.min(b.length, 8192);
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0) continue;
    if (i % 2) odd++;
    else even++;
  }
  if (n >= 8 && odd > n / 4 && even < n / 50) return { encoding: 'utf-16le', bom: 0 };
  if (n >= 8 && even > n / 4 && odd < n / 50) return { encoding: 'utf-16be', bom: 0 };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b, { stream: true });
    return { encoding: 'utf-8', bom: 0 };
  } catch {
    return { encoding: 'windows-1252', bom: 0 };
  }
}

// ── Values ──────────────────────────────────────────────────────────────────

const NULLS = new Set(['', 'null', 'NULL', 'Null', 'NA', 'N/A', 'n/a', '#N/A', 'None', 'none', 'nil', 'NaN', 'nan', '-']);
export const isNull = (s: string) => NULLS.has(s.trim());

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const GROUPED = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const DEC_COMMA = /^[+-]?\d+,\d+$/;
const DOT_GROUPED_DEC_COMMA = /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/;

/** A number from a cell ("1,234.5", "$12", "45%", "9,5" with decimal commas), or NaN. */
export function toNumber(raw: string, decimalComma = false): number {
  let s = raw.trim();
  if (!s) return NaN;
  if (NUM.test(s)) return Number(s);
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^[$€£¥₹]\s?|\s?[$€£¥₹%]$/g, '').replace(/^([+-])[$€£¥₹]/, '$1');
  let v = NaN;
  if (NUM.test(s)) v = Number(s);
  else if (GROUPED.test(s)) v = Number(s.replace(/,/g, ''));
  else if (decimalComma && DEC_COMMA.test(s)) v = Number(s.replace(',', '.'));
  else if (decimalComma && DOT_GROUPED_DEC_COMMA.test(s)) v = Number(s.replace(/\./g, '').replace(',', '.'));
  return neg ? -v : v;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_YMD = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const SLASH = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59 || s > 60) return NaN;
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  // Reject days that roll over (31 April).
  return new Date(t).getUTCDate() === d ? t : NaN;
}

/** Milliseconds since 1970 (UTC) for ISO and slash dates, or NaN. `dmy` reads 03/04 as 3 April. */
export function toDate(raw: string, dmy = false): number {
  const s = raw.trim();
  let m = ISO_DATE.exec(s);
  if (m) {
    let t = utc(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7] ? +m[7].slice(0, 3).padEnd(3, '0') : 0);
    const z = m[8];
    if (z && z !== 'Z') {
      const sign = z[0] === '-' ? -1 : 1;
      const hh = +z.slice(1, 3);
      const mm = +z.slice(-2);
      t -= sign * (hh * 60 + mm) * 60000;
    }
    return t;
  }
  m = SLASH_YMD.exec(s);
  if (m) return utc(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = SLASH.exec(s);
  if (m) {
    let y = +m[3]!;
    if (m[3]!.length === 2) y += y < 70 ? 2000 : 1900;
    let h = +(m[4] ?? 0);
    const ap = m[7]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const a = +m[1]!;
    const b = +m[2]!;
    return dmy ? utc(y, b, a, h, +(m[5] ?? 0), +(m[6] ?? 0)) : utc(y, a, b, h, +(m[5] ?? 0), +(m[6] ?? 0));
  }
  return NaN;
}

const BOOL = /^(true|false|yes|no|y|n|t|f)$/i;
export function toBool(s: string): number {
  const v = s.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'y' || v === 't') return 1;
  if (v === 'false' || v === 'no' || v === 'n' || v === 'f') return 0;
  return NaN;
}

/** Column types from up to 20,000 evenly spaced rows. A type needs 97% of the non-empty sample. */
export function inferTypes(t: Table, decimalComma: boolean): ColumnInfo[] {
  const names = t.names();
  const rows = t.rows;
  const base = t.base;
  const step = Math.max(1, Math.floor(rows / 20000));
  const out: ColumnInfo[] = [];
  for (let c = 0; c < t.width; c++) {
    let filled = 0;
    let num = 0;
    let date = 0;
    let bool = 0;
    let dmyVotes = 0;
    let mdyVotes = 0;
    for (let r = 0; r < rows; r += step) {
      const v = t.cell(c, r + base);
      if (isNull(v)) continue;
      filled++;
      if (!Number.isNaN(toNumber(v, decimalComma))) num++;
      else if (BOOL.test(v.trim())) bool++;
      else {
        const s = SLASH.exec(v.trim());
        if (s) {
          if (+s[1]! > 12) dmyVotes++;
          if (+s[2]! > 12) mdyVotes++;
        }
        if (!Number.isNaN(toDate(v, false)) || !Number.isNaN(toDate(v, true))) date++;
      }
    }
    const need = Math.max(1, Math.ceil(filled * 0.97));
    let type: ColType = 'text';
    let fit = 1;
    if (filled === 0) type = 'empty';
    else if (num >= need) {
      type = 'number';
      fit = num / filled;
    } else if (date >= need) {
      type = 'date';
      fit = date / filled;
    } else if (bool >= need) {
      type = 'boolean';
      fit = bool / filled;
    }
    out.push({ name: names[c]!, type, fit, dmy: type === 'date' ? dmyVotes > mdyVotes : undefined });
  }
  return out;
}

/** Whether the first row looks like names rather than data. */
export function looksLikeHeader(t: Table, decimalComma: boolean): boolean {
  if (t.n < 2) return true;
  // Columns added by longer rows further down have no name; judge the first row's own fields.
  const w = Math.max(1, Math.min(t.width, t.firstWidth > 0 ? t.firstWidth : t.width));
  const seen = new Set<string>();
  let numericHeads = 0;
  let typedCols = 0;
  for (let c = 0; c < w; c++) {
    const h = t.cell(c, 0).trim();
    if (!h) return false;
    if (seen.has(h)) return false;
    seen.add(h);
    if (!Number.isNaN(toNumber(h, decimalComma)) || !Number.isNaN(toDate(h))) numericHeads++;
    // A column whose body is numbers under a non-number head is a strong header signal.
    let nums = 0;
    const probe = Math.min(t.n - 1, 20);
    for (let r = 1; r <= probe; r++) if (!Number.isNaN(toNumber(t.cell(c, r), decimalComma))) nums++;
    if (nums === probe && Number.isNaN(toNumber(h, decimalComma))) typedCols++;
  }
  if (numericHeads > 0) return false;
  return typedCols > 0 || w >= 1;
}

// ── Keys, sorting, filtering ────────────────────────────────────────────────

export function sortKeys(t: Table, info: ColumnInfo, c: number, decimalComma: boolean): Float64Array {
  const n = t.n;
  const keys = new Float64Array(n);
  for (let r = 0; r < n; r++) {
    const v = t.cell(c, r);
    keys[r] = info.type === 'number' ? toNumber(v, decimalComma) : info.type === 'date' ? toDate(v, info.dmy) : toBool(v);
  }
  return keys;
}

const FOLD = new Uint8Array(256);
for (let i = 0; i < 256; i++) FOLD[i] = i >= 65 && i <= 90 ? i + 32 : i;

/** Byte comparison with ASCII letters folded (UTF-8 byte order is code point order). */
export function compareCells(t: Table, c: number, a: number, b: number): number {
  const o = t.offs[c]!;
  const bytes = t.cols[c]!.bytes;
  let i = o[a]!;
  const ie = o[a + 1]!;
  let j = o[b]!;
  const je = o[b + 1]!;
  for (; i < ie && j < je; i++, j++) {
    const x = FOLD[bytes[i]!]!;
    const y = FOLD[bytes[j]!]!;
    if (x !== y) return x - y;
  }
  return ie - i - (je - j);
}

/** Rows (absolute indices) in sorted order. Empty cells always last. */
export function sortRows(
  t: Table,
  rows: Uint32Array,
  keys: SortKey[],
  info: ColumnInfo[],
  decimalComma: boolean,
  cache: Map<number, Float64Array>,
): Uint32Array {
  const numeric = keys.map((k) => {
    const type = info[k.col]?.type;
    if (type !== 'number' && type !== 'date' && type !== 'boolean') return null;
    let arr = cache.get(k.col);
    if (!arr) {
      arr = sortKeys(t, info[k.col]!, k.col, decimalComma);
      cache.set(k.col, arr);
    }
    return arr;
  });
  const out = rows.slice();
  out.sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const nk = numeric[i];
      let d: number;
      if (nk) {
        const x = nk[a]!;
        const y = nk[b]!;
        const xn = Number.isNaN(x);
        const yn = Number.isNaN(y);
        if (xn || yn) {
          if (xn && yn) continue;
          return xn ? 1 : -1;
        }
        d = x - y;
      } else {
        const ea = t.cellLength(k.col, a) === 0;
        const eb = t.cellLength(k.col, b) === 0;
        if (ea || eb) {
          if (ea && eb) continue;
          return ea ? 1 : -1;
        }
        d = compareCells(t, k.col, a, b);
      }
      if (d !== 0) return k.desc ? -d : d;
    }
    return a - b;
  });
  return out;
}

type Matcher = (t: Table, r: number) => boolean;

function bytesContain(hay: Uint8Array, a: number, b: number, needle: Uint8Array): boolean {
  const n = needle.length;
  if (n === 0) return true;
  const first = needle[0]!;
  for (let i = a; i + n <= b; i++) {
    if (FOLD[hay[i]!] !== first) continue;
    let k = 1;
    while (k < n && FOLD[hay[i + k]!] === needle[k]) k++;
    if (k === n) return true;
  }
  return false;
}

function foldedNeedle(s: string): { bytes: Uint8Array; ascii: boolean } {
  const lower = s.toLowerCase();
  const bytes = textEncoder.encode(lower);
  let ascii = true;
  for (const b of bytes) if (b > 127) ascii = false;
  return { bytes, ascii };
}

export function containsMatcher(c: number, query: string, negate = false): Matcher {
  const { bytes, ascii } = foldedNeedle(query);
  const lower = query.toLowerCase();
  return (t, r) => {
    const o = t.offs[c]!;
    const hit = ascii ? bytesContain(t.cols[c]!.bytes, o[r]!, o[r + 1]!, bytes) : t.cell(c, r).toLowerCase().includes(lower);
    return negate ? !hit : hit;
  };
}

/**
 * A filter expression for one column:
 *   text      contains (any case)          !text   does not contain
 *   =text     equals exactly               !=text  differs
 *   =         is empty                     !=      is not empty
 *   >5 <5 >=5 <=5, 1..10 (numbers and dates; dates as 2024-01-31)
 *   /regex/   regular expression
 */
export function compileFilter(f: Filter, info: ColumnInfo, decimalComma: boolean): Matcher | string {
  const c = f.col;
  const q = f.query.trim();
  if (!q) return () => true;
  if (q.length > 2 && q.startsWith('/') && q.lastIndexOf('/') > 0) {
    const last = q.lastIndexOf('/');
    try {
      const re = new RegExp(q.slice(1, last), q.slice(last + 1).replace(/[^imsu]/g, '') || 'i');
      return (t, r) => re.test(t.cell(c, r));
    } catch {
      return 'That regular expression is not valid.';
    }
  }
  if (q === '=') return (t, r) => isNull(t.cell(c, r));
  if (q === '!=') return (t, r) => !isNull(t.cell(c, r));
  if (q.startsWith('!=')) {
    const v = q.slice(2).toLowerCase();
    return (t, r) => t.cell(c, r).trim().toLowerCase() !== v;
  }
  if (q.startsWith('=')) {
    const v = q.slice(1).toLowerCase();
    return (t, r) => t.cell(c, r).trim().toLowerCase() === v;
  }
  if (q.startsWith('!')) return containsMatcher(c, q.slice(1), true);
  const typed = info.type === 'number' || info.type === 'date';
  const parse = (s: string) => (info.type === 'date' ? toDate(s, info.dmy) : toNumber(s, decimalComma));
  const range = /^(.+?)\s*\.\.\s*(.+)$/.exec(q);
  if (typed && range) {
    const lo = parse(range[1]!);
    const hi = parse(range[2]!);
    if (Number.isNaN(lo) || Number.isNaN(hi)) return `Use two ${info.type === 'date' ? 'dates' : 'numbers'}, like 1..10.`;
    return (t, r) => {
      const v = parse(t.cell(c, r));
      return v >= lo && v <= hi;
    };
  }
  const cmp = /^(>=|<=|>|<)\s*(.+)$/.exec(q);
  if (cmp) {
    const target = typed ? parse(cmp[2]!) : NaN;
    if (Number.isNaN(target)) {
      if (typed) return `Compare with a ${info.type === 'date' ? 'date like 2024-01-31' : 'number'}.`;
      return 'Comparisons work on number and date columns.';
    }
    const op = cmp[1];
    return (t, r) => {
      const v = parse(t.cell(c, r));
      if (Number.isNaN(v)) return false;
      return op === '>' ? v > target : op === '<' ? v < target : op === '>=' ? v >= target : v <= target;
    };
  }
  return containsMatcher(c, q);
}

/** Rows (absolute indices) passing every filter. */
export function filterRows(t: Table, matchers: Matcher[]): Uint32Array {
  const base = t.base;
  const out = new Uint32Array(t.rows);
  let k = 0;
  outer: for (let r = base; r < t.n; r++) {
    for (const m of matchers) if (!m(t, r)) continue outer;
    out[k++] = r;
  }
  return out.slice(0, k);
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Every cell containing `query` (any case), as absolute (row, col) pairs, by
 * scanning each column's byte pool once and mapping hits back to rows.
 */
export function searchCells(t: Table, query: string, cols: readonly number[], limit: number): { rows: Uint32Array; cols: Uint16Array; capped: boolean } {
  const { bytes: needle, ascii } = foldedNeedle(query);
  const outRows: number[] = [];
  const outCols: number[] = [];
  let capped = false;
  const base = t.base;
  for (const c of cols) {
    const col = t.cols[c]!;
    const o = t.offs[c]!;
    const hay = col.bytes;
    const end = col.len;
    const n = needle.length;
    if (!ascii) {
      const lower = query.toLowerCase();
      for (let r = base; r < t.n; r++) {
        if (t.cell(c, r).toLowerCase().includes(lower)) {
          outRows.push(r);
          outCols.push(c);
        }
      }
      continue;
    }
    const first = needle[0]!;
    const alt = first >= 97 && first <= 122 ? first - 32 : first;
    let r = base;
    const start = o[base]!;
    for (let i = start; i + n <= end; i++) {
      const b = hay[i]!;
      if (b !== first && b !== alt) continue;
      let k = 1;
      while (k < n && FOLD[hay[i + k]!] === needle[k]) k++;
      if (k !== n) continue;
      // Advance r to the row containing byte i (match must lie inside one cell).
      while (r + 1 <= t.n && o[r + 1]! <= i) r++;
      if (i + n > o[r + 1]!) continue;
      outRows.push(r);
      outCols.push(c);
      // Next match in this column starts in the next row.
      i = o[r + 1]! - 1;
      if (outRows.length >= limit) {
        capped = true;
        break;
      }
    }
    if (capped) break;
  }
  return { rows: Uint32Array.from(outRows), cols: Uint16Array.from(outCols), capped };
}

// ── Statistics ──────────────────────────────────────────────────────────────

function hashRange(bytes: Uint8Array, a: number, b: number): number {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = a; i < b; i++) {
    const x = bytes[i]!;
    h1 = Math.imul(h1 ^ x, 0x01000193);
    h2 = Math.imul(h2 ^ x, 0x5bd1e995) ^ (h2 >>> 15);
  }
  return (h1 >>> 0) * 0x100000 + ((h2 >>> 0) & 0xfffff) + (b - a) * 0;
}

const fmtNum = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
const fmtDate = (ms: number) => {
  const d = new Date(ms);
  const iso = d.toISOString();
  return d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds() ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10);
};

/** Statistics of column `c` over `rows` (absolute indices). */
export function columnStats(t: Table, c: number, rows: Uint32Array, info: ColumnInfo, decimalComma: boolean): ColumnStats {
  const started = performance.now();
  const o = t.offs[c]!;
  const bytes = t.cols[c]!.bytes;
  const n = rows.length;
  let nulls = 0;
  let count = 0;
  const DISTINCT_CAP = 2_000_000;
  const seen = new Set<number>();
  let distinctCapped = false;
  const tally = new Map<number, { count: number; row: number }>();
  let tallyOn = true;
  let minLen = Infinity;
  let maxLen = 0;
  let sumLen = 0;
  const typed = info.type === 'number' || info.type === 'date';
  const vals = typed ? new Float64Array(n) : null;
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i]!;
    const a = o[r]!;
    const b = o[r + 1]!;
    const s = decodeRange(bytes, a, b);
    if (isNull(s)) {
      nulls++;
      continue;
    }
    count++;
    const h = hashRange(bytes, a, b);
    if (!distinctCapped) {
      seen.add(h);
      if (seen.size >= DISTINCT_CAP) distinctCapped = true;
    }
    if (tallyOn) {
      const e = tally.get(h);
      if (e) e.count++;
      else {
        tally.set(h, { count: 1, row: r });
        // Mostly unique values: top values say nothing, stop counting.
        if (tally.size > 200_000) tallyOn = false;
      }
    }
    const len = s.length;
    if (len < minLen) minLen = len;
    if (len > maxLen) maxLen = len;
    sumLen += len;
    if (vals) {
      const v = info.type === 'date' ? toDate(s, info.dmy) : toNumber(s, decimalComma);
      if (!Number.isNaN(v)) vals[nv++] = v;
    }
  }
  const stats: ColumnStats = {
    col: c,
    type: info.type,
    rows: n,
    count,
    nulls,
    distinct: seen.size,
    distinctCapped,
    ms: 0,
  };
  if (count) {
    stats.minLength = minLen;
    stats.maxLength = maxLen;
    stats.meanLength = sumLen / count;
  }
  if (tallyOn && tally.size) {
    const top = [...tally.values()].sort((x, y) => y.count - x.count).slice(0, 12);
    if (top[0]!.count > 1 || tally.size <= 12) stats.top = top.map((e) => ({ value: t.cell(c, e.row), count: e.count }));
  }
  if (vals && nv) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < nv; i++) {
      const v = vals[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const mean = sum / nv;
    let sq = 0;
    for (let i = 0; i < nv; i++) sq += (vals[i]! - mean) ** 2;
    const isDate = info.type === 'date';
    stats.min = isDate ? fmtDate(min) : fmtNum(min);
    stats.max = isDate ? fmtDate(max) : fmtNum(max);
    if (!isDate) {
      stats.mean = mean;
      stats.sum = sum;
      stats.std = Math.sqrt(sq / nv);
    }
    const bins = Math.min(24, Math.max(1, Math.ceil(Math.sqrt(nv))));
    const width = (max - min) / bins || 1;
    const counts = new Array<number>(bins).fill(0);
    for (let i = 0; i < nv; i++) counts[Math.min(bins - 1, Math.floor((vals[i]! - min) / width))]!++;
    stats.histogram = counts.map((cnt, i) => {
      const from = min + i * width;
      const to = i === bins - 1 ? max : from + width;
      return { from, to, count: cnt, label: isDate ? `${fmtDate(from)} – ${fmtDate(to)}` : `${fmtNum(from)} – ${fmtNum(to)}` };
    });
  } else if (info.type === 'text' && count) {
    // Text: shortest and longest by length are more telling than byte order.
    stats.min = undefined;
    stats.max = undefined;
  }
  stats.ms = performance.now() - started;
  return stats;
}

// ── Export ──────────────────────────────────────────────────────────────────

const needsQuote = /[",\r\n]|^\s|\s$/;
export function csvCell(s: string, delimiter = ','): string {
  if (needsQuote.test(s) || s.includes(delimiter)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** The rows as CSV text chunks (UTF-8, with a BOM so spreadsheet apps read accents). */
export function exportCsv(t: Table, rows: Uint32Array, cols: readonly number[], names: readonly string[]): string[] {
  const parts: string[] = ['﻿' + cols.map((c) => csvCell(names[c] ?? '')).join(',') + '\r\n'];
  let buf = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    let line = '';
    for (let k = 0; k < cols.length; k++) {
      if (k) line += ',';
      line += csvCell(t.cell(cols[k]!, r));
    }
    buf += line + '\r\n';
    if (buf.length > 1 << 20) {
      parts.push(buf);
      buf = '';
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

export function jsonValue(s: string, info: ColumnInfo | undefined, decimalComma: boolean): unknown {
  if (isNull(s)) return s.trim() === '' ? null : null;
  if (info?.type === 'number') {
    const v = toNumber(s, decimalComma);
    return Number.isFinite(v) ? v : s;
  }
  if (info?.type === 'boolean') {
    const v = toBool(s);
    return Number.isNaN(v) ? s : v === 1;
  }
  return s;
}

/** The rows as a JSON array of objects, in chunks. Numbers and booleans are typed by column. */
export function exportJson(
  t: Table,
  rows: Uint32Array,
  cols: readonly number[],
  names: readonly string[],
  info: readonly ColumnInfo[],
  decimalComma: boolean,
): string[] {
  const keys = cols.map((c) => JSON.stringify(names[c] ?? columnLetter(c)));
  const parts: string[] = ['[\n'];
  let buf = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    let line = '  {';
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k]!;
      if (k) line += ', ';
      line += `${keys[k]}: ${JSON.stringify(jsonValue(t.cell(c, r), info[c], decimalComma))}`;
    }
    buf += line + (i < rows.length - 1 ? '},\n' : '}\n');
    if (buf.length > 1 << 20) {
      parts.push(buf);
      buf = '';
    }
  }
  parts.push(buf + ']\n');
  return parts;
}
