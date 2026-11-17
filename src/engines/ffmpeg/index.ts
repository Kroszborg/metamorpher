import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { mimeFor, newId } from '@/lib/files';
import { abortError } from '../worker-host';

/**
 * Same-origin copies of the @ffmpeg/ffmpeg wrapper (ESM, including its module
 * worker) and the single-thread core, written to public/vendor/ffmpeg by
 * scripts/copy-runtime-assets.mjs, which also checks that the core version
 * matches the wrapper's CORE_VERSION.
 *
 * The wrapper is imported from there at runtime rather than bundled: its
 * `new Worker(new URL(variable, import.meta.url))` cannot be bundled by
 * Turbopack, and unbundled it resolves its worker next to itself.
 */
function vendorUrl(path: string): string {
  return new URL(`/vendor/ffmpeg/${path}`, window.location.origin).href;
}

type FfmpegModule = typeof import('@ffmpeg/ffmpeg');

let instance: Promise<FFmpeg> | null = null;
let current: FFmpeg | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getInstance(): Promise<FFmpeg> {
  instance ??= (async () => {
    const { FFmpeg } = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ vendorUrl('wrapper/index.js')
    )) as FfmpegModule;
    const ffmpeg = new FFmpeg();
    current = ffmpeg;
    await ffmpeg.load({
      classWorkerURL: vendorUrl('wrapper/worker.js'),
      coreURL: vendorUrl('core/ffmpeg-core.js'),
      wasmURL: vendorUrl('core/ffmpeg-core.wasm'),
    });
    return ffmpeg;
  })().catch((err: unknown) => {
    terminate();
    throw err;
  });
  return instance;
}

function terminate(): void {
  current?.terminate();
  current = null;
  instance = null;
}

/**
 * Largest output this engine produces. Inputs are not copied: they are mounted
 * read-only (WORKERFS) and ffmpeg reads them from the File in small pieces, so
 * any input size works. The output, though, is written to ffmpeg's in-memory
 * file system and copied out once at the end, which takes about 2.3× its size
 * in the tab's memory at the peak. Past 1 GB of output that is enough to crash
 * a tab on an ordinary 8–16 GB machine.
 */
export const FFMPEG_MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;

/** The expected output is over FFMPEG_MAX_OUTPUT_BYTES. */
export class FfmpegInputTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `The result would be about ${formatGb(bytes)}; the software engine (ffmpeg.wasm) builds its output in memory and can make at most 1 GB. Trim a shorter part, lower the quality, or use a format your browser can process directly (MP4, WebM, MOV, MKV).`,
    );
    this.name = 'FfmpegInputTooLargeError';
  }
}

function formatGb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export type FfmpegJob = {
  input: Blob;
  /** Extension for the input's name, so ffmpeg can probe the container. */
  inputExt: string;
  /** More inputs (merging); their names are passed to `args` as `extra`. */
  extraInputs?: { blob: Blob; ext: string }[];
  outputExt: string;
  /** Builds the argument list from the input and output file names. */
  args: (input: string, output: string, extra: string[]) => string[];
  signal?: AbortSignal;
  /** Fraction 0–1 from ffmpeg's progress event. */
  onProgress?: (fraction: number) => void;
  /**
   * How big the output is expected to be, checked against the 1 GB output limit
   * before anything runs. Defaults to the total input size (most jobs keep or
   * shrink it); jobs that keep a small part of a large input pass less.
   */
  expectedOutputBytes?: number;
};

type Session = {
  ffmpeg: FFmpeg;
  /** Input paths: the main input first, then the extra inputs. */
  inputs: string[];
  /** A unique prefix for output files. */
  id: string;
  log: string[];
};

type SessionJob = Pick<FfmpegJob, 'input' | 'inputExt' | 'extraInputs' | 'signal' | 'onProgress'>;

/**
 * Loads the core (once), mounts the inputs read-only and runs `fn`; unmounts
 * and frees everything afterwards. Cancelling terminates the worker; the next
 * job loads a fresh one (the core is HTTP-cached).
 */
async function session<T>(job: SessionJob, fn: (s: Session) => Promise<T>): Promise<T> {
  const { signal } = job;
  if (signal?.aborted) throw abortError();
  const onAbort = () => terminate();
  signal?.addEventListener('abort', onAbort, { once: true });

  const id = newId('job');
  const dir = `/${id}`;
  const blobs = [
    { name: `in.${job.inputExt || 'bin'}`, data: job.input },
    ...(job.extraInputs ?? []).map((e, i) => ({ name: `in${i + 1}.${e.ext || 'bin'}`, data: e.blob })),
  ];
  const log: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    log.push(message);
    if (log.length > 400) log.shift();
  };
  const onProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) job.onProgress?.(Math.min(1, Math.max(0, progress)));
  };

  let ffmpeg: FFmpeg | null = null;
  let mounted = false;
  try {
    ffmpeg = await getInstance();
    if (signal?.aborted) throw abortError();
    ffmpeg.on('log', onLog);
    ffmpeg.on('progress', onProgress);
    await ffmpeg.createDir(dir);
    // WORKERFS reads the Blobs lazily (FileReaderSync in the worker): nothing is copied up front.
    await ffmpeg.mount('WORKERFS' as Parameters<FFmpeg['mount']>[0], { blobs }, dir);
    mounted = true;
    return await fn({ ffmpeg, inputs: blobs.map((b) => `${dir}/${b.name}`), id, log });
  } catch (err) {
    if (signal?.aborted) throw abortError();
    // A wasm trap ("memory access out of bounds") leaves the module unusable: start fresh next time.
    if (/RuntimeError|out of bounds|unreachable|Out of memory|Array buffer allocation/i.test(String(err))) terminate();
    if (err instanceof Error) throw err;
    // The wasm side rejects with plain values (file-system errno objects, strings).
    const what = typeof err === 'string' ? err : JSON.stringify(err);
    throw new Error(`ffmpeg could not process this file${detailOf(log) ? `: ${detailOf(log)}` : ` (${what})`}`);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (ffmpeg && ffmpeg === current) {
      ffmpeg.off('log', onLog);
      ffmpeg.off('progress', onProgress);
      if (mounted) await ffmpeg.unmount(dir).catch(() => undefined);
      await ffmpeg.deleteDir(dir).catch(() => undefined);
    }
  }
}

