'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { engines, isAbortError } from '@/engines';
import { currentToolSlug, emit, errorCode } from '@/lib/events';
import { matchesAccept, newId } from '@/lib/files';
import type { FileStatus, InputFile, Job, JobContext, OutputFile, ResultFile } from './types';

export type WorkbenchPhase = 'idle' | 'running' | 'done';

export type UseWorkbenchOptions<O> = {
  job: Job<O>;
  options: O;
  accept: readonly string[];
  /** false: a new file replaces the current one. Default true (new files are appended). */
  multiple?: boolean;
};

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong while processing this file.';
}

/** "a.pdf", then "a (2).pdf", "a (3).pdf" for outputs that share a name in one run. */
function uniqueName(seen: Map<string, number>, name: string): string {
  const key = name.toLowerCase();
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  if (count === 1) return name;
  const dot = name.lastIndexOf('.');
  const candidate = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  return seen.has(candidate.toLowerCase()) ? uniqueName(seen, candidate) : (seen.set(candidate.toLowerCase(), 1), candidate);
}

/**
 * State and actions behind the workbench: the file list, per-file status,
 * the run (sequential, cancellable) and the results with their object URLs.
 */
export function useWorkbench<O>({ job, options, accept, multiple = true }: UseWorkbenchOptions<O>) {
  const [files, setFiles] = useState<InputFile[]>([]);
  const [statuses, setStatuses] = useState<Record<string, FileStatus>>({});
  const [results, setResults] = useState<ResultFile[]>([]);
  const [phase, setPhase] = useState<WorkbenchPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string | undefined>();

  const controller = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const names = useRef(new Map<string, number>());

  const revokeResults = useCallback(() => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    names.current.clear();
    setResults([]);
  }, []);

  // Leaving the page cancels the run and frees every result URL.
  useEffect(() => {
    const live = urls.current;
    return () => {
      controller.current?.abort();
      for (const url of live) URL.revokeObjectURL(url);
      live.clear();
    };
  }, []);

  const addFiles = useCallback(
    (incoming: readonly File[]) => {
      if (phase === 'running') return;
      const accepted = incoming.filter((f) => matchesAccept(f, accept));
      const skipped = incoming.length - accepted.length;
      if (skipped > 0) {
        toast.warning(
          skipped === 1
            ? `${incoming.find((f) => !matchesAccept(f, accept))?.name ?? 'A file'} is not supported here.`
            : `${skipped} files are not supported here and were skipped.`,
        );
      }
      if (accepted.length === 0) return;
      const added = (multiple ? accepted : accepted.slice(0, 1)).map((file) => ({
        id: newId(),
        file,
      }));
      setFiles((prev) => (multiple ? [...prev, ...added] : added));
      setStatuses((prev) => {
        const next = multiple ? { ...prev } : {};
        for (const f of added) next[f.id] = { state: 'ready' };
        return next;
      });
      if (!multiple) {
        revokeResults();
        setPhase('idle');
      }
    },
    [accept, multiple, phase, revokeResults],
  );

  const removeFile = useCallback(
    (id: string) => {
      if (phase === 'running') return;
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setStatuses(({ [id]: _removed, ...rest }) => rest);
    },
    [phase],
  );

  const moveFile = useCallback(
    (from: number, to: number) => {
      if (phase === 'running') return;
      setFiles((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        if (item) next.splice(to, 0, item);
        return next;
      });
    },
    [phase],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    revokeResults();
    setFiles([]);
    setStatuses({});
    setPhase('idle');
    setProgress(0);
    setNote(undefined);
  }, [revokeResults]);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const run = useCallback(async () => {
    if (phase === 'running' || files.length === 0) return;
    const abort = new AbortController();
    controller.current = abort;
    const inputs = files;
    revokeResults();
    setPhase('running');
    setProgress(0);
    setNote(undefined);
    setStatuses(Object.fromEntries(inputs.map((f) => [f.id, { state: 'queued' }])));
    // Usage event (in-page only; see lib/events): counts and sizes, never contents.
    const tool = currentToolSlug();
    const started = performance.now();
    const bytes = inputs.reduce((n, f) => n + f.file.size, 0);
    if (tool) emit({ type: 'run_start', tool, files: inputs.length, bytes });
    let firstError: unknown;

    const setStatus = (ids: string[], status: FileStatus) =>
      setStatuses((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = status;
        return next;
      });
    const publish = (outputs: OutputFile[], sourceId?: string) => {
      const items = outputs.map((o) => {
        const url = URL.createObjectURL(o.blob);
        urls.current.add(url);
        return { ...o, name: uniqueName(names.current, o.name), sourceId: o.sourceId ?? sourceId, id: newId('r'), url };
      });
      setResults((prev) => [...prev, ...items]);
    };

    const groups = job.mode === 'each' ? inputs.map((f) => [f]) : [inputs];
    let failed = 0;
    let cancelled = false;
    for (const [i, group] of groups.entries()) {
      const ids = group.map((f) => f.id);
      if (abort.signal.aborted) {
        cancelled = true;
        setStatus(ids, { state: 'cancelled' });
        continue;
      }
      setStatus(ids, { state: 'running', progress: 0 });
      // Engines post progress from workers, so a late message can arrive after
      // the call has settled; it must not flip a finished file back to a percentage.
      let live = true;
      const ctx: JobContext = {
        signal: abort.signal,
        engines,
        onProgress: (fraction, text) => {
          if (!live) return;
          const f = Math.min(1, Math.max(0, fraction));
          setStatus(ids, { state: 'running', progress: f });
          setProgress((i + f) / groups.length);
          setNote(text);
        },
      };
      try {
        const outputs = await job.run(group, options, ctx);
        live = false;
        if (abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        publish(outputs, job.mode === 'each' ? ids[0] : undefined);
        setStatus(ids, { state: 'done', progress: 1 });
      } catch (err) {
        live = false;
        if (abort.signal.aborted || isAbortError(err)) {
          cancelled = true;
          setStatus(ids, { state: 'cancelled' });
        } else {
          failed += group.length;
          firstError ??= err;
          setStatus(ids, { state: 'error', error: errorMessage(err) });
          if (job.mode === 'batch') toast.error(errorMessage(err));
        }
      }
      setProgress((i + 1) / groups.length);
    }

    controller.current = null;
    setNote(undefined);
    setPhase('done');
    if (tool) {
      emit({
        type: 'run_end',
        tool,
        outcome: cancelled ? 'cancelled' : failed > 0 ? 'failed' : 'success',
        files: inputs.length,
        bytes,
        durationMs: Math.round(performance.now() - started),
        errorCode: failed > 0 ? errorCode(firstError) : undefined,
        names: inputs.map((f) => f.file.name),
      });
    }
    if (cancelled) toast.info('Cancelled.');
    else if (failed > 0 && job.mode === 'each') {
      toast.error(failed === inputs.length ? 'No files could be processed.' : `${failed} of ${inputs.length} files failed.`);
    }
  }, [files, job, options, phase, revokeResults]);

  return {
    files,
    statuses,
    results,
    phase,
    progress,
    note,
    running: phase === 'running',
    addFiles,
    removeFile,
    moveFile,
    reset,
    run,
    cancel,
  };
}

export type WorkbenchState = ReturnType<typeof useWorkbench>;
