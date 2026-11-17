// Worker-only: builds the HTML that MuPDF lays out.
import type { FontSet } from './fonts';
import type { PageGeometry, TableBlock } from './types';

/**
 * A forced page break. MuPDF only honours page-break-after, and draws the
 * borders and background of the next block on the old page too, so an empty
 * block follows the break to take that hit.
 */
export const PAGE_BREAK = '<div class="mm-page-break"></div><div class="mm-after-break"></div>';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

const RAW_TEXT = new Set(['style', 'script', 'title', 'textarea']);
const MONO = new Set(['pre', 'code', 'kbd', 'samp', 'tt']);

/**
 * Wraps runs of symbols and emoji in spans that name the font that has them.
 * MuPDF falls back per script for letters (and shapes them), but symbols
 * share one "common" script, so they get their font explicitly.
 */
export function wrapSymbolRuns(html: string, fonts: FontSet): string {
  if (fonts.symbolFamily.size === 0) return html;
  let out = '';
  let i = 0;
  let mono = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    const end = lt === -1 ? n : lt;
    if (end > i) out += wrapText(html.slice(i, end), fonts, mono > 0);
    if (lt === -1) break;
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, gt + 1);
    out += tag;
    i = gt + 1;
    const m = /^<(\/?)([a-zA-Z][\w-]*)/.exec(tag);
    if (!m) continue;
    const name = (m[2] as string).toLowerCase();
    const closing = m[1] === '/';
    if (!closing && RAW_TEXT.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      const stop = close === -1 ? n : close;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    if (MONO.has(name) && !tag.endsWith('/>')) mono = Math.max(0, mono + (closing ? -1 : 1));
  }
  return out;
}

function wrapText(text: string, fonts: FontSet, mono: boolean): string {
  if (!/[^\x00-\x7f]/.test(text)) return text;
  let out = '';
  let run = '';
  let runFamily: string | null = null;
  const flush = () => {
    if (run) out += runFamily ? `<span style="font-family:'mm-${runFamily}'">${run}</span>` : run;
    run = '';
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    let family = cp < 0x80 ? null : fonts.wrapFamily(cp, mono);
    if (family === null && runFamily && fonts.joinsRun(cp)) family = runFamily;
    if (family !== runFamily) {
      flush();
      runFamily = family;
    }
    run += ch;
  }
  flush();
  return out;
}

// ── Tables ─────────────────────────────────────────────────────────────────

export type Measure = (text: string, bold: boolean) => number; // width in em

export type TableLayout = {
  widths: number[]; // points, content box
  natural: number; // points the table would like (borders and padding included)
};

export const CELL_PAD_X = 4; // points each side
const MAX_NATURAL_SHARE = 0.45; // one column never asks for more than this share of the line

/** Column widths from the text: natural widths when they fit, otherwise shrink the longest columns first. */
export function measureTable(block: TableBlock, fontSize: number, available: number, measure: Measure): TableLayout {
  const cols = Math.max(block.header?.length ?? 0, ...block.rows.slice(0, 1).map((r) => r.length), ...block.rows.map((r) => r.length));
  const natural = new Array<number>(cols).fill(0);
  const minimum = new Array<number>(cols).fill(0);
  const visit = (row: readonly string[], bold: boolean) => {
    for (let c = 0; c < cols; c++) {
      const text = row[c] ?? '';
      if (!text) continue;
      let widest = 0;
      for (const line of text.split('\n')) widest = Math.max(widest, measure(line, bold));
      let longestWord = 0;
      for (const word of text.split(/\s+/)) if (word.length > 0) longestWord = Math.max(longestWord, measure(word, bold));
      natural[c] = Math.max(natural[c] as number, widest * fontSize);
      minimum[c] = Math.max(minimum[c] as number, longestWord * fontSize);
    }
  };
  if (block.header) visit(block.header, true);
  // Every row up to 50,000 (widths are cached per character, so this is quick), then an odd stride.
  const step = block.rows.length > 50000 ? Math.ceil(block.rows.length / 50000) | 1 : 1;
  for (let r = 0; r < block.rows.length; r += step) visit(block.rows[r] as string[], false);

  const extra = 2 * CELL_PAD_X + 1; // padding and one border per cell
  const room = Math.max(cols * (extra + 10), available) - cols * extra;
  const cap = room * MAX_NATURAL_SHARE;
  const nat = natural.map((w) => Math.max(12, Math.min(w, Math.max(cap, 12))));
  const min = minimum.map((w, c) => Math.max(12, Math.min(w, nat[c] as number, room / Math.max(1, cols) * 1.5)));
  const sumNat = nat.reduce((a, b) => a + b, 0);
  const naturalTotal = natural.reduce((a, b) => a + b, 0) + cols * extra;
  let widths: number[];
  if (sumNat <= room) {
    // Fits: share the spare room out in proportion, so the table spans the line.
    const spare = room - sumNat;
    widths = nat.map((w) => w + (spare * w) / sumNat);
  } else {
    const sumMin = min.reduce((a, b) => a + b, 0);
    if (sumMin >= room) {
      widths = min.map((w) => (w * room) / sumMin);
    } else {
      // Give each column its minimum, then the rest in proportion to what it still wants.
      const want = nat.map((w, c) => w - (min[c] as number));
      const sumWant = want.reduce((a, b) => a + b, 0) || 1;
      const rest = room - sumMin;
      widths = min.map((w, c) => w + (rest * (want[c] as number)) / sumWant);
    }
  }
  return { widths, natural: naturalTotal };
}

