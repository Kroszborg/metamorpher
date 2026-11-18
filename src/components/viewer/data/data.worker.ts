/// <reference lib="webworker" />
/**
 * The data viewer's worker: parses JSON, NDJSON, YAML, TOML and XML into a
 * flat node table and serves tree rows, search, paths and conversions.
 */
import { expose } from 'comlink';
import { fromValue, fromXml, lineCol, NodeTable, pathsOf, T, toValue, toXml, TreeView, XmlError } from './tree';

export type DataFormat = 'json' | 'ndjson' | 'yaml' | 'toml' | 'xml';

export type OpenResult =
  | { ok: true; nodes: number; visible: number; ms: number; chars: number; lines: number; docs: number }
  | { ok: false; message: string; line: number | null; column: number | null; text: string | null };

export type Row = {
  id: number;
  depth: number;
  key: string | null;
  index: number;
  type: number;
  value: string | null;
  count: number;
  expanded: boolean;
};

/** Text views are offered up to this size; beyond it they are downloads. */
const TEXT_LIMIT = 24 * 1024 * 1024;
const PREVIEW = 400;

let text = '';
let format: DataFormat = 'json';
let table: NodeTable | null = null;
let view: TreeView | null = null;
let value: unknown = undefined;
let docs = 1;

function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return new TextDecoder('windows-1252').decode(bytes.subarray(start));
  }
}

/** Where JSON.parse failed: V8 says "at position N" (and sometimes the line and column). */
function jsonErrorAt(err: unknown, src: string): { line: number | null; column: number | null; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return { line: +lc[1]!, column: +lc[2]!, message: message.replace(/\s*\(line \d+ column \d+\)/, '') };
  const pos = /position (\d+)/.exec(message);
  if (pos) return { ...lineCol(src, +pos[1]!), message };
  if (/Unexpected end of JSON input/.test(message)) return { ...lineCol(src, src.length), message: 'The JSON ends too early (a bracket or quote is not closed).' };
  return { line: null, column: null, message };
}

