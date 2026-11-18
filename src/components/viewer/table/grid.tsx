'use client';

import { ArrowDown01Icon, ArrowUp01Icon, MoreVerticalIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  forwardRef,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import { useVirtualScroll } from '../virtual';
import type { ColType, SortKey } from './engine';

export const ROW_H = 30;
const HEAD_H = 36;
const FILTER_H = 34;

export type GridColumn = { name: string; type: ColType };

/** A rectangle of cells: rows are view positions, columns display indexes. */
export type Selection = { r0: number; c0: number; r1: number; c1: number };

export type GridHandle = {
  /** Scrolls a cell (view position, display index) into view. */
  reveal(pos: number, display: number, center?: boolean): void;
  focus(): void;
};

const TYPE_MARK: Record<ColType, string> = { number: '123', date: 'date', boolean: 'y/n', text: 'abc', empty: '—' };

export type DataGridProps = {
  label: string;
  rowCount: number;
  columns: GridColumn[];
  /** Display order of visible columns (source column indexes). */
  order: number[];
  widths: number[];
  frozen: number;
  getRow: (pos: number) => string[] | undefined;
  onNeedRows: (from: number, to: number) => void;
  sort: SortKey[];
  onSort?: (col: number, add: boolean) => void;
  showFilters: boolean;
  filters?: Record<number, string>;
  onFilter?: (col: number, query: string) => void;
  filterError?: { col: number; message: string } | null;
  selection: Selection;
  onSelection: (s: Selection) => void;
  highlight?: string;
  current?: { pos: number; col: number } | null;
  onResize?: (col: number, width: number) => void;
  onMove?: (from: number, to: number) => void;
  columnMenu?: (col: number) => ReactNode;
  onOpenRow?: (pos: number) => void;
  onCopy?: (s: Selection) => void;
  /** Keys the grid does not handle itself (Ctrl+F…). Return true when handled. */
  onKey?: (e: React.KeyboardEvent) => boolean;
  rowNumber?: (pos: number) => number;
  busy?: boolean;
};

function norm(s: Selection) {
  return { top: Math.min(s.r0, s.r1), bottom: Math.max(s.r0, s.r1), left: Math.min(s.c0, s.c1), right: Math.max(s.c0, s.c1) };
}

/**
 * A virtualised data grid: only the rows and columns on screen exist in the
 * DOM, so a million rows scroll like a hundred. Sticky header and filter row,
 * frozen columns, resize and drag-to-reorder, keyboard selection.
 */
export const DataGrid = forwardRef<GridHandle, DataGridProps>(function DataGrid(props, ref) {
  const {
    label,
    rowCount,
    columns,
    order,
    widths,
    frozen,
    getRow,
    onNeedRows,
    sort,
    onSort,
    showFilters,
    filters,
    onFilter,
    filterError,
    selection,
    onSelection,
    highlight,
    current,
    onResize,
    onMove,
    columnMenu,
    onOpenRow,
    onCopy,
    onKey,
    rowNumber,
    busy,
  } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const head = HEAD_H + (showFilters ? FILTER_H : 0);
  const vs = useVirtualScroll(scroller, head + rowCount * ROW_H + 8);
  const [drag, setDrag] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragging = useRef(false);

  const gutter = Math.max(44, String(rowCount).length * 8 + 22);
  const xs = useMemo(() => {
    const out: number[] = [];
    let x = gutter;
    for (const c of order) {
      out.push(x);
      x += widths[c] ?? 120;
    }
    out.push(x);
    return out;
  }, [order, widths, gutter]);
  const total = xs[xs.length - 1]!;
  const frozenCount = Math.min(frozen, order.length);
  const frozenRight = xs[frozenCount]!;

  // Visible rows.
  const first = Math.max(0, Math.floor((vs.top - head) / ROW_H) - 3);
  const last = Math.min(rowCount, Math.ceil((vs.top - head + vs.height) / ROW_H) + 3);
  // Visible scrolling columns.
  const leftEdge = vs.left + frozenRight;
  const rightEdge = vs.left + (vs.width || 1600);
  let c0 = frozenCount;
  while (c0 < order.length && xs[c0 + 1]! <= leftEdge) c0++;
  let c1 = c0;
  while (c1 < order.length && xs[c1]! < rightEdge) c1++;
  const display = useMemo(() => {
    const list: number[] = [];
    for (let i = 0; i < frozenCount; i++) list.push(i);
    for (let i = c0; i < c1; i++) list.push(i);
    return list;
  }, [frozenCount, c0, c1]);

  const cellCols = useMemo<CellCol[]>(
    () =>
      display.map((d) => {
        const col = order[d]!;
        return {
          d,
          col,
          width: xs[d + 1]! - xs[d]!,
          left: d < frozenCount ? xs[d]! : -1,
          numeric: columns[col]?.type === 'number',
          edge: d === frozenCount - 1,
        };
      }),
    [display, order, xs, frozenCount, columns],
  );

  useEffect(() => {
    if (rowCount > 0 && last > first) onNeedRows(first, last);
  }, [first, last, rowCount, onNeedRows]);

  const sel = norm(selection);
  const needle = highlight?.toLowerCase() ?? '';

  const reveal = useCallback(
    (pos: number, d: number, center = false) => {
      const el = scroller.current;
      if (!el) return;
      const y = head + pos * ROW_H;
      if (center) vs.scrollTo(y - head - (vs.height - head) / 2);
      else if (y < vs.top + head) vs.scrollTo(y - head);
      else if (y + ROW_H > vs.top + vs.height) vs.scrollTo(y + ROW_H - vs.height);
      if (d >= frozenCount && d < order.length) {
        const x = xs[d]!;
        const w = xs[d + 1]! - x;
        if (x < el.scrollLeft + frozenRight) el.scrollLeft = x - frozenRight;
        else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
      }
    },
    [head, vs, frozenCount, order.length, xs, frozenRight],
  );

  useImperativeHandle(ref, () => ({ reveal, focus: () => scroller.current?.focus() }), [reveal]);

  const move = (pos: number, d: number, extend: boolean) => {
    const r = Math.max(0, Math.min(rowCount - 1, pos));
    const c = Math.max(0, Math.min(order.length - 1, d));
    onSelection(extend ? { ...selection, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c });
    reveal(r, c);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (onKey?.(e)) {
      e.preventDefault();
      return;
    }
    const page = Math.max(1, Math.floor((vs.height - head) / ROW_H) - 1);
    const mod = e.ctrlKey || e.metaKey;
    const { r1, c1 } = selection;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        move(mod ? rowCount - 1 : r1 + 1, c1, e.shiftKey);
        break;
      case 'ArrowUp':
        move(mod ? 0 : r1 - 1, c1, e.shiftKey);
        break;
      case 'ArrowRight':
        move(r1, mod ? order.length - 1 : c1 + 1, e.shiftKey);
        break;
      case 'ArrowLeft':
        move(r1, mod ? 0 : c1 - 1, e.shiftKey);
        break;
      case 'PageDown':
        move(r1 + page, c1, e.shiftKey);
        break;
      case 'PageUp':
        move(r1 - page, c1, e.shiftKey);
        break;
      case 'Home':
        move(mod ? 0 : r1, 0, e.shiftKey);
        break;
      case 'End':
        move(mod ? rowCount - 1 : r1, order.length - 1, e.shiftKey);
        break;
      case 'Enter':
        onOpenRow?.(r1);
        break;
      case 'a':
        if (!mod) handled = false;
        else onSelection({ r0: 0, c0: 0, r1: rowCount - 1, c1: order.length - 1 });
        break;
      case 'c':
        if (!mod) handled = false;
        else onCopy?.(selection);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const startResize = (e: React.PointerEvent, col: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[col] ?? 120;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMoveP = (ev: PointerEvent) => onResize?.(col, Math.max(48, Math.min(900, startW + ev.clientX - startX)));
    const onUp = () => {
      target.removeEventListener('pointermove', onMoveP);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMoveP);
    target.addEventListener('pointerup', onUp);
  };

  const cellBox = (d: number) => {
    const sticky = d < frozenCount;
    return {
      width: xs[d + 1]! - xs[d]!,
      ...(sticky ? { position: 'sticky' as const, left: xs[d]!, zIndex: 2 } : {}),
    };
  };

  const spacerW = c0 > frozenCount ? xs[c0]! - frozenRight : 0;

  // Header.
  // Header and filter cells do not depend on the scroll position; keep them out of per-frame renders.
  const headCells = useMemo(() => display.map((d) => {
    const col = order[d]!;
    const info = columns[col];
    const sortIndex = sort.findIndex((s) => s.col === col);
    const s = sortIndex >= 0 ? sort[sortIndex] : undefined;
    const numeric = info?.type === 'number';
    return (
      <div
        key={col}
        role="columnheader"
        aria-sort={s ? (s.desc ? 'descending' : 'ascending') : 'none'}
        draggable={!!onMove}
        onDragStart={(e) => {
          dragging.current = true;
          setDrag(d);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(d));
        }}
        onDragOver={(e) => {
          if (drag === null) return;
          e.preventDefault();
          setDropAt(d);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drag !== null && drag !== d) onMove?.(drag, d);
          setDrag(null);
          setDropAt(null);
        }}
        onDragEnd={() => {
          dragging.current = false;
          setDrag(null);
          setDropAt(null);
        }}
        style={cellBox(d)}
        className={cn(
          'group/h relative flex h-full shrink-0 items-center border-r border-b bg-card',
          d === frozenCount - 1 && 'border-r-2',
          dropAt === d && drag !== null && drag !== d && 'bg-primary/10',
          d >= sel.left && d <= sel.right && 'bg-muted',
        )}
      >
        <button
          type="button"
          onClick={(e) => onSort?.(col, e.shiftKey)}
          title={`${info?.name ?? ''} · click to sort, Shift+click to add a sort level`}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-2.5 text-left text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset',
            numeric && 'flex-row-reverse text-right',
          )}
        >
          <span className="min-w-0 truncate">{info?.name}</span>
          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[0.6rem] font-normal text-muted-foreground">
            {TYPE_MARK[info?.type ?? 'text']}
          </span>
          {s ? (
            <span className="flex shrink-0 items-center text-primary">
              <HugeiconsIcon icon={s.desc ? ArrowDown01Icon : ArrowUp01Icon} strokeWidth={2.4} className="size-3.5" />
              {sort.length > 1 ? <span className="text-[0.6rem] font-bold">{sortIndex + 1}</span> : null}
            </span>
          ) : null}
        </button>
        {columnMenu ? (
          <div className="shrink-0 pr-1 opacity-60 group-hover/h:opacity-100 focus-within:opacity-100">{columnMenu(col)}</div>
        ) : null}
        {onResize ? (
          <span
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${info?.name ?? 'column'}`}
            onPointerDown={(e) => startResize(e, col)}
            onDoubleClick={() => onResize(col, 120)}
            className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-primary/40"
          />
        ) : null}
      </div>
    );
  // cellBox/startResize derive from xs, frozenCount and widths, which are listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [display, order, columns, sort, widths, xs, frozenCount, drag, dropAt, sel.left, sel.right, columnMenu, onSort, onMove, onResize]);

  const filterCells = useMemo(() => showFilters
    ? display.map((d) => {
        const col = order[d]!;
        const err = filterError?.col === col ? filterError.message : null;
        return (
          <div key={col} style={cellBox(d)} className={cn('flex h-full shrink-0 items-center border-r border-b bg-card px-1', d === frozenCount - 1 && 'border-r-2')}>
            <input
              value={filters?.[col] ?? ''}
              onChange={(e) => onFilter?.(col, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onFilter?.(col, '');
              }}
              placeholder="Filter…"
              aria-label={`Filter ${columns[col]?.name ?? ''}`}
              aria-invalid={err ? true : undefined}
              title={err ?? 'text, =exact, !not, >5, 1..10, = for empty, /regex/'}
              className={cn(
                'h-6 w-full min-w-0 rounded border border-transparent bg-muted/60 px-1.5 text-xs text-foreground outline-none placeholder:text-faint focus:border-ring focus:bg-background',
                (filters?.[col] ?? '') && 'border-primary/50 bg-primary/8',
                err && 'border-destructive bg-destructive/10',
              )}
            />
          </div>
        );
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    : null, [showFilters, display, order, filters, filterError, columns, xs, frozenCount, onFilter]);

  // Rows sit in a container anchored every 64 rows, so scrolling only re-renders rows that change.
  const anchor = Math.floor(first / 64) * 64;
  const rows: ReactNode[] = [];
  for (let pos = first; pos < last; pos++) {
    const inRows = pos >= sel.top && pos <= sel.bottom;
    rows.push(
      <GridRow
        key={pos}
        pos={pos}
        top={(pos - anchor) * ROW_H}
        data={getRow(pos)}
        cols={cellCols}
        gutter={gutter}
        total={total}
        label={(rowNumber ? rowNumber(pos) : pos + 1).toLocaleString()}
        selLeft={inRows ? sel.left : -1}
        selRight={inRows ? sel.right : -1}
        focusD={pos === selection.r1 ? selection.c1 : -1}
        needle={needle}
        currentCol={current && current.pos === pos ? current.col : -1}
        spacerW={spacerW}
        frozenCount={frozenCount}
      />,
    );
  }

  return (
    <div
      ref={scroller}
      tabIndex={0}
      role="grid"
      aria-label={label}
      aria-rowcount={rowCount + 1}
      aria-colcount={order.length}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('input, button, [role=separator]')) return;
        const cell = target.closest<HTMLElement>('[data-row]');
        if (!cell) return;
        e.preventDefault();
        scroller.current?.focus();
        const pos = Number(cell.dataset.row);
        if (cell.dataset.col === undefined) {
          onSelection(e.shiftKey ? { ...selection, r1: pos, c1: order.length - 1 } : { r0: pos, c0: 0, r1: pos, c1: order.length - 1 });
          onOpenRow?.(pos);
          return;
        }
        const d = Number(cell.dataset.col);
        onSelection(e.shiftKey ? { ...selection, r1: pos, c1: d } : { r0: pos, c0: d, r1: pos, c1: d });
        const onOver = (ev: MouseEvent) => {
          const over = (ev.target as HTMLElement).closest<HTMLElement>('[data-row][data-col]');
          if (over) onSelection({ r0: e.shiftKey ? selection.r0 : pos, c0: e.shiftKey ? selection.c0 : d, r1: Number(over.dataset.row), c1: Number(over.dataset.col) });
        };
        const onUp = () => {
          window.removeEventListener('mouseover', onOver);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mouseover', onOver);
        window.addEventListener('mouseup', onUp);
      }}
      onDoubleClick={(e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-row][data-col]');
        if (cell) onOpenRow?.(Number(cell.dataset.row));
      }}
      className="relative min-h-0 flex-1 overflow-auto bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
    >
      <div style={{ height: Math.max(vs.spacer, head), width: total }} className="relative">
        <div role="rowgroup" className="sticky top-0 z-10" style={{ width: total }}>
          <div role="row" className="flex" style={{ height: HEAD_H }}>
            <div className="sticky left-0 z-[3] shrink-0 border-r border-b bg-card" style={{ width: gutter }} />
            {headCells.map((cell, i) => (
              <div key={order[display[i]!]} className="contents">
                {i === frozenCount && spacerW > 0 ? <div aria-hidden style={{ width: spacerW }} className="shrink-0 border-b bg-card" /> : null}
                {cell}
              </div>
            ))}
            <div className="flex-1 border-b bg-card" />
          </div>
          {filterCells ? (
            <div className="flex" style={{ height: FILTER_H }}>
              <div className="sticky left-0 z-[3] shrink-0 border-r border-b bg-card" style={{ width: gutter }} />
              {filterCells.map((cell, i) => (
                <div key={order[display[i]!]} className="contents">
                  {i === frozenCount && spacerW > 0 ? <div aria-hidden style={{ width: spacerW }} className="shrink-0 border-b bg-card" /> : null}
                  {cell}
                </div>
              ))}
              <div className="flex-1 border-b bg-card" />
            </div>
          ) : null}
        </div>
        <div className="absolute left-0" style={{ top: head + anchor * ROW_H + vs.shift, width: total }}>
          {rows}
        </div>
      </div>
    </div>
  );
});

type CellCol = { d: number; col: number; width: number; left: number; numeric: boolean; edge: boolean };

const CELL = 'shrink-0 truncate border-r border-b px-2.5 text-[13px] leading-[29px] whitespace-pre';
const CELL_NUM = ' text-right font-mono text-[12.5px] tabular-nums';

/** One grid row. Memoised: scrolling re-renders only rows whose data or selection changed. */
const GridRow = memo(function GridRow({
  pos,
  top,
  data,
  cols,
  gutter,
  total,
  label,
  selLeft,
  selRight,
  focusD,
  needle,
  currentCol,
  spacerW,
  frozenCount,
}: {
  pos: number;
  top: number;
  data: string[] | undefined;
  cols: CellCol[];
  gutter: number;
  total: number;
  label: string;
  selLeft: number;
  selRight: number;
  focusD: number;
  needle: string;
  currentCol: number;
  spacerW: number;
  frozenCount: number;
}) {
  const odd = pos % 2 === 1;
  const cells: ReactNode[] = [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]!;
    if (i === frozenCount && spacerW > 0) cells.push(<div key="spacer" aria-hidden style={{ width: spacerW }} className="shrink-0" />);
    const v = data?.[c.col];
    const selected = selLeft >= 0 && c.d >= selLeft && c.d <= selRight;
    const isCurrent = currentCol === c.col;
    const hit = !!needle && !!v && v.toLowerCase().includes(needle);
    // One background, by precedence (no class merging per cell).
    const bg = isCurrent
      ? ' bg-warning/35'
      : selected
        ? ' bg-primary/14'
        : hit
          ? ' bg-warning/15'
          : c.left >= 0
            ? ' bg-card'
            : odd
              ? ' bg-muted/25'
              : '';
    const ring = c.d === focusD ? ' ring-2 ring-primary ring-inset' : isCurrent ? ' ring-2 ring-warning ring-inset' : '';
    cells.push(
      <div
        key={c.col}
        role="gridcell"
        data-row={pos}
        data-col={c.d}
        aria-selected={selected || undefined}
        style={c.left >= 0 ? { width: c.width, position: 'sticky', left: c.left, zIndex: 2 } : { width: c.width }}
        className={CELL + (c.numeric ? CELL_NUM : '') + (c.edge ? ' border-r-2' : '') + bg + ring}
      >
        {v === undefined ? <span className="inline-block h-2.5 w-2/3 animate-pulse rounded bg-muted align-middle" /> : v}
      </div>,
    );
  }
  return (
    <div role="row" aria-rowindex={pos + 2} className="absolute left-0 flex bg-background" style={{ top, width: total, height: ROW_H }}>
      <div
        role="rowheader"
        data-row={pos}
        className={
          'sticky left-0 z-[3] flex shrink-0 items-center justify-end border-r border-b pr-2 font-mono text-[0.68rem] tabular-nums select-none ' +
          (selLeft >= 0 ? 'bg-muted text-foreground' : 'bg-card text-faint')
        }
        style={{ width: gutter }}
      >
        {label}
      </div>
      {cells}
    </div>
  );
});

/** The kebab trigger used in header cells. */
export function HeaderMenuIcon() {
  return <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-3.5" />;
}
