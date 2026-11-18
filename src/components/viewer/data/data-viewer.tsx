'use client';

import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Download04Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Segmented } from '@/components/kit/segmented';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WorkerHost } from '@/engines/worker-host';
import { baseName, downloadBlob } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, Toolbar, ToolbarSep, ViewerLoading } from '../bits';
import { CodeView, type CodeViewHandle } from '../code/code-view';
import { type Shortcut, useKeys, useShortcuts, type ViewerProps } from '../context';
import { useVirtualScroll } from '../virtual';
import type { DataFormat, DataWorkerApi, OpenResult, Row } from './data.worker';
import { T } from './tree';

const ROW_H = 24;
const BLOCK = 300;
const SHORTCUTS: Shortcut[] = [
  { keys: '↑  ↓', label: 'Move between rows (tree focused)' },
  { keys: '→  ←', label: 'Expand or collapse; go to the parent' },
  { keys: 'Enter  Space', label: 'Expand or collapse' },
  { keys: 'C', label: 'Copy the JSONPath of the row' },
  { keys: 'V', label: 'Copy the value of the row' },
  { keys: '/', label: 'Search keys and values' },
  { keys: 'F3  Shift + F3', label: 'Next or previous match' },
];

function formatOf(ext: string, label: string): DataFormat {
  if (ext === 'ndjson' || ext === 'jsonl' || label === 'NDJSON') return 'ndjson';
  if (ext === 'yaml' || ext === 'yml' || label === 'YAML') return 'yaml';
  if (ext === 'toml' || label === 'TOML') return 'toml';
  if (label === 'XML' || ext === 'xml') return 'xml';
  return 'json';
}

const LANG: Record<DataFormat | 'csv', string> = { json: 'json', ndjson: 'json', yaml: 'yaml', toml: 'toml', xml: 'xml', csv: 'plain' };
const EXT: Record<string, string> = { json: 'json', yaml: 'yaml', xml: 'xml', csv: 'csv' };

type Mode = 'tree' | 'text';
type TextMode = 'original' | 'pretty' | 'minified';

function ValueText({ row }: { row: Row }) {
  switch (row.type) {
    case T.string:
    case T.attr:
      return <span className="text-success">&quot;{row.value}&quot;</span>;
    case T.text:
      return <span className="text-foreground">{row.value}</span>;
    case T.number:
      return <span className="text-warning">{row.value}</span>;
    case T.bool:
    case T.null:
      return <span className="text-viz-3">{row.value}</span>;
    case T.array:
      return <span className="text-muted-foreground">[{row.count.toLocaleString()}]</span>;
    case T.object:
      return <span className="text-muted-foreground">{`{${row.count.toLocaleString()}}`}</span>;
    default:
      return <span className="text-muted-foreground">{row.count ? `${row.count.toLocaleString()} children` : ''}</span>;
  }
}

