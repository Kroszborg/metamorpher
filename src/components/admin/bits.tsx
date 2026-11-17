import { ArrowDownRight01Icon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat();

export const formatCount = (v: number) => (v < 10_000 ? full.format(v) : compact.format(v));
export const formatPct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(v >= 0.995 || v < 0.1 ? 0 : 1)}%`);
export function formatMs(ms: number | null) {
  if (ms === null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function rangeLabel(days: number) {
  return days === 1 ? 'today' : `the last ${days} days`;
}

/**
 * KPI tile: label, value and the change against the previous period of the
 * same length. Up is good for every metric shown here; the direction is also
 * spelled out (icon + text), never colour alone.
 */
export function KpiTile({
  label,
  value,
  now,
  before,
  days,
  isRate = false,
}: {
  label: string;
  value: string;
  now: number | null;
  before: number | null;
  days: number;
  isRate?: boolean;
}) {
  let delta: ReactNode = <span className="text-muted-foreground">No earlier data</span>;
  if (now !== null && before !== null && (before > 0 || isRate)) {
    const diff = isRate ? (now - before) * 100 : ((now - before) / before) * 100;
    const flat = Math.abs(diff) < 0.5;
    const up = diff > 0;
    delta = (
      <span className={cn('inline-flex flex-wrap items-center gap-x-1', flat ? 'text-muted-foreground' : up ? 'text-success' : 'text-destructive')}>
        {flat ? null : (
          <HugeiconsIcon icon={up ? ArrowUpRight01Icon : ArrowDownRight01Icon} strokeWidth={2} className="size-3.5" />
        )}
        {flat ? 'No change' : `${up ? '+' : '−'}${Math.abs(diff).toFixed(Math.abs(diff) < 10 ? 1 : 0)}${isRate ? ' pts' : '%'}`}
        <span className="text-muted-foreground">vs previous {days === 1 ? 'day' : `${days} days`}</span>
      </span>
    );
  } else if (now !== null && before === 0 && now > 0) {
    delta = <span className="text-muted-foreground">None in the previous {days === 1 ? 'day' : `${days} days`}</span>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-sans text-2xl font-semibold tracking-tight">{value}</span>
      <span className="text-xs/snug">{delta}</span>
    </div>
  );
}

/** Ranked horizontal bars, one hue, largest first; value printed beside each bar. */
export function RankedBars({
  rows,
  empty = 'No data in this period.',
  max = 10,
  unit = 'views',
}: {
  rows: { label: string; value: number; href?: string }[];
  empty?: string;
  max?: number;
  unit?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  const shown = rows.slice(0, max);
  const rest = rows.slice(max).reduce((n, r) => n + r.value, 0);
  const list = rest > 0 ? [...shown, { label: `Other (${rows.length - max})`, value: rest }] : shown;
  const top = Math.max(...list.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {list.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" title={`${r.label}: ${full.format(r.value)} ${unit}`}>
          <span className="truncate text-xs">
            {r.href ? (
              <Link href={r.href} className="underline-offset-4 hover:underline">
                {r.label}
              </Link>
            ) : (
              r.label
            )}
          </span>
          <span className="text-right text-xs font-medium tabular-nums">{full.format(r.value)}</span>
          <span className="col-span-2 block h-2 rounded-r-[4px]" style={{ width: `${Math.max(1, (r.value / top) * 100)}%`, background: 'var(--chart-1)' }} />
        </li>
      ))}
    </ul>
  );
}

export function RangePicker({ path, range }: { path: string; range: number }) {
  const opts = [
    { v: 1, label: 'Today' },
    { v: 7, label: '7 days' },
    { v: 30, label: '30 days' },
    { v: 90, label: '90 days' },
  ];
  return (
    <nav aria-label="Date range" className="inline-flex gap-1 rounded-lg border bg-background p-1">
      {opts.map((o) => (
        <Link
          key={o.v}
          href={`${path}?range=${o.v}`}
          aria-current={o.v === range ? 'true' : undefined}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            o.v === range ? 'bg-muted text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
