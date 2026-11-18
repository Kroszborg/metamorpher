'use client';

import { Database01Icon, PlayIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Segmented } from '@/components/kit/segmented';
import { Button } from '@/components/ui/button';
import { WorkerHost } from '@/engines/worker-host';
import { cn } from '@/lib/utils';
import { PanelTitle, Toolbar, ViewerLoading, ViewerProblem } from '../bits';
import { CodeView } from '../code/code-view';
import type { ViewerProps } from '../context';
import type { ColType, SortKey } from '../table/engine';
import { DataGrid, type GridColumn, type Selection } from '../table/grid';
import type { Source, SqliteWorkerApi, TableInfo } from './sqlite.worker';

const BLOCK = 200;
type Tab = 'data' | 'schema' | 'query';

function colType(t: string): ColType {
  const u = t.toUpperCase();
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/.test(u)) return 'number';
  if (/DATE|TIME/.test(u)) return 'date';
  if (/BOOL/.test(u)) return 'boolean';
  return 'text';
}

/** Pages of rows from the worker, cached by block for the grid. */
function useRows(host: WorkerHost<SqliteWorkerApi>, source: Source | null, version: number) {
  const [cache, setCache] = useState<{ key: string; map: Map<number, string[][]> }>({ key: '', map: new Map() });
  const key = `${JSON.stringify(source)}:${version}`;
  const inflight = useRef(new Set<string>());
  const map = cache.key === key ? cache.map : null;
  const getRow = useCallback((pos: number) => map?.get(Math.floor(pos / BLOCK))?.[pos % BLOCK], [map]);
  const onNeedRows = useCallback(
    (from: number, to: number) => {
      if (!source) return;
      for (let b = Math.floor(from / BLOCK); b * BLOCK < to; b++) {
        const k = `${key}:${b}`;
        if (map?.has(b) || inflight.current.has(k)) continue;
        inflight.current.add(k);
        host.call((api) => api.rows(source, b * BLOCK, BLOCK)).then(
          (rows) => {
            inflight.current.delete(k);
            setCache((c) => {
              const base = c.key === key ? c.map : new Map<number, string[][]>();
              return { key, map: new Map(base).set(b, rows) };
            });
          },
          () => inflight.current.delete(k),
        );
      }
    },
    [host, source, key, map],
  );
  return { getRow, onNeedRows };
}

