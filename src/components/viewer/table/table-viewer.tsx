'use client';

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ChartHistogramIcon,
  Download04Icon,
  FilterIcon,
  LeftToRightListBulletIcon,
  Search01Icon,
  Settings02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { proxy } from 'comlink';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WorkerHost } from '@/engines/worker-host';
import { baseName, downloadBlob } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, Toolbar, ToolbarSep, ViewerLoading, ViewerProblem } from '../bits';
import { type Shortcut, useKeys, useShortcuts, type ViewerProps } from '../context';
import type { ColumnStats, SortKey } from './engine';
import { DataGrid, type GridHandle, HeaderMenuIcon, type Selection } from './grid';
import { RowPanel, StatsPanel } from './panels';
import type { OpenOptions, SearchResult, TableMeta, TableWorkerApi } from './table.worker';

const BLOCK = 200;
const SHORTCUTS: Shortcut[] = [
  { keys: '↑  ↓  ←  →', label: 'Move between cells (grid focused)' },
  { keys: 'Shift + arrows', label: 'Select a range' },
  { keys: 'Ctrl + C', label: 'Copy the selection (tab-separated)' },
  { keys: 'Ctrl + A', label: 'Select everything' },
  { keys: 'Enter', label: 'Show the row in detail' },
  { keys: 'PgUp  PgDn', label: 'Page up or down' },
  { keys: 'Ctrl + Home  Ctrl + End', label: 'First or last row' },
  { keys: '/', label: 'Search' },
  { keys: 'F3  Shift + F3', label: 'Next or previous match' },
  { keys: 'Shift + click a header', label: 'Add a sort level' },
];