function detailOf(log: string[]): string {
  return log
    .filter((l) => /error|invalid|unknown|not |could|failed/i.test(l))
    .slice(-3)
    .join(' ');
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.catch(() => undefined);
  return result;
}

function inputBytes(job: Pick<FfmpegJob, 'input' | 'extraInputs'>): number {
  return job.input.size + (job.extraInputs ?? []).reduce((sum, e) => sum + e.blob.size, 0);
}

async function readOutput(s: Session, name: string, ext: string): Promise<Blob> {
  const data = await s.ffmpeg.readFile(name);
  await s.ffmpeg.deleteFile(name).catch(() => undefined);
  if (typeof data === 'string' || data.byteLength === 0) throw new Error('ffmpeg produced no output.');
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeFor(ext) });
}

async function runNow(job: FfmpegJob): Promise<Blob> {
  const expected = job.expectedOutputBytes ?? inputBytes(job);
  if (expected > FFMPEG_MAX_OUTPUT_BYTES) throw new FfmpegInputTooLargeError(expected);
  return session(job, async (s) => {
    const outName = `/${s.id}-out.${job.outputExt}`;
    try {
      const code = await s.ffmpeg.exec(job.args(s.inputs[0]!, outName, s.inputs.slice(1)));
      if (code !== 0) {
        const detail = detailOf(s.log);
        throw new Error(`ffmpeg could not convert this file${detail ? `: ${detail}` : '.'}`);
      }
      return await readOutput(s, outName, job.outputExt);
    } finally {
      await s.ffmpeg.deleteFile(outName).catch(() => undefined);
    }
  });
}

export type FfmpegMultiJob = SessionJob & {
  /** Output names (with extension) relative to the job; `args` receives their full paths in the same order. */
  outputs: string[];
  args: (input: string, outputs: string[]) => string[];
  expectedOutputBytes: number;
};

/** One run with several outputs (thumbnails). Outputs ffmpeg did not write come back as null. */
async function runManyNow(job: FfmpegMultiJob): Promise<(Blob | null)[]> {
  if (job.expectedOutputBytes > FFMPEG_MAX_OUTPUT_BYTES) throw new FfmpegInputTooLargeError(job.expectedOutputBytes);
  return session(job, async (s) => {
    const names = job.outputs.map((o) => `/${s.id}-${o}`);
    try {
      const code = await s.ffmpeg.exec(job.args(s.inputs[0]!, names));
      const out: (Blob | null)[] = [];
      for (const [i, name] of names.entries()) {
        const ext = job.outputs[i]!.split('.').pop() ?? 'bin';
        out.push(await readOutput(s, name, ext).catch(() => null));
      }
      if (code !== 0 && out.every((b) => !b)) {
        const detail = detailOf(s.log);
        throw new Error(`ffmpeg could not read this file${detail ? `: ${detail}` : '.'}`);
      }
      return out;
    } finally {
      for (const name of names) await s.ffmpeg.deleteFile(name).catch(() => undefined);
    }
  });
}

/** Runs `ffmpeg -i <input>` and returns its log (stream and duration lines). Reads only what it needs. */
async function inspectNow(job: SessionJob): Promise<string[]> {
  return session(job, async (s) => {
    await s.ffmpeg.exec(['-hide_banner', '-i', s.inputs[0]!]);
    return [...s.log];
  });
}

/**
 * ffmpeg engine (ffmpeg.wasm, single-thread core served from this origin).
 * Nothing is downloaded until the first job runs. Jobs run one at a time.
 */
export const ffmpegEngine = {
  run(job: FfmpegJob): Promise<Blob> {
    return enqueue(() => runNow(job));
  },

  /** Like `run`, with several named outputs. */
  runMany(job: FfmpegMultiJob): Promise<(Blob | null)[]> {
    return enqueue(() => runManyNow(job));
  },

  /** The log of `ffmpeg -i <input>`: container, duration, start time and stream lines. */
  inspect(job: SessionJob): Promise<string[]> {
    return enqueue(() => inspectNow(job));
  },

  terminate,
};

export type FfmpegEngine = typeof ffmpegEngine;