export default function SqliteViewer({ file }: ViewerProps) {
  const host = useMemo(
    () => new WorkerHost<SqliteWorkerApi>(() => new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' })),
    [],
  );
  useEffect(() => () => host.terminate(), [host]);
  const [db, setDb] = useState<{ tables: TableInfo[]; version: string; pageSize: number; encoding: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('data');
  const [sort, setSort] = useState<SortKey[]>([]);
  const [selection, setSelection] = useState<Selection>({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const [sql, setSql] = useState('');
  const [query, setQuery] = useState<{ columns: string[]; count: number; capped: boolean; ms: number; n: number } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let live = true;
    host.call((api) => api.open(file)).then(
      (r) => {
        if (!live) return;
        setDb(r);
        const first = r.tables[0];
        if (first) {
          setCurrent(first.name);
          setSql(`SELECT * FROM "${first.name}" LIMIT 100;`);
        }
      },
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'This database could not be opened.'),
    );
    return () => {
      live = false;
    };
  }, [host, file]);

  const table = db?.tables.find((t) => t.name === current) ?? null;
  const sortCol = sort[0] ? table?.columns[sort[0].col]?.name : undefined;
  const source = useMemo<Source | null>(() => {
    if (tab === 'query') return query ? { kind: 'query' } : null;
    return current ? { kind: 'table', name: current, orderBy: sortCol ? { col: sortCol, desc: !!sort[0]?.desc } : undefined } : null;
  }, [tab, query, current, sortCol, sort]);
  const { getRow, onNeedRows } = useRows(host, source, query?.n ?? 0);

  const columns: GridColumn[] = useMemo(
    () => (tab === 'query' ? (query?.columns ?? []).map((name) => ({ name, type: 'text' as ColType })) : (table?.columns ?? []).map((c) => ({ name: c.name, type: colType(c.type) }))),
    [tab, query, table],
  );
  const order = useMemo(() => columns.map((_, i) => i), [columns]);
  const widths = useMemo(() => columns.map((c) => Math.max(90, Math.min(260, c.name.length * 8 + 80))), [columns]);
  const rowCount = tab === 'query' ? (query?.count ?? 0) : (table?.rows ?? 0);

  const run = () => {
    setRunning(true);
    setQueryError(null);
    host
      .call((api) => api.query(sql))
      .then(
        (r) => setQuery((p) => ({ ...r, n: (p?.n ?? 0) + 1 })),
        (err: unknown) => setQueryError(err instanceof Error ? err.message.replace(/^Error: /, '') : 'The query failed.'),
      )
      .finally(() => setRunning(false));
  };

  const copy = (s: Selection) => {
    const top = Math.min(s.r0, s.r1);
    const bottom = Math.max(s.r0, s.r1);
    const left = Math.min(s.c0, s.c1);
    const right = Math.max(s.c0, s.c1);
    if (!source || bottom - top > 50_000) return;
    host.call((api) => api.rows(source, top, bottom - top + 1)).then(
      (rows) =>
        navigator.clipboard.writeText(rows.map((r) => r.slice(left, right + 1).join('\t')).join('\n')).then(
          () => toast.success('Copied'),
          () => toast.error('Copy failed.'),
        ),
      () => undefined,
    );
  };

  if (error) return <ViewerProblem title="This database could not be opened">{error}</ViewerProblem>;
  if (!db) return <ViewerLoading label="Opening the database (SQLite engine, about 0.7 MB, loads once)…" />;
  if (!db.tables.length) return <ViewerProblem tone="neutral" title="This database has no tables">It is a valid SQLite file with nothing in it yet.</ViewerProblem>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          label="View"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setSelection({ r0: 0, c0: 0, r1: 0, c1: 0 });
          }}
          options={[
            { value: 'data', label: 'Data' },
            { value: 'schema', label: 'Schema' },
            { value: 'query', label: 'Query' },
          ]}
        />
        <span className="text-xs text-muted-foreground">Read-only: nothing in the file can be changed.</span>
      </Toolbar>
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav aria-label="Tables" className="flex shrink-0 flex-col border-r bg-card max-md:max-h-40 max-md:border-r-0 max-md:border-b md:w-56">
          <PanelTitle>Tables · {db.tables.length}</PanelTitle>
          <ul className="min-h-0 flex-1 overflow-auto p-1">
            {db.tables.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(t.name);
                    setSort([]);
                    setSelection({ r0: 0, c0: 0, r1: 0, c1: 0 });
                    if (tab === 'query') setTab('data');
                  }}
                  aria-current={t.name === current ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
                    t.name === current && 'bg-primary/12 font-medium',
                  )}
                >
                  <HugeiconsIcon icon={Database01Icon} strokeWidth={1.9} className={cn('size-3.5 shrink-0', t.type === 'view' ? 'text-viz-2' : 'text-primary')} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{t.rows === null ? '?' : t.rows.toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tab === 'schema' ? (
            <CodeView
              text={db.tables.map((t) => `${t.sql || `-- ${t.name}`};`).join('\n\n')}
              language="sql"
              wrap
              label="Database schema"
            />
          ) : (
            <>
              {tab === 'query' ? (
                <div className="flex flex-col gap-2 border-b bg-card p-2">
                  <textarea
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        run();
                      }
                    }}
                    rows={4}
                    spellCheck={false}
                    aria-label="SQL query"
                    className="w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Button size="lg" onClick={run} disabled={running || !sql.trim()}>
                      <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                      Run (Ctrl+Enter)
                    </Button>
                    {queryError ? <span className="text-destructive">{queryError}</span> : null}
                    {query && !queryError ? (
                      <span className="tabular-nums">
                        {query.count.toLocaleString()} rows{query.capped ? ' (first 200,000)' : ''} in {Math.round(query.ms)} ms
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {columns.length && source ? (
                <DataGrid
                  key={JSON.stringify(source) + (query?.n ?? 0)}
                  label={tab === 'query' ? 'Query results' : `Table ${current ?? ''}`}
                  rowCount={rowCount}
                  columns={columns}
                  order={order}
                  widths={widths}
                  frozen={0}
                  getRow={getRow}
                  onNeedRows={onNeedRows}
                  sort={tab === 'data' ? sort : []}
                  onSort={tab === 'data' ? (col) => setSort((s) => (s[0]?.col === col ? (s[0].desc ? [] : [{ col, desc: true }]) : [{ col, desc: false }])) : undefined}
                  showFilters={false}
                  selection={selection}
                  onSelection={setSelection}
                  onCopy={copy}
                />
              ) : (
                <ViewerProblem tone="neutral" title={tab === 'query' ? 'Run a query to see its results' : 'Nothing to show'}>
                  {tab === 'query' ? 'Only reading statements work; the database is opened read-only.' : null}
                </ViewerProblem>
              )}
            </>
          )}
        </div>
      </div>
      <footer className="flex flex-wrap gap-x-3 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span>SQLite {db.version}</span>
        <span className="tabular-nums">
          {db.tables.filter((t) => t.type === 'table').length} tables · {db.tables.filter((t) => t.type === 'view').length} views
        </span>
        {table && tab === 'data' ? (
          <span className="tabular-nums">
            {table.name}: {table.rows?.toLocaleString() ?? '?'} rows × {table.columns.length} columns
          </span>
        ) : null}
        <span>{db.encoding}</span>
      </footer>
    </div>
  );
}
