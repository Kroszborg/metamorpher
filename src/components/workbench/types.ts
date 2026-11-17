import type { Engines } from '@/engines';

/** A file the user added. `id` is unique per added file (two files may share a name). */
export type InputFile = { id: string; file: File };

/** A file a job produced. Its MIME type is `blob.type`. */
export type OutputFile = {
  name: string;
  blob: Blob;
  /** The input it was made from; set automatically in 'each' mode. */
  sourceId?: string;
};

export type JobContext = {
  /** Fires when the user cancels or leaves the page. Pass it to every engine call. */
  signal: AbortSignal;
  /** Progress of this run call, 0–1, with an optional short note ("Page 3 of 12"). */
  onProgress: (fraction: number, note?: string) => void;
  engines: Engines;
};

/**
 * What a tool runs.
 * - 'each': `run` is called once per input file (with a one-element array),
 *   sequentially, and each file gets its own status. One failure does not stop the rest.
 * - 'batch': `run` is called once with every input, in list order (merge, images to PDF).
 */
export type Job<Options> = {
  mode: 'each' | 'batch';
  run: (inputs: InputFile[], options: Options, ctx: JobContext) => Promise<OutputFile[]>;
};

/** Identity helper that gives a job object its types. */
export function defineJob<Options>(job: Job<Options>): Job<Options> {
  return job;
}

export type FileState = 'ready' | 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export type FileStatus = { state: FileState; progress?: number; error?: string };

/** An output with a live object URL owned by the workbench (revoked on reset/unmount). */
export type ResultFile = OutputFile & { id: string; url: string };

/**
 * Shorthand for the common 'each' job: `fn` gets one input at a time and
 * returns one or more outputs for it.
 */
export function perFile<Options>(
  fn: (input: InputFile, options: Options, ctx: JobContext) => Promise<OutputFile | OutputFile[]>,
): Job<Options> {
  return {
    mode: 'each',
    async run(inputs, options, ctx) {
      const out: OutputFile[] = [];
      for (const input of inputs) {
        const result = await fn(input, options, ctx);
        out.push(...(Array.isArray(result) ? result : [result]));
      }
      return out;
    },
  };
}
