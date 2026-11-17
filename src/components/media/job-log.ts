import { useSyncExternalStore } from 'react';
import type { MediaReport } from '@/engines/media';

export type JobLogEntry = { name: string; output: string; size: number; report: MediaReport };

export type JobLog = {
  push(entry: JobLogEntry): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly JobLogEntry[];
};

const EMPTY: readonly JobLogEntry[] = [];

/**
 * A small store a media tool's job (defined at module scope) writes engine
 * reports into, and its component reads with `useJobLog`.
 */
export function createJobLog(): JobLog {
  let entries: readonly JobLogEntry[] = EMPTY;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    push(entry) {
      entries = [...entries, entry];
      emit();
    },
    clear() {
      if (entries.length === 0) return;
      entries = EMPTY;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => entries,
  };
}

export function useJobLog(log: JobLog): readonly JobLogEntry[] {
  return useSyncExternalStore(log.subscribe, log.getSnapshot, () => EMPTY);
}
