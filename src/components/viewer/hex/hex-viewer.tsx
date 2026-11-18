'use client';

import { ArrowDown01Icon, ArrowUp01Icon, InformationCircleIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, InfoRows, PanelTitle, Toolbar, ToolbarSelect, ToolbarSep } from '../bits';
import { type Shortcut, useKeys, useShortcuts, type ViewerProps } from '../context';
import { useVirtualScroll } from '../virtual';
import { ByteSource, parseHexPattern, parseOffset } from './byte-source';

const ROW_H = 22;
const SHORTCUTS: Shortcut[] = [
  { keys: '←  →  ↑  ↓', label: 'Move the cursor' },
  { keys: 'Shift + arrows', label: 'Select bytes' },
  { keys: 'PgUp  PgDn', label: 'Page up or down' },
  { keys: 'Home  End', label: 'Start or end of the row' },
  { keys: 'Ctrl + Home  Ctrl + End', label: 'Start or end of the file' },
  { keys: 'G', label: 'Go to offset' },
  { keys: 'Ctrl + F', label: 'Search' },
  { keys: 'F3  Shift + F3', label: 'Next or previous match' },
  { keys: 'Ctrl + C', label: 'Copy the selection as hex' },
];

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase());
const printable = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

function hexOffset(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

type Mode = 'text' | 'hex';

function Inspector({ bytes, offset, little }: { bytes: Uint8Array; offset: number; little: boolean }) {
  if (!bytes.length) return <p className="px-3 py-2 text-xs text-muted-foreground">Move the cursor onto a byte.</p>;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (n: number) => bytes.length >= n;
  const b0 = bytes[0]!;
  let utf8 = '';
  try {
    const len = b0 < 0x80 ? 1 : b0 >= 0xf0 ? 4 : b0 >= 0xe0 ? 3 : b0 >= 0xc0 ? 2 : 0;
    if (len && has(len)) utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, len));
  } catch {
    utf8 = '';
  }
  const rows: [string, string][] = [
    ['Offset', `${offset.toLocaleString()} (0x${offset.toString(16).toUpperCase()})`],
    ['Binary', b0.toString(2).padStart(8, '0')],
    ['Int8', String(view.getInt8(0))],
    ['UInt8', String(b0)],
    ['Int16', has(2) ? String(view.getInt16(0, little)) : '—'],
    ['UInt16', has(2) ? String(view.getUint16(0, little)) : '—'],
    ['Int32', has(4) ? String(view.getInt32(0, little)) : '—'],
    ['UInt32', has(4) ? String(view.getUint32(0, little)) : '—'],
    ['Int64', has(8) ? view.getBigInt64(0, little).toString() : '—'],
    ['UInt64', has(8) ? view.getBigUint64(0, little).toString() : '—'],
    ['Float32', has(4) ? String(view.getFloat32(0, little)) : '—'],
    ['Float64', has(8) ? String(view.getFloat64(0, little)) : '—'],
    ['UTF-8', utf8 ? `${JSON.stringify(utf8)} U+${utf8.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : '—'],
    ['Unix time', has(4) ? unixTime(view.getUint32(0, little)) : '—'],
  ];
  return <InfoRows rows={rows.map(([k, v]) => [k, <span key={k} className="font-mono">{v}</span>])} className="px-3 py-2.5" />;
}

function unixTime(s: number): string {
  if (s < 315532800 || s > 4102444800) return '—';
  return new Date(s * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export default function HexViewer({ file }: ViewerProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const source = useMemo(() => new ByteSource(file), [file]);
  // Pages load asynchronously; re-render once they arrive (only while mounted).
  useEffect(() => {
    const stop = source.listen(bump);
    bump();
    return stop;
  }, [source]);
  const scroller = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(16);
  const rows = Math.max(1, Math.ceil(file.size / perRow));
  const vs = useVirtualScroll(scroller, rows * ROW_H);
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [little, setLittle] = useState(true);
  const [inspect, setInspect] = useState<Uint8Array>(new Uint8Array(0));
  const [panel, setPanel] = useState(true);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('text');
  const [fold, setFold] = useState(true);
  const [searching, setSearching] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [goto, setGoto] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const gotoRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useShortcuts(SHORTCUTS);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPerRow(el.clientWidth < 560 ? 8 : 16));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  // Inspector bytes at the cursor.
  useEffect(() => {
    let live = true;
    source.read(cursor, 8).then((b) => live && setInspect(b), () => undefined);
    return () => {
      live = false;
    };
  }, [source, cursor]);

  const offsetWidth = Math.max(8, Math.ceil(Math.log2(Math.max(2, file.size)) / 4));
  const selStart = anchor === null ? cursor : Math.min(anchor, cursor);
  const selEnd = anchor === null ? cursor : Math.max(anchor, cursor);

  const reveal = useCallback(
    (offset: number) => {
      const row = Math.floor(offset / perRow);
      const y = row * ROW_H;
      if (y < vs.top) vs.scrollTo(y);
      else if (y + ROW_H > vs.top + vs.height) vs.scrollTo(y + ROW_H - vs.height);
    },
    [perRow, vs],
  );

  const moveTo = useCallback(
    (offset: number, extend = false, center = false) => {
      const o = Math.max(0, Math.min(file.size - 1, offset));
      if (extend) setAnchor((a) => (a === null ? cursor : a));
      else setAnchor(null);
      setCursor(o);
      if (center) vs.scrollTo(Math.floor(o / perRow) * ROW_H - vs.height / 3);
      else reveal(o);
    },
    [file.size, cursor, reveal, vs, perRow],
  );

  const pattern = useMemo(() => {
    if (!query) return null;
    if (mode === 'hex') return parseHexPattern(query);
    return Array.from(new TextEncoder().encode(query));
  }, [query, mode]);

  const runSearch = useCallback(
    async (backwards: boolean) => {
      if (!pattern?.length) {
        setStatus(mode === 'hex' && query ? 'Type bytes as hex pairs, like DE AD BE EF (?? matches any byte).' : null);
        return;
      }
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setSearching(0);
      setStatus(null);
      const from = backwards ? selStart : anchor === null ? cursor + (status === 'found' ? 1 : 0) : selStart + 1;
      try {
        const at = await source.find(pattern, Math.min(file.size, from), {
          backwards,
          fold: mode === 'text' && fold,
          signal: ctrl.signal,
          onProgress: (f) => setSearching(f),
        });
        if (at < 0) setStatus('No match');
        else {
          setAnchor(at);
          setCursor(at + pattern.length - 1);
          vs.scrollTo(Math.floor(at / perRow) * ROW_H - vs.height / 3);
          setStatus('found');
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setStatus('The file could not be read.');
      } finally {
        if (abort.current === ctrl) {
          abort.current = null;
          setSearching(null);
        }
      }
    },
    [pattern, mode, query, selStart, anchor, cursor, status, source, file.size, fold, vs, perRow],
  );

  const copySelection = useCallback(async () => {
    const len = selEnd - selStart + 1;
    if (len > 1024 * 1024) {
      toast.error('Select at most 1 MB to copy.');
      return;
    }
    const bytes = await source.read(selStart, len);
    await navigator.clipboard.writeText(Array.from(bytes, (b) => HEX[b]).join(' ')).then(
      () => toast.success(`Copied ${len.toLocaleString()} byte${len === 1 ? '' : 's'} as hex`),
      () => toast.error('Copy failed.'),
    );
  }, [selStart, selEnd, source]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const page = Math.max(1, Math.floor(vs.height / ROW_H) - 1) * perRow;
      const mod = e.ctrlKey || e.metaKey;
      switch (e.key) {
        case 'ArrowRight':
          moveTo(cursor + 1, e.shiftKey);
          return true;
        case 'ArrowLeft':
          moveTo(cursor - 1, e.shiftKey);
          return true;
        case 'ArrowDown':
          moveTo(cursor + perRow, e.shiftKey);
          return true;
        case 'ArrowUp':
          moveTo(cursor - perRow, e.shiftKey);
          return true;
        case 'PageDown':
          moveTo(cursor + page, e.shiftKey);
          return true;
        case 'PageUp':
          moveTo(cursor - page, e.shiftKey);
          return true;
        case 'Home':
          moveTo(mod ? 0 : cursor - (cursor % perRow), e.shiftKey);
          return true;
        case 'End':
          moveTo(mod ? file.size - 1 : cursor - (cursor % perRow) + perRow - 1, e.shiftKey);
          return true;
        case 'F3':
          void runSearch(e.shiftKey);
          return true;
        case 'g':
        case 'G':
          if (mod) return false;
          gotoRef.current?.focus();
          gotoRef.current?.select();
          return true;
        case 'f':
          if (!mod) return false;
          searchRef.current?.focus();
          searchRef.current?.select();
          return true;
        case 'c':
          if (!mod) return false;
          void copySelection();
          return true;
        default:
          return false;
      }
    },
    [vs.height, perRow, moveTo, cursor, file.size, runSearch, copySelection],
  );
  useKeys(onKey);

  const first = Math.max(0, Math.floor(vs.top / ROW_H) - 2);
  const count = Math.ceil(vs.height / ROW_H) + 5;
  const last = Math.min(rows, first + count);
  const lines = [];
  for (let r = first; r < last; r++) {
    const base = r * perRow;
    const hex = [];
    const asc = [];
    for (let i = 0; i < perRow; i++) {
      const off = base + i;
      if (off >= file.size) break;
      const b = source.peek(off);
      const sel = off >= selStart && off <= selEnd;
      const cur = off === cursor;
      const cls = cn(
        'rounded-[3px]',
        sel && 'bg-primary/20 text-foreground',
        cur && 'bg-primary text-primary-foreground',
        b === 0 && !sel && !cur && 'text-faint',
      );
      hex.push(
        <span key={i} data-off={off} className={cn(cls, 'inline-block w-[2.3ch] text-center', i === perRow / 2 && 'ml-[1ch]')}>
          {b < 0 ? '··' : HEX[b]}
        </span>,
      );
      asc.push(
        <span key={i} data-off={off} className={cn(cls, b >= 0 && (b < 0x20 || b >= 0x7f) && !cur && 'text-faint')}>
          {b < 0 ? ' ' : printable(b)}
        </span>,
      );
    }
    lines.push(
      <div
        key={r}
        className="absolute left-0 flex h-[22px] items-center gap-[2ch] px-3 whitespace-pre"
        style={{ top: r * ROW_H + vs.shift }}
      >
        <span className="w-[calc(var(--w)*1ch)] text-muted-foreground select-none" style={{ ['--w' as string]: offsetWidth }}>
          {hexOffset(base, offsetWidth)}
        </span>
        <span className="flex gap-[0.6ch]">{hex}</span>
        <span className="border-l pl-[1.5ch]">{asc}</span>
      </div>,
    );
  }

  const selLen = selEnd - selStart + 1;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const o = parseOffset(goto);
            if (o === null || o >= file.size) {
              toast.error(`Type an offset below ${file.size.toLocaleString()} (decimal, or hex like 0x1F00).`);
              return;
            }
            moveTo(o, false, true);
            gotoRef.current?.blur();
          }}
        >
          <input
            ref={gotoRef}
            value={goto}
            onChange={(e) => setGoto(e.target.value)}
            placeholder="Go to offset"
            aria-label="Go to offset (decimal or 0x hex)"
            className="h-8 w-32 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </form>
        <ToolbarSep />
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(false);
          }}
        >
          <div className="relative min-w-0 flex-1 sm:max-w-64">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setStatus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault();
                  void runSearch(true);
                }
              }}
              placeholder={mode === 'hex' ? 'DE AD ?? EF' : 'Find text'}
              aria-label={mode === 'hex' ? 'Find bytes (hex)' : 'Find text'}
              className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          <ToolbarSelect
            label="Find"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setStatus(null);
            }}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'hex', label: 'Hex bytes' },
            ]}
          />
          {mode === 'text' ? (
            <ChipButton pressed={!fold} onClick={() => setFold((v) => !v)} title="Match case">
              Aa
            </ChipButton>
          ) : null}
          <IconButton icon={ArrowUp01Icon} label="Previous match (Shift+F3)" onClick={() => void runSearch(true)} />
          <IconButton icon={ArrowDown01Icon} label="Next match (F3)" onClick={() => void runSearch(false)} />
          {searching !== null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              Searching {Math.round(searching * 100)}%{' '}
              <button type="button" className="underline" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            </span>
          ) : status && status !== 'found' ? (
            <span className="text-xs text-muted-foreground">{status}</span>
          ) : null}
        </form>
        <ToolbarSep className="max-sm:hidden" />
        <ToolbarSelect
          label="Byte order"
          value={little ? 'le' : 'be'}
          onChange={(v) => setLittle(v === 'le')}
          options={[
            { value: 'le', label: 'Little-endian' },
            { value: 'be', label: 'Big-endian' },
          ]}
        />
        <IconButton icon={InformationCircleIcon} label="Data inspector" pressed={panel} onClick={() => setPanel((v) => !v)} />
      </Toolbar>
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <div
          ref={scroller}
          tabIndex={0}
          role="grid"
          aria-label={`Bytes of ${file.name}`}
          aria-rowcount={rows}
          className="relative min-h-0 flex-1 overflow-auto font-mono text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
          onMouseDown={(e) => {
            const off = (e.target as HTMLElement).closest<HTMLElement>('[data-off]')?.dataset.off;
            if (off !== undefined) {
              e.preventDefault();
              scroller.current?.focus();
              moveTo(Number(off), e.shiftKey);
            }
          }}
        >
          <div style={{ height: vs.spacer }} className="relative min-w-max">
            {lines}
          </div>
        </div>
        {panel ? (
          <aside
            aria-label="Data inspector"
            className="flex shrink-0 flex-col overflow-auto border-t bg-card lg:w-72 lg:border-t-0 lg:border-l max-lg:max-h-56"
          >
            <PanelTitle>Inspector · {little ? 'LE' : 'BE'}</PanelTitle>
            <Inspector bytes={inspect} offset={cursor} little={little} />
            <div className="mt-auto border-t px-3 py-2 text-xs text-muted-foreground">
              {selLen > 1 ? (
                <span>
                  Selected {selLen.toLocaleString()} bytes ·{' '}
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => void copySelection()}>
                    Copy as hex
                  </button>
                </span>
              ) : (
                <span>
                  {formatBytes(file.size)} · {file.size.toLocaleString()} bytes
                </span>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