function countLines(s: string): number {
  let n = 1;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

const api = {
  async open(file: Blob, fmt: DataFormat): Promise<OpenResult> {
    const started = performance.now();
    text = decode(new Uint8Array(await file.arrayBuffer()));
    format = fmt;
    table = null;
    view = null;
    value = undefined;
    docs = 1;
    const fail = (message: string, line: number | null, column: number | null): OpenResult => ({
      ok: false,
      message,
      line,
      column,
      text: text.length <= TEXT_LIMIT ? text : null,
    });
    try {
      if (fmt === 'xml') {
        table = fromXml(text);
      } else if (fmt === 'ndjson') {
        const items: unknown[] = [];
        let lineNo = 0;
        for (const line of text.split('\n')) {
          lineNo++;
          if (!line.trim()) continue;
          try {
            items.push(JSON.parse(line));
          } catch (err) {
            const at = jsonErrorAt(err, line);
            return fail(`Line ${lineNo} is not valid JSON: ${at.message}`, lineNo, at.column);
          }
        }
        value = items;
        table = fromValue(items);
      } else if (fmt === 'yaml') {
        const yaml = await import('js-yaml');
        try {
          const all: unknown[] = [];
          yaml.loadAll(text, (d) => all.push(d));
          docs = all.length;
          value = all.length === 1 ? all[0] : all;
        } catch (err) {
          const e = err as { reason?: string; mark?: { line: number; column: number }; message?: string };
          return fail(e.reason ? `${e.reason[0]!.toUpperCase()}${e.reason.slice(1)}.` : (e.message ?? 'This is not valid YAML.'), e.mark ? e.mark.line + 1 : null, e.mark ? e.mark.column + 1 : null);
        }
        table = fromValue(value);
      } else if (fmt === 'toml') {
        const toml = await import('smol-toml');
        try {
          value = toml.parse(text);
        } catch (err) {
          const e = err as { line?: number; column?: number; message?: string };
          return fail((e.message ?? 'This is not valid TOML.').split('\n')[0]!, e.line ?? null, e.column ?? null);
        }
        table = fromValue(value);
      } else {
        try {
          value = JSON.parse(text);
        } catch (err) {
          const at = jsonErrorAt(err, text);
          return fail(at.message, at.line, at.column);
        }
        table = fromValue(value);
      }
    } catch (err) {
      if (err instanceof XmlError) {
        const at = lineCol(text, err.offset);
        return fail(err.message, at.line, at.column);
      }
      throw err;
    }
    const level = table.n < 2000 ? 3 : table.n < 50000 ? 2 : 1;
    view = new TreeView(table, level);
    return {
      ok: true,
      nodes: table.n,
      visible: view.visible.length,
      ms: performance.now() - started,
      chars: text.length,
      lines: countLines(text),
      docs,
    };
  },

  rows(from: number, count: number): Row[] {
    const t = table;
    const v = view;
    if (!t || !v) return [];
    const out: Row[] = [];
    for (let p = from; p < Math.min(v.visible.length, from + count); p++) {
      const id = v.visible[p]!;
      const raw = t.value[id] ?? null;
      out.push({
        id,
        depth: t.depth[id]!,
        key: t.key[id] ?? null,
        index: t.index[id]!,
        type: t.type[id]!,
        value: raw !== null && raw.length > PREVIEW ? `${raw.slice(0, PREVIEW)}…` : raw,
        count: t.isContainer(id) ? t.childCount(id) : 0,
        expanded: !!v.expanded[id],
      });
    }
    return out;
  },

  toggle(pos: number, open?: boolean): number {
    view?.toggle(pos, open);
    return view?.visible.length ?? 0;
  },

  level(n: number): number {
    view?.setLevel(n);
    return view?.visible.length ?? 0;
  },

  /** Node ids whose key or value contains `query` (any case), in document order. */
  search(query: string, scope: 'all' | 'keys' | 'values'): { ids: Int32Array; capped: boolean } {
    const t = table;
    if (!t || !query) return { ids: new Int32Array(0), capped: false };
    const q = query.toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < t.n; i++) {
      const k = t.key[i];
      const v = t.value[i];
      if ((scope !== 'values' && k && k.toLowerCase().includes(q)) || (scope !== 'keys' && v !== null && v !== undefined && v.toLowerCase().includes(q))) {
        out.push(i);
        if (out.length >= 200_000) return { ids: Int32Array.from(out), capped: true };
      }
    }
    return { ids: Int32Array.from(out), capped: false };
  },

  reveal(id: number): { pos: number; visible: number } {
    const pos = view?.reveal(id) ?? -1;
    return { pos, visible: view?.visible.length ?? 0 };
  },

  /** The ancestor rows of a node (for the breadcrumb) and its paths. */
  paths(id: number) {
    if (!table) return null;
    return pathsOf(table, id);
  },

  /** A node's value as pretty JSON (or the text of a primitive), for copying. */
  valueText(id: number): string {
    if (!table) return '';
    const type = table.type[id];
    if (type === T.string || type === T.text || type === T.attr) return table.value[id] ?? '';
    if (!table.isContainer(id)) return table.value[id] ?? '';
    return JSON.stringify(toValue(table, id), null, 2);
  },

  /** The document as text: the original, pretty-printed or minified (JSON-like formats). Null when too large. */
  text(mode: 'original' | 'pretty' | 'minified'): string | null {
    if (mode === 'original') return text.length <= TEXT_LIMIT ? text : null;
    if (format === 'xml') {
      if (!table) return null;
      const v = toValue(table, 0);
      const out = mode === 'pretty' ? toXml({ [table.key[0] ?? 'root']: v }) : toXml({ [table.key[0] ?? 'root']: v }).replace(/>\s+</g, '><');
      return out.length <= TEXT_LIMIT ? out : null;
    }
    const out = mode === 'pretty' ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    return out !== undefined && out.length <= TEXT_LIMIT ? out : null;
  },

  /** The text of `mode` as a file, with no size limit. */
  textBlob(mode: 'original' | 'pretty' | 'minified'): Blob {
    if (mode === 'original' || format === 'xml') return new Blob([mode === 'original' ? text : (api.text(mode) ?? text)], { type: 'text/plain;charset=utf-8' });
    return new Blob([mode === 'pretty' ? JSON.stringify(value, null, 2) : JSON.stringify(value)], { type: 'application/json' });
  },

  /** The whole document converted. Notes say what does not carry over. */
  async convert(to: 'json' | 'yaml' | 'xml' | 'csv'): Promise<{ text: string; notes: string[] }> {
    const notes: string[] = [];
    const data = format === 'xml' && table ? { [table.key[0] ?? 'root']: toValue(table, 0) } : value;
    if (format === 'xml') notes.push('XML attributes become "@name" keys and mixed text becomes "#text"; comments are dropped.');
    if (to === 'json') return { text: JSON.stringify(data, null, 2), notes };
    if (to === 'yaml') {
      const yaml = await import('js-yaml');
      if (format === 'yaml' && docs > 1) notes.push(`${docs} YAML documents are written as one list.`);
      return { text: yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), notes };
    }
    if (to === 'csv') {
      const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : null;
      if (!rows || !rows.length) throw new Error('A table needs a list of records, like [{"a": 1}, {"a": 2}].');
      const cols = [...new Set(rows.flatMap((r) => (r && typeof r === 'object' && !Array.isArray(r) ? Object.keys(r) : ['value'])))];
      const cell = (v: unknown) => {
        const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [cols.map(cell).join(',')];
      for (const r of rows) {
        const o: Record<string, unknown> = r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : { value: r };
        lines.push(cols.map((c) => cell(o[c])).join(','));
      }
      if (rows.some((r) => r && typeof r === 'object' && Object.values(r).some((v) => v && typeof v === 'object')))
        notes.push('Nested objects and lists are written as JSON inside the cells.');
      return { text: lines.join('\r\n') + '\r\n', notes };
    }
    if (Array.isArray(data)) notes.push('The top-level list is wrapped in <root> with one <item> per entry.');
    notes.push('XML has no types: numbers, booleans and null become text.');
    return { text: toXml(data), notes };
  },
};

export type DataWorkerApi = typeof api;
expose(api);
