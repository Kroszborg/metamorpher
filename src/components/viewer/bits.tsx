'use client';

import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** A horizontal tool strip at the top of a viewer. Wraps on narrow screens. */
export function Toolbar({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="toolbar"
      className={cn('flex min-h-11 flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ToolbarSep({ className }: { className?: string }) {
  return <span aria-hidden className={cn('mx-1 h-5 w-px shrink-0 bg-border', className)} />;
}

/** An icon button with a label for screen readers and a native tooltip. */
export function IconButton({
  icon,
  label,
  pressed,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'children'> & {
  icon: IconSvgElement;
  label: string;
  pressed?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-primary/12 text-foreground ring-1 ring-primary/30 hover:bg-primary/15',
        className,
      )}
      {...props}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
      {children}
    </button>
  );
}

/** A small text button for toolbars ("Fit", "100%"). */
export function ChipButton({
  pressed,
  className,
  ...props
}: React.ComponentProps<'button'> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-primary/12 text-foreground ring-1 ring-primary/30',
        className,
      )}
      {...props}
    />
  );
}

/** A compact native select for toolbars. */
export function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <label className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span className="max-sm:sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
        className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-grid h-5 min-w-5 place-items-center rounded border bg-background px-1 font-mono text-[0.68rem] text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A centred message inside a viewer: damaged file, unsupported format, nothing to show. */
export function ViewerProblem({
  title,
  children,
  actions,
  icon = Alert02Icon,
  tone = 'warning',
  className,
}: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: IconSvgElement;
  tone?: 'warning' | 'neutral';
  className?: string;
}) {
  return (
    <div role={tone === 'warning' ? 'alert' : 'status'} className={cn('grid h-full min-h-60 place-items-center p-6', className)}>
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <span
          className={cn(
            'mb-1 grid size-11 place-items-center rounded-full',
            tone === 'warning' ? 'bg-warning/12 text-warning' : 'bg-muted text-muted-foreground',
          )}
        >
          <HugeiconsIcon icon={icon} strokeWidth={2} className="size-5" />
        </span>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {children ? <div className="text-xs/relaxed text-muted-foreground">{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A loading line for viewers that parse before they can show anything. */
export function ViewerLoading({ label, progress }: { label: string; progress?: number }) {
  return (
    <div role="status" className="grid h-full min-h-60 place-items-center p-6">
      <div className="flex w-64 max-w-full flex-col items-center gap-3 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          {progress === undefined ? (
            <div className="h-full w-full animate-pulse rounded-full bg-primary/50" />
          ) : (
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Label/value rows for info panels. */
export function InfoRows({ rows, className }: { rows: [label: string, value: React.ReactNode][]; className?: string }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  return (
    <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs', className)}>
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A side panel title row. */
export function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
      <h3 className="font-display text-xs font-semibold tracking-wide text-foreground uppercase">{children}</h3>
      {action}
    </div>
  );
}