export default function DataViewer({ file, sniff }: ViewerProps) {
  const host = useMemo(
    () => new WorkerHost<DataWorkerApi>(() => new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' })),
    [],
  );
  useEffect(() => () => host.terminate(), [host]);
  const format = formatOf(sniff.ext, sniff.format);
  const [result, setResult] = useState<OpenResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [visible, setVisible] = useState(0);
  const [mode, setMode] = useState<Mode>('tree');
  const [textMode, setTextMode] = useState<TextMode>('pretty');
  const [text, setText] = useState<{ key: string; value: string | null } | null>(null);
  const [converted, setConverted] = useState<{ to: string; text: string; notes: string[] } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [paths, setPaths] = useState<{ jsonPath: string; js: string; pointer: string } | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ query: string; ids: Int32Array; capped: boolean } | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  // Fetched rows by block; replaced (not mutated) so renders read state, never refs.
  const [cache, setCache] = useState<{ gen: number; map: Map<number, Row[]> }>({ gen: 0, map: new Map() });
  const gen = useRef(0);
  const inflight = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null);
  const code = useRef<CodeViewHandle>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const vs = useVirtualScroll(scroller, visible * ROW_H + 8);
  useShortcuts(SHORTCUTS);

  useEffect(() => {
    let live = true;
    host.call((api) => api.open(file, format) as Promise<OpenResult>).then(
      (r) => {
        if (!live) return;
        setResult(r);
        if (r.ok) setVisible(r.visible);
        else setMode('text');
      },
      (err: unknown) => live && setFailed(err instanceof Error ? err.message : 'The file could not be read.'),
    );
    return () => {
      live = false;
    };
  }, [host, file, format]);

  const refresh = useCallback((count: number) => {
    gen.current += 1;
    inflight.current = new Set();
    setCache({ gen: gen.current, map: new Map() });
    setVisible(count);
  }, []);

  const getRow = (pos: number) => cache.map.get(Math.floor(pos / BLOCK))?.[pos % BLOCK];

  // Fetch the rows on screen.
  const first = Math.max(0, Math.floor(vs.top / ROW_H) - 5);
  const last = Math.min(visible, Math.ceil((vs.top + vs.height) / ROW_H) + 5);
  useEffect(() => {
    if (!result?.ok) return;
    for (let b = Math.floor(first / BLOCK); b * BLOCK < last; b++) {
      const key = `${cache.gen}:${b}`;
      if (cache.map.has(b) || inflight.current.has(key)) continue;
      inflight.current.add(key);
      const g = cache.gen;
      host.call((api) => api.rows(b * BLOCK, BLOCK)).then(
        (rows) => {
          inflight.current.delete(key);
          setCache((c) => (c.gen === g ? { gen: g, map: new Map(c.map).set(b, rows) } : c));
        },
        () => inflight.current.delete(key),
      );
    }
  }, [first, last, cache, result, host]);

  // Text views.
  const textKey = converted ? `convert:${converted.to}` : textMode;
  useEffect(() => {
    if (mode !== 'text' || converted || !result) return;
    let live = true;
    host.call((api) => api.text(result.ok ? textMode : 'original')).then(
      (value) => live && setText({ key: textMode, value }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [mode, textMode, converted, result, host]);

  // Show the parse error in the text.
  useEffect(() => {
    if (!result || result.ok || !result.line || mode !== 'text') return;
    const t = setTimeout(() => code.current?.reveal(result.line!, Math.max(0, (result.column ?? 1) - 1), result.column ?? 1), 150);
    return () => clearTimeout(t);
  }, [result, mode, text]);

  const select = useCallback(
    (pos: number) => {
      const p = Math.max(0, Math.min(visible - 1, pos));
      setCursor(p);
      const y = p * ROW_H;
      if (y < vs.top) vs.scrollTo(y);
      else if (y + ROW_H > vs.top + vs.height) vs.scrollTo(y + ROW_H - vs.height);
    },
    [visible, vs],
  );

  const cursorRow = getRow(cursor);
  const cursorId = cursorRow?.id ?? null;
  useEffect(() => {
    if (cursorId === null) return;
    let live = true;
    host.call((api) => api.paths(cursorId)).then(
      (p) => {
        if (!live) return;
        setPaths(p);
        setSelectedId(cursorId);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [cursorId, host]);

  const toggle = useCallback(
    (pos: number, open?: boolean) => {
      host.call((api) => api.toggle(pos, open)).then(refresh, () => undefined);
    },
    [host, refresh],
  );

  const setLevel = (n: number) => host.call((api) => api.level(n)).then(refresh, () => undefined);

  const goToMatch = useCallback(
    (ids: Int32Array, i: number) => {
      const id = ids[i];
      if (id === undefined) return;
      host.call((api) => api.reveal(id)).then(({ pos, visible: count }) => {
        refresh(count);
        if (pos >= 0) {
          setCursor(pos);
          vs.scrollTo(pos * ROW_H - vs.height / 3);
        }
      }, () => undefined);
    },
    [host, refresh, vs],
  );

  useEffect(() => {
    if (!result?.ok) return;
    if (!query) {
      queueMicrotask(() => setMatches(null));
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      host.call((api) => api.search(query, 'all')).then((r) => {
        if (!live) return;
        setMatches({ query, ...r });
        setMatchIndex(0);
        if (r.ids.length) goToMatch(r.ids, 0);
      }, () => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // goToMatch changes with the scroll state; searching again for that is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, result, host]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!matches?.ids.length) return;
      const i = (matchIndex + dir + matches.ids.length) % matches.ids.length;
      setMatchIndex(i);
      goToMatch(matches.ids, i);
    },
    [matches, matchIndex, goToMatch],
  );

  const copy = useCallback((value: string, what: string) => {
    navigator.clipboard.writeText(value).then(
      () => toast.success(`Copied ${what}`),
      () => toast.error('Copy failed.'),
    );
  }, []);

  const copyValue = useCallback(
    (id: number) => host.call((api) => api.valueText(id)).then((v) => copy(v, 'the value'), () => undefined),
    [host, copy],
  );

  const onTreeKey = (e: React.KeyboardEvent) => {
    const row = getRow(cursor);
    const page = Math.max(1, Math.floor(vs.height / ROW_H) - 1);
    switch (e.key) {
      case 'ArrowDown':
        select(cursor + 1);
        break;
      case 'ArrowUp':
        select(cursor - 1);
        break;
      case 'PageDown':
        select(cursor + page);
        break;
      case 'PageUp':
        select(cursor - page);
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(visible - 1);
        break;
      case 'ArrowRight':
        if (row && row.count && !row.expanded) toggle(cursor, true);
        else select(cursor + 1);
        break;
      case 'ArrowLeft':
        if (row && row.count && row.expanded) toggle(cursor, false);
        else if (row) {
          // Go to the parent: the nearest row above with a smaller depth.
          for (let p = cursor - 1; p >= 0; p--) {
            const r = getRow(p);
            if (r && r.depth < row.depth) {
              select(p);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (row?.count) toggle(cursor);
        break;
      case 'c':
        if (e.ctrlKey || e.metaKey) {
          if (selectedId !== null) void copyValue(selectedId);
        } else if (paths) copy(paths.jsonPath, paths.jsonPath);
        break;
      case 'v':
        if (selectedId !== null) void copyValue(selectedId);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const docKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey) {
        searchBox.current?.focus();
        return true;
      }
      if (e.key === 'F3') {
        step(e.shiftKey ? -1 : 1);
        return true;
      }
      return false;
    },
    [step],
  );
  useKeys(docKey);

  const convert = (to: 'json' | 'yaml' | 'xml' | 'csv') => {
    host.call((api) => api.convert(to)).then(
      (r) => {
        setConverted({ to, ...r });
        setMode('text');
      },
      (err: unknown) => toast.error(err instanceof Error ? err.message : 'Conversion failed.'),
    );
  };

  if (failed) return <div className="p-6 text-sm text-destructive">{failed}</div>;
  if (!result) return <ViewerLoading label={`Reading ${sniff.format}…`} />;

  const shownText = converted ? converted.text : text?.key === textKey ? text.value : undefined;
  const needle = matches?.query.toLowerCase() ?? '';
  const rows = [];
  for (let pos = first; pos < last; pos++) {
    const row = getRow(pos);
    const hit =
      !!needle &&
      !!row &&
      ((row.key?.toLowerCase().includes(needle) ?? false) || (row.value?.toLowerCase().includes(needle) ?? false));
    const current = !!matches && row?.id === matches.ids[matchIndex];
    rows.push(
      <div
        key={pos}
        role="treeitem"
        aria-level={(row?.depth ?? 0) + 1}
        aria-expanded={row?.count ? row.expanded : undefined}
        aria-selected={pos === cursor}
        data-pos={pos}
        className={cn(
          'absolute right-0 left-0 flex h-6 items-center gap-1 pr-3 font-mono text-[12.5px] whitespace-nowrap',
          pos === cursor ? 'bg-primary/12 ring-1 ring-primary/40 ring-inset' : 'hover:bg-muted/60',
          hit && 'bg-warning/12',
          current && 'bg-warning/30',
        )}
        style={{ top: pos * ROW_H + vs.shift, paddingLeft: 8 + (row?.depth ?? 0) * 16 }}
      >
        {row ? (
          <>
            <span
              data-toggle={row.count ? pos : undefined}
              className={cn('grid size-4 shrink-0 place-items-center text-muted-foreground', row.count && 'cursor-pointer hover:text-foreground')}
            >
              {row.count ? (
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2.4} className={cn('size-3 transition-transform', row.expanded && 'rotate-90')} />
              ) : null}
            </span>
            {row.key !== null ? (
              <span className={cn('shrink-0', row.type === T.element ? 'text-primary' : 'text-viz-2')}>
                {row.type === T.element ? `<${row.key}>` : row.key}
              </span>
            ) : row.index >= 0 ? (
              <span className="shrink-0 text-faint">{row.index}</span>
            ) : null}
            {(row.key !== null || row.index >= 0) && row.type !== T.element ? <span className="-ml-1 text-faint">:</span> : null}
            <span className="min-w-0 truncate">
              <ValueText row={row} />
            </span>
          </>
        ) : (
          <span className="h-2.5 w-40 animate-pulse rounded bg-muted" />
        )}
      </div>,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          label="View"
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m === 'tree') setConverted(null);
          }}
          options={result.ok ? [{ value: 'tree', label: 'Tree' }, { value: 'text', label: 'Text' }] : [{ value: 'text', label: 'Text' }]}
        />
        {mode === 'text' && result.ok && !converted ? (
          <Segmented
            label="Text"
            value={textMode}
            onChange={setTextMode}
            options={[
              { value: 'pretty', label: 'Pretty' },
              { value: 'minified', label: 'Minified' },
              { value: 'original', label: 'Original' },
            ]}
          />
        ) : null}
        {converted ? (
          <ChipButton onClick={() => setConverted(null)} className="text-primary">
            Back to {format.toUpperCase()}
          </ChipButton>
        ) : null}
        {mode === 'tree' && result.ok ? (
          <>
            <ToolbarSep />
            <form
              className="flex min-w-0 flex-1 items-center gap-1 max-sm:basis-full sm:max-w-sm"
              onSubmit={(e) => {
                e.preventDefault();
                step(1);
              }}
            >
              <div className="relative min-w-0 flex-1">
                <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchBox}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.shiftKey) {
                      e.preventDefault();
                      step(-1);
                    }
                  }}
                  placeholder="Search keys and values"
                  aria-label="Search keys and values"
                  className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
              {query && matches ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-live="polite">
                  {matches.ids.length ? `${matchIndex + 1} of ${matches.ids.length.toLocaleString()}${matches.capped ? '+' : ''}` : 'No match'}
                </span>
              ) : null}
              <IconButton icon={ArrowUp01Icon} label="Previous match" disabled={!matches?.ids.length} onClick={() => step(-1)} />
              <IconButton icon={ArrowDown01Icon} label="Next match" disabled={!matches?.ids.length} onClick={() => step(1)} />
            </form>
            <ToolbarSep />
            <ChipButton onClick={() => setLevel(1)}>Collapse</ChipButton>
            <ChipButton onClick={() => setLevel(2)}>Level 2</ChipButton>
            <ChipButton onClick={() => setLevel(3)}>Level 3</ChipButton>
            <ChipButton onClick={() => setLevel(65535)} title={result.nodes > 500000 ? 'Large file: this shows every node' : undefined}>
              Expand all
            </ChipButton>
          </>
        ) : null}
        <span className="flex-1" />
        {result.ok ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ChipButton>Convert</ChipButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal text-muted-foreground">Show as</DropdownMenuLabel>
              {(['json', 'yaml', 'xml', 'csv'] as const)
                .filter((f) => f !== (format === 'ndjson' ? 'json-x' : format))
                .map((f) => (
                  <DropdownMenuItem key={f} onSelect={() => convert(f)}>
                    {f === 'csv' ? 'CSV (a list of records)' : f.toUpperCase()}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {mode === 'text' && shownText ? (
          <>
            <IconButton icon={Copy01Icon} label="Copy the text" onClick={() => copy(shownText, 'the text')} />
            <IconButton
              icon={Download04Icon}
              label="Download the text"
              onClick={() =>
                downloadBlob(
                  new Blob([shownText], { type: 'text/plain;charset=utf-8' }),
                  `${baseName(file.name)}${converted ? '' : textMode === 'minified' ? '.min' : textMode === 'pretty' ? '.pretty' : ''}.${converted ? EXT[converted.to] : sniff.ext || 'txt'}`,
                )
              }
            />
          </>
        ) : null}
      </Toolbar>

      {!result.ok ? (
        <div role="alert" className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-foreground">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">
              Not valid {format === 'ndjson' ? 'NDJSON' : format.toUpperCase()}
              {result.line ? ` · line ${result.line.toLocaleString()}${result.column ? `, column ${result.column}` : ''}` : ''}
            </p>
            <p className="text-muted-foreground">{result.message}</p>
          </div>
        </div>
      ) : null}
      {converted?.notes.length ? (
        <p className="border-b bg-card px-3 py-1.5 text-xs text-muted-foreground">{converted.notes.join(' ')}</p>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {mode === 'tree' && result.ok ? (
          <div
            ref={scroller}
            tabIndex={0}
            role="tree"
            aria-label={`Tree of ${file.name}`}
            onKeyDown={onTreeKey}
            onMouseDown={(e) => {
              const el = e.target as HTMLElement;
              const tg = el.closest<HTMLElement>('[data-toggle]');
              const item = el.closest<HTMLElement>('[data-pos]');
              if (!item) return;
              const pos = Number(item.dataset.pos);
              setCursor(pos);
              if (tg) toggle(pos);
            }}
            onDoubleClick={(e) => {
              const item = (e.target as HTMLElement).closest<HTMLElement>('[data-pos]');
              if (item) toggle(Number(item.dataset.pos));
            }}
            className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
          >
            <div style={{ height: vs.spacer }} className="relative min-w-max">
              {rows}
            </div>
          </div>
        ) : shownText === undefined ? (
          <ViewerLoading label="Preparing the text…" />
        ) : shownText === null ? (
          <div className="grid flex-1 place-items-center p-6 text-center text-xs text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <p>This text is over 24 MB, too large to show here. Use the tree, or download it.</p>
              <ChipButton
                className="border"
                onClick={() =>
                  host.call((api) => api.textBlob(textMode)).then(
                    (blob) => downloadBlob(blob, `${baseName(file.name)}${textMode === 'minified' ? '.min' : textMode === 'pretty' ? '.pretty' : ''}.${sniff.ext || 'json'}`),
                    () => toast.error('The text could not be made.'),
                  )
                }
              >
                <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
                Download {textMode} text
              </ChipButton>
            </div>
          </div>
        ) : (
          <CodeView
            ref={code}
            text={shownText}
            language={converted ? LANG[converted.to as DataFormat] ?? 'plain' : LANG[format]}
            wrap={textMode === 'minified' && !converted}
            label={`Text of ${file.name}`}
          />
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        {mode === 'tree' && paths ? (
          <span className="flex min-w-0 flex-1 basis-72 items-center gap-1">
            <code className="min-w-0 truncate font-mono text-foreground" title={paths.jsonPath}>
              {paths.jsonPath}
            </code>
            <button type="button" className="shrink-0 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => copy(paths.jsonPath, 'the JSONPath')}>
              JSONPath
            </button>
            <button type="button" className="shrink-0 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => copy(paths.js, 'the accessor')}>
              JS
            </button>
            <button type="button" className="shrink-0 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => copy(paths.pointer, 'the JSON Pointer')}>
              Pointer
            </button>
            {selectedId !== null ? (
              <button type="button" className="shrink-0 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => void copyValue(selectedId)}>
                Value
              </button>
            ) : null}
          </span>
        ) : null}
        {result.ok ? (
          <span className="min-w-0 truncate tabular-nums">
            {sniff.format} · {result.nodes.toLocaleString()} nodes · {result.lines.toLocaleString()} lines
            {result.docs > 1 ? ` · ${result.docs} documents` : ''} · read in {Math.round(result.ms)} ms
          </span>
        ) : null}
      </footer>
    </div>
  );
}
