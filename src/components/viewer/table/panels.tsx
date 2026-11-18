'use client';

import { Cancel01Icon, Copy01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { IconButton, PanelTitle } from '../bits';
import type { ColumnStats, ColType } from './engine';

const fmt = (v: number | undefined, digits = 4) =>
  v === undefined || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits });

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`Copied ${what}`),
    () => toast.error('Copy failed.'),
  );
}

const TYPE_LABEL: Record<ColType, string> = { number: 'Numbers', date: 'Dates', boolean: 'Yes / no', text: 'Text', empty: 'Empty' };

/** Statistics of one column over the rows in view. */
export function StatsPanel({
  name,
  stats,
  loading,
  filtered,
  onFilterValue,
  onClose,
}: {
  name: string;
  stats: ColumnStats | null;
  loading: boolean;
  filtered: boolean;
  onFilterValue: (value: string) => void;
  onClose: () => void;
}) {
  const maxBin = stats?.histogram ? Math.max(...stats.histogram.map((b) => b.count), 1) : 1;
  const maxTop = stats?.top ? Math.max(...stats.top.map((b) => b.count), 1) : 1;
  const rows: [string, string][] = stats
    ? [
        ['Type', TYPE_LABEL[stats.type]],
        ['Rows', fmt(stats.rows, 0)],
        ['Values', fmt(stats.count, 0)],
        ['Empty / null', `${fmt(stats.nulls, 0)}${stats.rows ? ` (${((stats.nulls / stats.rows) * 100).toFixed(1)}%)` : ''}`],
        ['Distinct', `${fmt(stats.distinct, 0)}${stats.distinctCapped ? '+' : ''}`],
        ...(stats.min !== undefined ? ([['Min', stats.min], ['Max', stats.max ?? '—']] as [string, string][]) : []),
        ...(stats.mean !== undefined
          ? ([
              ['Mean', fmt(stats.mean)],
              ['Std. dev.', fmt(stats.std)],
              ['Sum', fmt(stats.sum)],
            ] as [string, string][])
          : []),
        ...(stats.type === 'text' && stats.minLength !== undefined
          ? ([['Length', `${stats.minLength}–${stats.maxLength} (mean ${fmt(stats.meanLength, 1)})`]] as [string, string][])
          : []),
      ]
    : [];
  return (
    <>
      <PanelTitle action={<IconButton icon={Cancel01Icon} label="Close the statistics" className="h-7 min-w-7" onClick={onClose} />}>
        Column · {name}
      </PanelTitle>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
        {loading || !stats ? (
          <p className="text-xs text-muted-foreground">Counting…</p>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 truncate text-right font-mono text-foreground tabular-nums" title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            {stats.histogram && stats.histogram.length > 1 ? (
              <section aria-label="Distribution">
                <h4 className="mb-1.5 text-xs font-medium text-foreground">Distribution</h4>
                <div className="flex h-24 items-end gap-px" role="img" aria-label={`Histogram of ${name}`}>
                  {stats.histogram.map((b) => (
                    <div
                      key={b.label}
                      title={`${b.label}: ${b.count.toLocaleString()}`}
                      className="min-h-px flex-1 rounded-t-[2px] bg-primary/70 hover:bg-primary"
                      style={{ height: `${(b.count / maxBin) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between font-mono text-[0.65rem] text-muted-foreground">
                  <span>{stats.min}</span>
                  <span>{stats.max}</span>
                </div>
              </section>
            ) : null}
            {stats.top?.length ? (
              <section aria-label="Most common values">
                <h4 className="mb-1.5 text-xs font-medium text-foreground">Most common</h4>
                <ul className="flex flex-col gap-1">
                  {stats.top.map((t) => (
                    <li key={t.value}>
                      <button
                        type="button"
                        onClick={() => onFilterValue(t.value)}
                        title="Show only rows with this value"
                        className="relative flex w-full items-center justify-between gap-2 overflow-hidden rounded px-1.5 py-0.5 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <span className="absolute inset-y-0 left-0 bg-primary/12" style={{ width: `${(t.count / maxTop) * 100}%` }} />
                        <span className="relative min-w-0 truncate">{t.value || <em className="text-faint">(empty)</em>}</span>
                        <span className="relative shrink-0 font-mono text-muted-foreground tabular-nums">{t.count.toLocaleString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <p className="text-[0.68rem] text-muted-foreground">
              {filtered ? 'Over the filtered rows.' : 'Over every row.'} Counted in {Math.round(stats.ms)} ms.
            </p>
          </>
        )}
      </div>
    </>
  );
}

/** Every field of one row. */
export function RowPanel({
  names,
  values,
  position,
  sourceRow,
  types,
  onClose,
  onPrev,
  onNext,
}: {
  names: string[];
  values: string[] | null;
  position: number;
  sourceRow: number | null;
  types: ColType[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const json = values
    ? JSON.stringify(Object.fromEntries(names.map((n, i) => [n, values[i] ?? ''])), null, 2)
    : '';
  return (
    <>
      <PanelTitle action={<IconButton icon={Cancel01Icon} label="Close the row" className="h-7 min-w-7" onClick={onClose} />}>
        Row {(position + 1).toLocaleString()}
      </PanelTitle>
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <button type="button" className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onPrev}>
          ← Previous
        </button>
        <button type="button" className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onNext}>
          Next →
        </button>
        <span className="flex-1" />
        <IconButton icon={Copy01Icon} label="Copy the row as JSON" className="h-7 min-w-7" onClick={() => copy(json, 'the row as JSON')} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {sourceRow !== null && sourceRow > 0 ? (
          <p className="border-b px-3 py-1.5 text-[0.68rem] text-muted-foreground">Line {sourceRow.toLocaleString()} of the file</p>
        ) : null}
        <dl className="divide-y">
          {names.map((n, i) => {
            const v = values?.[i] ?? '';
            return (
              <div key={`${n}-${i}`} className="group/r flex flex-col gap-0.5 px-3 py-1.5">
                <dt className="flex items-center justify-between gap-2 text-[0.68rem] font-medium text-muted-foreground">
                  <span className="truncate">{n}</span>
                  <button
                    type="button"
                    className="opacity-0 transition-opacity group-hover/r:opacity-100 focus-visible:opacity-100"
                    onClick={() => copy(v, n)}
                    aria-label={`Copy ${n}`}
                  >
                    Copy
                  </button>
                </dt>
                <dd
                  className={cn(
                    'text-xs break-words whitespace-pre-wrap text-foreground',
                    types[i] === 'number' && 'font-mono tabular-nums',
                    !v && 'text-faint italic',
                  )}
                >
                  {values ? v || '(empty)' : '…'}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </>
  );
}