export type TableRender = {
  index: number;
  block: TableBlock;
  widths: number[];
  /** Row index where each chunk starts (each chunk is one table on its own page). */
  chunks: number[];
  /** Marker links let the engine find which page each row landed on. */
  markers: boolean;
};

const SUBTABLE_ROWS = 250; // MuPDF lays out long tables much faster in pieces

function rowHtml(cells: readonly string[], widths: number[], align: TableBlock['align'], tag: 'td' | 'th', cls: string, marker: string | null, withWidths: boolean, noTop: boolean): string {
  let marked = marker === null;
  let html = `<tr class="${cls}">`;
  for (let c = 0; c < widths.length; c++) {
    const raw = cells[c] ?? '';
    let content = escapeHtml(raw).replace(/\r?\n/g, '<br>');
    if (!marked && raw.trim() !== '') {
      content = `<a class="mm-mk" href="${marker}">${content}</a>`;
      marked = true;
    }
    const styles: string[] = [];
    if (withWidths) styles.push(`width:${(widths[c] as number).toFixed(2)}pt`);
    const a = align?.[c];
    if (a && a !== 'left') styles.push(`text-align:${a}`);
    if (noTop) styles.push('border-top:none');
    html += `<${tag}${styles.length ? ` style="${styles.join(';')}"` : ''}>${content}</${tag}>`;
  }
  return `${html}</tr>`;
}

export function tableHtml(t: TableRender): string {
  const { block, widths, index } = t;
  const parts: string[] = [];
  if (block.title) parts.push(`<h2 class="mm-table-title">${escapeHtml(block.title)}</h2>`);
  const repeat = block.repeatHeader !== false && !!block.header;
  const starts = repeat && t.chunks.length > 0 ? t.chunks : [0];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k] as number;
    const to = k + 1 < starts.length ? (starts[k + 1] as number) : block.rows.length;
    if (k > 0) parts.push(PAGE_BREAK);
    // Each chunk is split further into sub-tables for layout speed; only the first one has the header.
    for (let s = from; s < to || (s === from && to === from); s += SUBTABLE_ROWS) {
      const first = s === from;
      let html = '<table class="mm-table">';
      if (first && block.header) {
        html += rowHtml(block.header, widths, block.align, 'th', 'mm-head', t.markers ? `#mmh${index}` : null, true, false);
      }
      const stop = Math.min(to, s + SUBTABLE_ROWS);
      for (let r = s; r < stop; r++) {
        const cls = block.zebra && r % 2 === 1 ? 'mm-row mm-odd' : 'mm-row';
        const withWidths = r === s && !(first && block.header);
        html += rowHtml(block.rows[r] as string[], widths, block.align, 'td', cls, t.markers ? `#mmr${index}-${r}` : null, withWidths, !first && r === s);
      }
      parts.push(`${html}</table>`);
      if (to === from) break;
    }
  }
  return parts.join('');
}

export function documentHtml(body: string, css: string, page: PageGeometry, lang?: string): string {
  const m = page.margin;
  const pageCss = `@page{margin:${m.top}pt ${m.right}pt ${m.bottom}pt ${m.left}pt}`;
  const langAttr = lang ? ` lang="${escapeHtml(lang)}"` : '';
  return `<!DOCTYPE html><html${langAttr}><head><meta charset="utf-8"><style>${pageCss}\n${css}\n${BASE_CSS}</style></head><body>${body}</body></html>`;
}

/** Engine CSS that the themes build on (tables made by the engine, page breaks). */
const BASE_CSS = `
.mm-page-break{page-break-after:always;margin:0;padding:0;border:none;height:0}
.mm-after-break{margin:0;padding:0;border:none;height:0}
table.mm-table{border-collapse:collapse;margin:0;table-layout:fixed}
table.mm-table th,table.mm-table td{padding:2.5pt ${CELL_PAD_X}pt;border:0.75pt solid #c8ccd1;vertical-align:baseline;text-align:left}
table.mm-table th{background-color:#eef1f4;font-weight:bold}
table.mm-table tr.mm-odd td{background-color:#f7f8fa}
table.mm-table a.mm-mk{color:#1f2328;text-decoration:none}
table.mm-table th a.mm-mk{color:#1f2328}
h2.mm-table-title{margin:0 0 8pt}
`;
