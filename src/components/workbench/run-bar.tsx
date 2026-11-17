'use client';

import { Loading03Icon, PlayIcon, StopIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';

/** The primary action with overall progress and a cancel button while running. */
export function RunBar({
  label,
  running,
  progress,
  note,
  disabledReason,
  onRun,
  onCancel,
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
}) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {running ? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-3.5 shrink-0 animate-spin" />
              <span className="truncate">{note ?? 'Working on this device…'}</span>
            </span>
            <span className="font-mono tabular-nums text-foreground">{pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Progress"
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <Button variant="outline" size="lg" onClick={onCancel}>
            <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
            Cancel
          </Button>
        </>
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
