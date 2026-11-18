import type { FileStatus } from './types';

/** How the last run ended, for the run bar's finished state. */
export type RunOutcome = {
  kind: 'success' | 'partial' | 'failed' | 'cancelled';
  done: number;
  failed: number;
  cancelled: number;
};

/**
 * Derives the last run's outcome from workbench state (read-only). Null while
 * idle or running, or once every file from that run has been removed.
 */
export function runOutcome(wb: { phase: string; statuses: Record<string, FileStatus> }): RunOutcome | null {
  if (wb.phase !== 'done') return null;
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  for (const s of Object.values(wb.statuses)) {
    if (s.state === 'done') done += 1;
    else if (s.state === 'error') failed += 1;
    else if (s.state === 'cancelled') cancelled += 1;
  }
  if (done + failed + cancelled === 0) return null;
  const kind = failed > 0 ? (done > 0 ? 'partial' : 'failed') : cancelled > 0 ? 'cancelled' : 'success';
  return { kind, done, failed, cancelled };
}
