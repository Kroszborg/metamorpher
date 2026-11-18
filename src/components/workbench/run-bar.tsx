'use client';

import { Loading03Icon, PlayIcon, StopIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { DrawnCheck } from '@/components/ui/drawn-check';
import { cn } from '@/lib/utils';
import type { RunOutcome } from './outcome';

const FINISHED: Record<RunOutcome['kind'], { text: (o: RunOutcome) => string; tone: string; bar: string }> = {
  success: { text: () => 'Done. Your results are below.', tone: 'text-success', bar: 'bg-success' },
  partial: {
    text: (o) => `${o.failed} of ${o.done + o.failed + o.cancelled} failed. The rest are below.`,
    tone: 'text-destructive',
    bar: 'bg-destructive',
  },
  failed: { text: () => 'This could not be finished. See the file list.', tone: 'text-destructive', bar: 'bg-destructive' },
  cancelled: { text: () => 'Cancelled.', tone: 'text-muted-foreground', bar: 'bg-faint' },
};

/**
 * The primary action with overall progress and a cancel button while running.
 * Pass `outcome` (from `runOutcome(wb)`) to show how the last run ended: the
 * bar fills and a check draws in. Status and bar keep their place between
 * running and finished, so the panel does not jump.
 */
export function RunBar({
  label,
  running,
  progress,
  note,
  disabledReason,
  onRun,
  onCancel,
  outcome,
}: {
  label: string;
  running: boolean;
  /** 0–1 */
  progress: number;
  note?: string;
  /** When set, the run button is disabled and this explains why. */
  disabledReason?: string | null;
  onRun: () => void;
  onCancel: () => void;
  /** How the last run ended; omit for the plain idle state. */
  outcome?: RunOutcome | null;
}) {
  const pct = Math.round(progress * 100);
  const finished = !running && outcome ? outcome : null;
  const f = finished ? FINISHED[finished.kind] : null;
  const fill = finished ? (finished.kind === 'cancelled' ? progress : 1) : progress;
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {running || f ? (
        <div className="flex items-center justify-between gap-3 text-xs" role={f ? 'status' : undefined}>
          <span className={cn('flex min-w-0 items-center gap-2', f ? f.tone : 'text-muted-foreground')}>
            {f && finished ? (
              <span
                key={finished.kind}
                className={cn(
                  'grid size-4 shrink-0 animate-pop place-items-center rounded-full',
                  finished.kind === 'success' ? 'bg-success/15' : finished.kind === 'cancelled' ? 'bg-muted' : 'bg-destructive/15',
                )}
              >
                <DrawnCheck
                  kind={finished.kind === 'success' ? 'check' : 'cross'}
                  className="size-3"
                  strokeWidth={2.5}
                  delay={120}
                />
              </span>
            ) : (
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-3.5 shrink-0 animate-spin" />
            )}
            <span key={f ? 'done' : 'run'} className={cn('truncate', f && 'animate-fade')}>
              {f && finished ? f.text(finished) : (note ?? 'Working on this device…')}
            </span>
          </span>
          {running ? (
            <span
              className="tween-num font-mono text-foreground"
              data-suffix="%"
              style={{ '--tween-to': pct } as React.CSSProperties}
            >
              <span className="sr-only">{pct}%</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {running || f ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={finished ? Math.round(fill * 100) : pct}
          aria-label="Progress"
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full w-full origin-left rounded-full transition-[scale,background-color] duration-(--dur-3) ease-enter',
              f ? f.bar : 'bg-primary',
            )}
            style={{ scale: `${Math.max(0, Math.min(1, fill))} 1` }}
          />
        </div>
      ) : null}
      {running ? (
        <Button variant="outline" size="lg" onClick={onCancel} className="h-9 text-sm">
          <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
          Cancel
        </Button>
      ) : (
        <>
          <Button size="lg" onClick={onRun} disabled={Boolean(disabledReason)} className="h-9 text-sm">
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
            {label}
          </Button>
          {disabledReason ? <p className="text-center text-xs text-muted-foreground">{disabledReason}</p> : null}
        </>
      )}
    </div>
  );
}