const DELIMS = [
  { value: 'auto', label: 'Detect' },
  { value: ',', label: 'Comma ,' },
  { value: ';', label: 'Semicolon ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe |' },
  { value: ':', label: 'Colon :' },
  { value: ' ', label: 'Space' },
];
const QUOTES = [
  { value: 'auto', label: 'Detect' },
  { value: '"', label: 'Double "' },
  { value: "'", label: "Single '" },
  { value: '', label: 'None' },
];
const ENCODINGS = [
  { value: 'auto', label: 'Detect' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1252', label: 'Windows-1252' },
  { value: 'iso-8859-2', label: 'ISO-8859-2' },
  { value: 'windows-1251', label: 'Windows-1251' },
  { value: 'shift_jis', label: 'Shift JIS' },
  { value: 'gbk', label: 'GBK' },
  { value: 'big5', label: 'Big5' },
  { value: 'euc-kr', label: 'EUC-KR' },
];
const delimName = (d: string) => DELIMS.find((x) => x.value === d)?.label.replace(/ .$/, '') ?? JSON.stringify(d);

const WORKBOOK = /^(xlsx|xlsm|xlsb|xls|ods|fods)$/;

type Panel = { kind: 'stats'; col: number } | { kind: 'row'; pos: number } | null;
type Block = { rows: string[][]; count: number };

function autoWidth(name: string, samples: string[], numeric: boolean): number {
  let len = 0;
  for (const s of samples) len = Math.max(len, Math.min(s.length, 48));
  // The header also holds the type badge and the menu button.
  const head = Math.min(name.length, 28) * 7.2 + 84;
  return Math.round(Math.max(72, Math.min(numeric ? 220 : 340, Math.max(head, len * 7.4 + 26))));
}

export default function TableViewer({ file, sniff }: ViewerProps) {
  const host = useMemo(
    () => new WorkerHost<TableWorkerApi>(() => new Worker(new URL('./table.worker.ts', import.meta.url), { type: 'module' })),
    [],
  );
  useEffect(() => () => host.terminate(), [host]);
  const kind = WORKBOOK.test(sniff.ext) ? 'workbook' : 'csv';
  const [opts, setOpts] = useState<OpenOptions>({ delimiter: 'auto', quote: 'auto', encoding: 'auto', header: 'auto', sheet: 0 });
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [viewMs, setViewMs] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey[]>([]);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [filterError, setFilterError] = useState<{ col: number; message: string } | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [colOrder, setColOrder] = useState<number[]>([]);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [widths, setWidths] = useState<number[]>([]);
  const [frozen, setFrozen] = useState(0);
  const [selection, setSelection] = useState<Selection>({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const [panel, setPanel] = useState<Panel>(null);
  const [stats, setStats] = useState<ColumnStats | null>(null);
  const [rowValues, setRowValues] = useState<{ pos: number; values: string[]; source: number } | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<(SearchResult & { query: string }) | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocks = useRef(new Map<number, Block>());
  const inflight = useRef(new Set<string>());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const grid = useRef<GridHandle>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const sized = useRef(false);
  useShortcuts(SHORTCUTS);

  const rows = meta?.rows ?? 0;
  const count = viewCount ?? rows;
  const columns = useMemo(() => meta?.columns ?? [], [meta]);
  const names = useMemo(() => columns.map((c) => c.name), [columns]);
  const order = useMemo(() => colOrder.filter((c) => !hidden.has(c) && c < columns.length), [colOrder, hidden, columns.length]);
  const filtering = Object.values(filters).some((q) => q.trim());
  const done = !!meta?.done;

  // Open (and re-open when the parse options change).
  useEffect(() => {
    let live = true;
    blocks.current = new Map();
    inflight.current = new Set();
    sized.current = false;
    host
      .call((api) =>
        api.open(
          file,
          kind,
          opts,
          proxy((m: TableMeta) => {
            if (live) setMeta(m);
          }),
        ),
      )
      .then(
        (m) => {
          if (!live) return;
          setMeta(m);
          setError(null);
        },
        (err: unknown) => {
          if (live && !(err instanceof DOMException && err.name === 'AbortError'))
            setError(err instanceof Error ? err.message : 'This file could not be read as a table.');
        },
      );
    return () => {
      live = false;
    };
  }, [host, file, kind, opts]);

  // New columns appear in order (ragged rows can add some while reading).
  const width = columns.length;
  useEffect(() => {
    if (!width) return;
    queueMicrotask(() => {
      setColOrder((prev) => (prev.length >= width ? prev.filter((c) => c < width) : [...prev, ...Array.from({ length: width - prev.length }, (_, i) => prev.length + i)]));
      setWidths((prev) => (prev.length >= width ? prev : [...prev, ...Array.from({ length: width - prev.length }, () => 140)]));
    });
  }, [width]);

  const resetView = useCallback(() => {
    blocks.current = new Map();
    inflight.current = new Set();
    setVersion((v) => v + 1);
  }, []);

  // Sort and filter in the worker once the file has been read.
  const filterKey = JSON.stringify(filters);
  const sortKey = JSON.stringify(sort);
  useEffect(() => {
    if (!done) return;
    const list = Object.entries(filters).map(([col, q]) => ({ col: Number(col), query: q }));
    if (!sort.length && !list.some((f) => f.query.trim())) {
      queueMicrotask(() => {
        setViewCount(null);
        setViewMs(null);
        setFilterError(null);
      });
      host.call((api) => api.setView([], [])).then(resetView, () => undefined);
      return;
    }
    let live = true;
    const t = setTimeout(
      () => {
        setBusy(true);
        host
          .call((api) => api.setView(sort, list))
          .then(
            (res) => {
              if (!live) return;
              setFilterError(res.error ?? null);
              if (res.error) return;
              setViewCount(res.count);
              setViewMs(res.ms);
              setMatches(null);
              resetView();
              setSelection((s) => ({ ...s, r0: 0, r1: 0 }));
            },
            (err: unknown) => live && toast.error(err instanceof Error ? err.message : 'Sorting failed.'),
          )
          .finally(() => live && setBusy(false));
      },
      list.some((f) => f.query.trim()) ? 220 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
    // filterKey / sortKey stand for the objects' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, filterKey, sortKey, host, resetView]);

  const onNeedRows = useCallback(
    (from: number, to: number) => {
      const b0 = Math.max(0, Math.floor(from / BLOCK) - 1);
      const b1 = Math.floor(Math.min(count - 1, to) / BLOCK) + 1;
      for (let b = b0; b <= b1; b++) {
        if (b * BLOCK >= count) break;
        const have = blocks.current.get(b);
        if (have && (have.rows.length === BLOCK || have.count >= count)) continue;
        const key = `${version}:${b}:${count}`;
        if (inflight.current.has(key)) continue;
        inflight.current.add(key);
        const map = blocks.current;
        const c = count;
        host.call((api) => api.rows(b * BLOCK, BLOCK)).then(
          (rowsData) => {
            inflight.current.delete(key);
            // A newer view replaced the cache meanwhile.
            if (map !== blocks.current) return;
            map.set(b, { rows: rowsData, count: c });
            if (!sized.current && b === 0 && rowsData.length) {
              sized.current = true;
              const sample = rowsData.slice(0, 60);
              setWidths(columns.map((col, i) => autoWidth(col.name, sample.map((r) => r[i] ?? ''), col.type === 'number')));
            }
            bump();
          },
          () => inflight.current.delete(key),
        );
      }
    },
    [count, version, host, columns],
  );

  const getRow = useCallback((pos: number) => {
    const b = blocks.current.get(Math.floor(pos / BLOCK));
    return b?.rows[pos % BLOCK];
  }, []);

  // Statistics for the chosen column, over the current view.
  const statsCol = panel?.kind === 'stats' ? panel.col : null;
  useEffect(() => {
    if (statsCol === null || !done) return;
    let live = true;
    queueMicrotask(() => live && setStats(null));
    host.call((api) => api.stats(statsCol)).then(
      (s) => live && setStats(s),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [statsCol, done, host, version]);

  const rowPos = panel?.kind === 'row' ? panel.pos : null;
  useEffect(() => {
    if (rowPos === null) return;
    let live = true;
    Promise.all([host.call((api) => api.rows(rowPos, 1)), host.call((api) => api.sourceRow(rowPos))]).then(
      ([r, source]) => live && r[0] && setRowValues({ pos: rowPos, values: r[0], source }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rowPos, host, version]);

  const onSort = useCallback(
    (col: number, add: boolean) => {
      if (!done) {
        toast.message('Sorting is ready once the whole file has been read.');
        return;
      }
      setSort((prev) => {
        const i = prev.findIndex((s) => s.col === col);
        const cur = prev[i];
        const next = !cur ? { col, desc: false } : !cur.desc ? { col, desc: true } : null;
        if (add) {
          const copy = prev.filter((s) => s.col !== col);
          if (next) copy.splice(i >= 0 ? i : copy.length, 0, next);
          return copy;
        }
        return next ? [next] : [];
      });
    },
    [done],
  );

  const setFilter = useCallback((col: number, q: string) => setFilters((f) => ({ ...f, [col]: q })), []);

  const runSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setMatches(null);
        return;
      }
      setSearching(true);
      host
        .call((api) => api.search(q, order))
        .then(
          (res) => {
            setMatches({ ...res, query: q });
            setMatchIndex(0);
            const pos = res.positions[0];
            if (pos !== undefined) {
              const d = order.indexOf(res.cols[0]!);
              setSelection({ r0: pos, c0: d, r1: pos, c1: d });
              grid.current?.reveal(pos, d, true);
            }
          },
          () => undefined,
        )
        .finally(() => setSearching(false));
    },
    [host, order],
  );

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => runSearch(query), query ? 300 : 0);
    return () => clearTimeout(t);
    // Search again when the view changes, not when `runSearch` is recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, done, version]);

  const stepMatch = useCallback(
    (dir: 1 | -1) => {
      if (!matches || !matches.positions.length) return;
      const i = (matchIndex + dir + matches.positions.length) % matches.positions.length;
      setMatchIndex(i);
      const pos = matches.positions[i]!;
      const d = order.indexOf(matches.cols[i]!);
      setSelection({ r0: pos, c0: d, r1: pos, c1: d });
      grid.current?.reveal(pos, d, true);
    },
    [matches, matchIndex, order],
  );

  const copySel = useCallback(
    (s: Selection) => {
      const top = Math.min(s.r0, s.r1);
      const bottom = Math.max(s.r0, s.r1);
      const cols = order.slice(Math.min(s.c0, s.c1), Math.max(s.c0, s.c1) + 1);
      const cells = (bottom - top + 1) * cols.length;
      if (cells > 2_000_000) {
        toast.error('Select at most 2 million cells to copy, or export the view instead.');
        return;
      }
      host
        .call((api) => api.range(top, bottom, cols, false))
        .then((text) => navigator.clipboard.writeText(text))
        .then(
          () => toast.success(cells === 1 ? 'Copied the cell' : `Copied ${(bottom - top + 1).toLocaleString()} × ${cols.length} cells`),
          () => toast.error('Copy failed.'),
        );
    },
    [host, order],
  );

  const exportAs = useCallback(
    (format: 'csv' | 'json' | 'xlsx') => {
      setBusy(true);
      host
        .call((api) => api.exportView(format, order))
        .then(
          (blob) => {
            const suffix = filtering || sort.length || hidden.size ? '-view' : '';
            const sheet = meta?.kind === 'workbook' && meta.sheets.length > 1 ? `-${meta.sheets[meta.sheet]}` : '';
            downloadBlob(blob, `${baseName(file.name) || 'table'}${sheet}${suffix}.${format}`);
          },
          (err: unknown) => toast.error(err instanceof Error ? err.message : 'Export failed.'),
        )
        .finally(() => setBusy(false));
    },
    [host, order, filtering, sort.length, hidden.size, meta, file.name],
  );

  const gridKey = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        searchBox.current?.focus();
        return true;
      }
      if (e.key === 'F3') {
        stepMatch(e.shiftKey ? -1 : 1);
        return true;
      }
      if (e.key === '/') {
        searchBox.current?.focus();
        return true;
      }
      return false;
    },
    [stepMatch],
  );

  const docKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        searchBox.current?.focus();
        return true;
      }
      if (e.key === 'F3') {
        stepMatch(e.shiftKey ? -1 : 1);
        return true;
      }
      return false;
    },
    [stepMatch],
  );
  useKeys(docKey);

  const moveCol = useCallback(
    (from: number, to: number) => {
      // `from`/`to` are display indexes among visible columns.
      const a = order[from];
      const b = order[to];
      if (a === undefined || b === undefined) return;
      setColOrder((prev) => {
        const next = prev.filter((c) => c !== a);
        const at = next.indexOf(b);
        next.splice(from < to ? at + 1 : at, 0, a);
        return next;
      });
    },
    [order],
  );

  const columnMenu = useCallback(
    (col: number) => {
      const d = order.indexOf(col);
      const s = sort.find((x) => x.col === col);
      return (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Column options for ${names[col] ?? ''}`}
            className="grid size-6 place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <HeaderMenuIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">{names[col]}</DropdownMenuLabel>
            <DropdownMenuItem disabled={!done} onSelect={() => setSort([{ col, desc: false }])}>
              Sort ascending
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!done} onSelect={() => setSort([{ col, desc: true }])}>
              Sort descending
            </DropdownMenuItem>
            {s ? <DropdownMenuItem onSelect={() => setSort((p) => p.filter((x) => x.col !== col))}>Remove this sort</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!done} onSelect={() => setPanel({ kind: 'stats', col })}>
              Statistics
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFrozen(frozen === d + 1 ? 0 : d + 1)}>
              {frozen === d + 1 ? 'Unfreeze columns' : 'Freeze up to this column'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={d <= 0} onSelect={() => moveCol(d, d - 1)}>
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem disabled={d >= order.length - 1} onSelect={() => moveCol(d, d + 1)}>
              Move right
            </DropdownMenuItem>
            <DropdownMenuItem disabled={order.length <= 1} onSelect={() => setHidden((h) => new Set(h).add(col))}>
              Hide column
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                navigator.clipboard.writeText(names[col] ?? '').then(
                  () => toast.success('Copied the column name'),
                  () => undefined,
                )
              }
            >
              Copy column name
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
    [order, sort, names, done, frozen, moveCol],
  );

  if (error) {
    return (
      <ViewerProblem title="This table could not be read">
        {error} If it is a text file with an unusual layout, try other parse settings or view it as text.
      </ViewerProblem>
    );
  }
  if (!meta) return <ViewerLoading label={kind === 'workbook' ? 'Reading the workbook…' : 'Reading the table…'} />;

  const progress = meta.done ? 1 : meta.size ? meta.read / meta.size : 0;
  const focusedCol = order[selection.c1];
  const matchCount = matches?.positions.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <form
          className="flex min-w-0 flex-1 items-center gap-1 max-sm:basis-full sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches?.query === query) stepMatch(1);
            else runSearch(query);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={searchBox}
              type="search"
              value={query}
              disabled={!done}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault();
                  stepMatch(-1);
                } else if (e.key === 'Escape') {
                  setQuery('');
                  grid.current?.focus();
                }
              }}
              placeholder={done ? 'Search all cells' : 'Search is ready once the file is read'}
              aria-label="Search all cells"
              className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
            />
          </div>
          {query ? (
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
              {searching
                ? 'Searching…'
                : matchCount
                  ? `${(matchIndex + 1).toLocaleString()} of ${matchCount.toLocaleString()}${matches?.capped ? '+' : ''}`
                  : 'No match'}
            </span>
          ) : null}
          <IconButton icon={ArrowUp01Icon} label="Previous match (Shift+F3)" disabled={!matchCount} onClick={() => stepMatch(-1)} />
          <IconButton icon={ArrowDown01Icon} label="Next match (F3)" disabled={!matchCount} onClick={() => stepMatch(1)} />
        </form>
        <ToolbarSep />
        <IconButton icon={FilterIcon} label="Filter row" pressed={showFilters} onClick={() => setShowFilters((v) => !v)}>
          <span className="max-md:hidden">Filters</span>
        </IconButton>
        {filtering ? (
          <ChipButton onClick={() => setFilters({})} className="text-primary">
            Clear filters
          </ChipButton>
        ) : null}
        {sort.length ? <ChipButton onClick={() => setSort([])}>Clear sort</ChipButton> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ChipButton aria-label="Columns">
              <HugeiconsIcon icon={LeftToRightListBulletIcon} strokeWidth={2} className="size-4" />
              <span className="max-md:hidden">Columns</span>
              {hidden.size ? <span className="rounded bg-muted px-1 tabular-nums">{order.length}/{columns.length}</span> : null}
            </ChipButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 w-60">
            <DropdownMenuItem onSelect={() => setHidden(new Set())}>Show all columns</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setColOrder(columns.map((_, i) => i));
                setWidths([]);
                sized.current = false;
                resetView();
              }}
            >
              Reset order and widths
            </DropdownMenuItem>
            {frozen ? <DropdownMenuItem onSelect={() => setFrozen(0)}>Unfreeze columns</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            {colOrder.map((c) => (
              <DropdownMenuCheckboxItem
                key={c}
                checked={!hidden.has(c)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (on) next.delete(c);
                    else if (order.length > 1) next.add(c);
                    return next;
                  })
                }
              >
                <span className="truncate">{names[c]}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ChipButton aria-label="Reading options">
              <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} className="size-4" />
              <span className="max-md:hidden">Reading</span>
            </ChipButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>First row</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={opts.header} onValueChange={(v) => setOpts((o) => ({ ...o, header: v as OpenOptions['header'] }))}>
              <DropdownMenuRadioItem value="auto">Detect ({meta.header ? 'names' : 'data'})</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="yes">Column names</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="no">Data</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {meta.kind === 'csv' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Delimiter · {opts.delimiter === 'auto' ? `${delimName(meta.delimiter)} (detected)` : delimName(opts.delimiter)}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup value={opts.delimiter} onValueChange={(v) => setOpts((o) => ({ ...o, delimiter: v }))}>
                      {DELIMS.map((d) => (
                        <DropdownMenuRadioItem key={d.value} value={d.value}>
                          {d.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Quotes · {opts.quote === 'auto' ? `${meta.quote === "'" ? 'single' : meta.quote ? 'double' : 'none'} (detected)` : QUOTES.find((q) => q.value === opts.quote)?.label}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup value={opts.quote} onValueChange={(v) => setOpts((o) => ({ ...o, quote: v }))}>
                      {QUOTES.map((d) => (
                        <DropdownMenuRadioItem key={d.label} value={d.value}>
                          {d.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Encoding · {opts.encoding === 'auto' ? `${meta.encoding.toUpperCase()} (detected)` : opts.encoding.toUpperCase()}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup value={opts.encoding} onValueChange={(v) => setOpts((o) => ({ ...o, encoding: v }))}>
                      {ENCODINGS.map((d) => (
                        <DropdownMenuRadioItem key={d.value} value={d.value}>
                          {d.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          icon={ChartHistogramIcon}
          label="Column statistics"
          disabled={!done || focusedCol === undefined}
          pressed={panel?.kind === 'stats'}
          onClick={() => setPanel((p) => (p?.kind === 'stats' ? null : focusedCol !== undefined ? { kind: 'stats', col: focusedCol } : null))}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ChipButton aria-label="Export" disabled={!done || busy}>
              <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
              <span className="max-md:hidden">Export</span>
            </ChipButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              {count.toLocaleString()} rows × {order.length} columns, as shown
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => exportAs('csv')}>CSV (.csv)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportAs('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportAs('json')}>JSON (.json)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Toolbar>

      <div className="relative flex min-h-0 flex-1">
        {order.length ? (
          <DataGrid
            ref={grid}
            label={`Table ${file.name}`}
            rowCount={count}
            columns={columns}
            order={order}
            widths={widths}
            frozen={frozen}
            getRow={getRow}
            onNeedRows={onNeedRows}
            sort={sort}
            onSort={onSort}
            showFilters={showFilters}
            filters={filters}
            onFilter={setFilter}
            filterError={filterError}
            selection={selection}
            onSelection={setSelection}
            highlight={matches?.query}
            current={matchCount ? { pos: matches!.positions[matchIndex]!, col: matches!.cols[matchIndex]! } : null}
            onResize={(col, w) => setWidths((ws) => ws.map((x, i) => (i === col ? w : x)))}
            onMove={moveCol}
            columnMenu={columnMenu}
            onOpenRow={(pos) => setPanel({ kind: 'row', pos })}
            onCopy={copySel}
            onKey={gridKey}
            busy={busy}
          />
        ) : (
          <ViewerProblem tone="neutral" title="This table is empty">
            No rows or columns were found{meta.kind === 'csv' ? ' with these reading options' : ' on this sheet'}.
          </ViewerProblem>
        )}
        {panel ? (
          <aside
            data-viewer-panel
            aria-label={panel.kind === 'stats' ? 'Column statistics' : 'Row detail'}
            className="flex flex-col border-l bg-card max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:h-[60%] max-lg:border-t max-lg:border-l-0 max-lg:shadow-[0_-12px_32px_-16px_rgb(0_0_0/0.4)] lg:w-80"
          >
            {panel.kind === 'stats' ? (
              <StatsPanel
                name={names[panel.col] ?? ''}
                stats={stats?.col === panel.col ? stats : null}
                loading={!stats}
                filtered={filtering}
                onFilterValue={(v) => setFilter(panel.col, `=${v}`)}
                onClose={() => setPanel(null)}
              />
            ) : (
              <RowPanel
                names={names}
                values={rowValues?.pos === panel.pos ? rowValues.values : null}
                sourceRow={rowValues?.pos === panel.pos && meta.kind === 'csv' ? rowValues.source : null}
                position={panel.pos}
                types={columns.map((c) => c.type)}
                onClose={() => setPanel(null)}
                onPrev={() => setPanel({ kind: 'row', pos: Math.max(0, panel.pos - 1) })}
                onNext={() => setPanel({ kind: 'row', pos: Math.min(count - 1, panel.pos + 1) })}
              />
            )}
          </aside>
        ) : null}
      </div>

      {meta.kind === 'workbook' && meta.sheets.length > 1 ? (
        <div role="tablist" aria-label="Sheets" className="flex gap-0.5 overflow-x-auto border-t bg-card px-2 pt-1">
          {meta.sheets.map((s, i) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={i === meta.sheet}
              onClick={() => {
                setSort([]);
                setFilters({});
                setHidden(new Set());
                setColOrder([]);
                setWidths([]);
                setFrozen(0);
                setPanel(null);
                setOpts((o) => ({ ...o, sheet: i }));
              }}
              className={cn(
                'shrink-0 rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                i === meta.sheet ? 'bg-background text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          {viewCount !== null && filtering ? `${count.toLocaleString()} of ${rows.toLocaleString()} rows` : `${rows.toLocaleString()} rows`}
        </span>
        <span className="tabular-nums">
          {order.length < columns.length ? `${order.length} of ${columns.length}` : columns.length} columns
        </span>
        {meta.kind === 'csv' ? (
          <span>
            {delimName(meta.delimiter)} · {meta.encoding.toUpperCase()}
            {meta.header ? ' · header row' : ''}
          </span>
        ) : null}
        {meta.done ? (
          <span className="tabular-nums">
            Read in {(meta.ms / 1000).toFixed(meta.ms < 10000 ? 1 : 0)} s{viewMs !== null ? ` · view in ${Math.round(viewMs)} ms` : ''}
          </span>
        ) : (
          <span className="flex items-center gap-2 tabular-nums">
            Reading {Math.round(progress * 100)}%
            <span className="h-1 w-24 overflow-hidden rounded-full bg-muted">
              <span className="block h-full bg-primary" style={{ width: `${progress * 100}%` }} />
            </span>
          </span>
        )}
        {meta.ragged ? <span className="text-warning">{meta.ragged.toLocaleString()} rows have a different number of fields</span> : null}
        {meta.truncated ? (
          <span className="text-warning">Too large to hold in memory: showing the first {rows.toLocaleString()} rows.</span>
        ) : null}
        {busy ? <span>Working…</span> : null}
      </footer>
    </div>
  );
}
