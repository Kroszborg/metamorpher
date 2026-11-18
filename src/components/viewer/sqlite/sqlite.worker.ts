/// <reference lib="webworker" />
/**
 * SQLite viewer worker: sql.js (SQLite in WebAssembly, MIT) from
 * /vendor/sqljs, opened read-only (PRAGMA query_only), serving table pages
 * and the results of the person's own SELECT queries.
 */
import { expose } from 'comlink';

type SqlValue = number | string | Uint8Array | null;
type QueryExecResult = { columns: string[]; values: SqlValue[][] };
type Statement = { bind(v: SqlValue[]): boolean; step(): boolean; get(): SqlValue[]; getColumnNames(): string[]; free(): void };
type Database = { exec(sql: string): QueryExecResult[]; prepare(sql: string): Statement; close(): void };
type SqlJs = { Database: new (data?: Uint8Array) => Database };
type Init = (o: { locateFile: (f: string) => string }) => Promise<SqlJs>;

export type TableInfo = { name: string; type: 'table' | 'view'; rows: number | null; sql: string; columns: { name: string; type: string; pk: boolean; notnull: boolean }[] };
export type Source = { kind: 'table'; name: string; orderBy?: { col: string; desc: boolean } } | { kind: 'query' };

const vendor = (path: string) => new URL(`/vendor/sqljs/${path}`, self.location.origin).href;
const QUERY_CAP = 200_000;

let db: Database | null = null;
let result: { columns: string[]; rows: string[][]; capped: boolean } | null = null;

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
function text(v: SqlValue): string {
  if (v === null) return '';
  if (v instanceof Uint8Array) return `<${v.length.toLocaleString()} bytes>`;
  return String(v);
}

const api = {
  async open(file: Blob): Promise<{ tables: TableInfo[]; version: string; pageSize: number; encoding: string }> {
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ vendor('sql-wasm.mjs'))) as { default: Init };
    const SQL = await mod.default({ locateFile: (f) => vendor(f) });
    db?.close();
    try {
      db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
      db.exec('PRAGMA query_only = ON');
      const list = db.exec("SELECT name, type, coalesce(sql, '') FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name");
      const tables: TableInfo[] = (list[0]?.values ?? []).map(([name, type, sql]) => {
        const n = String(name);
        let rows: number | null = null;
        try {
          rows = Number(db!.exec(`SELECT count(*) FROM ${q(n)}`)[0]?.values[0]?.[0] ?? 0);
        } catch {
          rows = null;
        }
        const cols = (db!.exec(`PRAGMA table_info(${q(n)})`)[0]?.values ?? []).map((c) => ({
          name: String(c[1]),
          type: String(c[2] ?? ''),
          notnull: c[3] === 1,
          pk: Number(c[5]) > 0,
        }));
        return { name: n, type: type === 'view' ? 'view' : 'table', rows, sql: String(sql), columns: cols };
      });
      const version = String(db.exec('SELECT sqlite_version()')[0]?.values[0]?.[0] ?? '');
      const pageSize = Number(db.exec('PRAGMA page_size')[0]?.values[0]?.[0] ?? 0);
      const encoding = String(db.exec('PRAGMA encoding')[0]?.values[0]?.[0] ?? '');
      return { tables, version, pageSize, encoding };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not a database|malformed|encrypted/i.test(msg)) throw new Error('This is not a readable SQLite database: it may be damaged or encrypted.');
      throw new Error(msg);
    }
  },

  rows(source: Source, offset: number, limit: number): string[][] {
    if (source.kind === 'query') return result ? result.rows.slice(offset, offset + limit) : [];
    if (!db) return [];
    const order = source.orderBy ? ` ORDER BY ${q(source.orderBy.col)} ${source.orderBy.desc ? 'DESC' : 'ASC'}` : '';
    const st = db.prepare(`SELECT * FROM ${q(source.name)}${order} LIMIT ? OFFSET ?`);
    const out: string[][] = [];
    try {
      st.bind([limit, offset]);
      while (st.step()) out.push(st.get().map(text));
    } finally {
      st.free();
    }
    return out;
  },

  /** Runs a read-only query; writes fail because the database is opened with query_only. */
  query(sql: string): { columns: string[]; count: number; capped: boolean; ms: number } {
    if (!db) throw new Error('No database is open.');
    const started = performance.now();
    const st = db.prepare(sql);
    const rows: string[][] = [];
    let capped = false;
    try {
      while (st.step()) {
        if (rows.length >= QUERY_CAP) {
          capped = true;
          break;
        }
        rows.push(st.get().map(text));
      }
      result = { columns: st.getColumnNames(), rows, capped };
    } finally {
      st.free();
    }
    return { columns: result.columns, count: rows.length, capped, ms: performance.now() - started };
  },
};

export type SqliteWorkerApi = typeof api;
expose(api);
