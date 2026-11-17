import { proxy, type Remote } from 'comlink';
import { FfmpegInputTooLargeError, ffmpegEngine } from '@/engines/ffmpeg';
import { baseName, extensionOf, mimeFor } from '@/lib/files';
import { abortError, isAbortError, WorkerHost } from '../worker-host';
import { convertPlan, type FfmpegPlan, gifPlanArgs, gifToVideoArgs, mergeArgs } from './ffmpeg-args';
import type { MediaWorkerApi } from './media.worker';
import { CONTAINERS, containerForExtension, VIDEO_CODEC_LABEL } from './presets';
import type {
  Capabilities,
  Container,
  ConvertRequest,
  FallbackReason,
  GifRequest,
  GifToVideoRequest,
  MediaInfo,
  MediaReport,
  MediaResult,
  MergeRequest,
  VideoCodecId,
  WorkerOutcome,
} from './types';

export * from './presets';
export type * from './types';

/** Runs jobs; terminated when a job is cancelled. */
const jobs = new WorkerHost<MediaWorkerApi>(
  () => new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module' }),
);
/** Probes and capabilities, kept apart so cancelling a job or a preview does not cancel them. */
const inspector = new WorkerHost<MediaWorkerApi>(
  () => new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module' }),
);
/** Thumbnails, waveforms and GIF estimates for the UI; terminated when one of them is aborted. */
const previews = new WorkerHost<MediaWorkerApi>(
  () => new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module' }),
);

export type MediaCallOptions = {
  signal?: AbortSignal;
  /** 0–1 plus a short note naming the engine at work. */
  onProgress?: (fraction: number, note?: string) => void;
};

const FAST_LABEL = 'Mediabunny · WebCodecs';
const SLOW_LABEL = 'ffmpeg.wasm (software)';

/** "WebCodecs cannot decode HEVC video here, using the slower software engine." */
export function describeFallback(reason: FallbackReason): string {
  if (reason.code === 'webcodecs-error') return `WebCodecs could not ${reason.message}; using the slower software engine.`;
  return `WebCodecs cannot ${reason.message} in this browser; using the slower software engine.`;
}

let caps: Promise<Capabilities> | null = null;
const probes = new WeakMap<Blob, Promise<MediaInfo>>();

function inputExt(file: File): string {
  return extensionOf(file.name) || 'bin';
}

async function runFfmpeg(
  file: File,
  plan: FfmpegPlan,
  reason: FallbackReason,
  started: number,
  { signal, onProgress }: MediaCallOptions,
): Promise<MediaResult> {
  const note = `Software engine: ${describeFallback(reason).replace(/; using.*$/, '')}`;
  onProgress?.(0, note);
  try {
    const blob = await ffmpegEngine.run({
      input: file,
      inputExt: inputExt(file),
      outputExt: plan.ext,
      args: (input, output) => ['-hide_banner', ...plan.pre, '-i', input, ...plan.post, output],
      signal,
      onProgress: (f) => onProgress?.(f, note),
    });
    return {
      blob,
      ext: plan.ext,
      report: {
        engine: 'ffmpeg',
        engineLabel: SLOW_LABEL,
        fallback: reason,
        video: plan.video,
        audio: plan.audio,
        notes: plan.notes,
        ms: Date.now() - started,
      },
    };
  } catch (err) {
    if (err instanceof FfmpegInputTooLargeError) {
      throw new Error(`${describeFallback(reason).replace(/; using.*$/, '.')} ${err.message}`);
    }
    throw err;
  }
}

/**
 * The software path for Opus output: ffmpeg.wasm's libopus crashes on stereo
 * input, so ffmpeg only decodes (with trim, speed, sample rate and channels)
 * to PCM and WebCodecs encodes the Opus.
 */
async function decodeThenEncode(
  file: File,
  req: ConvertRequest,
  info: MediaInfo | null,
  reason: FallbackReason,
  started: number,
  { signal, onProgress }: MediaCallOptions,
): Promise<MediaResult> {
  const plan = convertPlan({ ...req, container: 'wav', video: { discard: true }, audio: { ...req.audio, bitrate: undefined } }, info);
  const pcm = await runFfmpeg(file, plan, reason, started, { signal, onProgress: (f, n) => onProgress?.(f * 0.6, n) });
  const wav = new File([pcm.blob], `${baseName(file.name)}.wav`, { type: 'audio/wav' });
  const bitrate = typeof req.audio?.bitrate === 'number' ? req.audio.bitrate : undefined;
  const outcome = await tryFast((api, p) => api.convert(wav, { container: req.container, video: { discard: true }, audio: { bitrate } }, p), {
    signal,
    onProgress: (f, n) => onProgress?.(0.6 + f * 0.4, n),
  });
  if (!outcome.ok) {
    throw new Error(`${describeFallback(reason).replace(/; using.*$/, '.')} Encoding the decoded audio failed too.`);
  }
  return {
    blob: fastResult(outcome, started).blob,
    ext: outcome.ext,
    report: {
      engine: 'ffmpeg',
      engineLabel: 'ffmpeg.wasm decode + WebCodecs encode',
      fallback: reason,
      audio: outcome.audio,
      notes: [...plan.notes, ...outcome.notes],
      ms: Date.now() - started,
    },
  };
}

function fastResult(outcome: Extract<WorkerOutcome, { ok: true }>, started: number): MediaResult {
  const report: MediaReport = {
    engine: 'mediabunny',
    engineLabel: FAST_LABEL,
    video: outcome.video,
    audio: outcome.audio,
    notes: outcome.notes,
    ms: Date.now() - started,
  };
  // Mediabunny names MP4 audio video/mp4; use this app's MIME type for the extension.
  const type = mimeFor(outcome.ext);
  const blob = outcome.blob.type === type ? outcome.blob : new Blob([outcome.blob], { type });
  return { blob, ext: outcome.ext, report };
}

/** Runs the worker; a thrown non-abort error becomes a fallback reason. */
async function tryFast(
  call: (api: Remote<MediaWorkerApi>, progress: (f: number) => void) => Promise<WorkerOutcome>,
  { signal, onProgress }: MediaCallOptions,
): Promise<WorkerOutcome> {
  onProgress?.(0, FAST_LABEL);
  const progress = proxy((f: number) => onProgress?.(f, FAST_LABEL));
  try {
    const outcome = await jobs.call((api) => call(api, progress), signal);
    if (outcome.recycle) jobs.terminate();
    return outcome;
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) throw abortError();
    // Start the next job on a clean worker (encoder registrations, half-closed decoders).
    jobs.terminate();
    const message = err instanceof Error ? err.message : String(err);
    // Errors about the input itself are not engine problems.
    if (/has no (audio|video)|no frames/i.test(message)) throw err;
    return { ok: false, fallback: { code: 'webcodecs-error', message: `finish (${message})` } };
  }
}

/**
 * Fallback decided before any work: what this browser's WebCodecs cannot do
 * for the given output, from cached capabilities. Null when the fast path
 * applies. Input-dependent reasons (an undecodable codec) are only known
 * once a file is probed or run.
 */
export function plannedFallback(
  c: Capabilities | null,
  container: Container | 'gif',
  videoCodec: VideoCodecId | 'auto' = 'auto',
): FallbackReason | null {
  if (container === 'gif') return null;
  const info = CONTAINERS[container];
  if (container === 'avi') return { code: 'container-write', message: 'write AVI files' };
  if (container === 'ogg' && !c?.audioEncode.includes('vorbis')) return { code: 'audio-encode', message: 'encode Vorbis audio' };
  if (!c || info.kind !== 'video') return null;
  const wanted = videoCodec === 'auto' ? info.video : [videoCodec];
  if (!wanted.some((v) => c.videoEncode.includes(v))) {
    const name = videoCodec === 'auto' ? `${info.label} video` : `${VIDEO_CODEC_LABEL[videoCodec]} video`;
    return { code: 'video-encode', message: `encode ${name}` };
  }
  return null;
}

/**
 * Media engine: Mediabunny on WebCodecs first (hardware-accelerated where the
 * device has it, streaming from the File, no size ceiling), ffmpeg.wasm when
 * WebCodecs cannot handle the input or output in this browser. Every result
 * carries a report naming the engine and, for a fallback, why.
 */
export const mediaEngine = {
  /** Codecs this browser can encode (cached). */
  capabilities(): Promise<Capabilities> {
    caps ??= inspector.call((api) => api.capabilities()).catch((err: unknown) => {
      caps = null;
      throw err;
    });
    return caps;
  },

  /**
   * Container, duration, tracks and codecs, read from the file's headers
   * (cached per File). Probes are quick and shared, so `signal` only stops
   * waiting for the result; it never kills the probing worker.
   */
  probe(file: File, signal?: AbortSignal): Promise<MediaInfo> {
    if (signal?.aborted) return Promise.reject(abortError());
    let p = probes.get(file);
    if (!p) {
      p = inspector.call((api) => api.probe(file)).catch((err: unknown) => {
        probes.delete(file);
        throw err;
      });
      probes.set(file, p);
    }
    return p;
  },

  /** Evenly spaced JPEG frames for a timeline. Empty when the video cannot be decoded here. */
  thumbnails(file: File, count: number, height: number, signal?: AbortSignal): Promise<Blob[]> {
    return previews.call((api) => api.thumbnails(file, count, height), signal);
  },

  /** Peak levels (0–1) of the audio in `buckets` equal slices, for a timeline. Empty without decodable audio. */
  waveform(file: File, buckets: number, signal?: AbortSignal): Promise<number[]> {
    return previews.call((api) => api.waveform(file, buckets), signal);
  },

  /** Estimated GIF size in bytes from three encoded sample frames, or null. */
  estimateGif(file: File, req: GifRequest, signal?: AbortSignal): Promise<number | null> {
    return previews.call((api) => api.estimateGif(file, req), signal);
  },

  async convert(file: File, req: ConvertRequest, opts: MediaCallOptions = {}): Promise<MediaResult> {
    const started = Date.now();
    const planned = plannedFallback(await this.capabilities().catch(() => null), req.container, req.video?.codec);
    const outcome: WorkerOutcome = planned
      ? { ok: false, fallback: planned }
      : await tryFast((api, p) => api.convert(file, req, p), opts);
    if (outcome.ok) return fastResult(outcome, started);
    const probed = await this.probe(file, opts.signal).catch(() => null);
    const info = probed?.readable ? probed : null;
    if (req.container === 'opus' && outcome.fallback.code !== 'audio-encode') {
      return decodeThenEncode(file, req, info, outcome.fallback, started, opts);
    }
    const same = containerForExtension(inputExt(file)) === req.container;
    return runFfmpeg(file, convertPlan(req, info, same), outcome.fallback, started, opts);
  },

  async videoToGif(file: File, req: GifRequest, opts: MediaCallOptions = {}): Promise<MediaResult> {
    const started = Date.now();
    const outcome = await tryFast((api, p) => api.videoToGif(file, req, p), opts);
    if (outcome.ok) return fastResult(outcome, started);
    return runFfmpeg(file, gifPlanArgs(req), outcome.fallback, started, opts);
  },

  async gifToVideo(file: File, req: GifToVideoRequest, opts: MediaCallOptions = {}): Promise<MediaResult> {
    const started = Date.now();
    const outcome = await tryFast((api, p) => api.gifToVideo(file, req, p), opts);
    if (outcome.ok) return fastResult(outcome, started);
    return runFfmpeg(file, gifToVideoArgs(req.container), outcome.fallback, started, opts);
  },

  async merge(files: File[], req: MergeRequest, opts: MediaCallOptions = {}): Promise<MediaResult> {
    const started = Date.now();
    const planned = plannedFallback(await this.capabilities().catch(() => null), req.container);
    const outcome: WorkerOutcome = planned
      ? { ok: false, fallback: planned }
      : await tryFast((api, p) => api.merge(files, req, p), opts);
    if (outcome.ok) return fastResult(outcome, started);
    const reason = outcome.fallback;
    const infos = await Promise.all(files.map((f) => this.probe(f, opts.signal).catch(() => null)));
    const [first, ...rest] = files;
    if (!first) throw new Error('Add clips to merge.');
    const note = `Software engine: ${describeFallback(reason).replace(/; using.*$/, '')}`;
    opts.onProgress?.(0, note);
    let built: ReturnType<typeof mergeArgs> | null = null;
    try {
      const blob = await ffmpegEngine.run({
        input: first,
        inputExt: inputExt(first),
        extraInputs: rest.map((f) => ({ blob: f, ext: inputExt(f) })),
        outputExt: CONTAINERS[req.container].ext,
        args: (input, output, extra) => {
          built = mergeArgs(req, infos.map((i) => (i?.readable ? i : null)), [input, ...extra]);
          return ['-hide_banner', ...built.args, output];
        },
        signal: opts.signal,
        onProgress: (f) => opts.onProgress?.(f, note),
      });
      const b = built as ReturnType<typeof mergeArgs> | null;
      return {
        blob,
        ext: CONTAINERS[req.container].ext,
        report: {
          engine: 'ffmpeg',
          engineLabel: SLOW_LABEL,
          fallback: reason,
          video: b?.video,
          audio: b?.audio,
          notes: [],
          ms: Date.now() - started,
        },
      };
    } catch (err) {
      if (err instanceof FfmpegInputTooLargeError) {
        throw new Error(`${describeFallback(reason).replace(/; using.*$/, '.')} ${err.message}`);
      }
      throw err;
    }
  },

  /** Stops any running job immediately. */
  terminate(): void {
    jobs.terminate();
  },
};

export type MediaEngine = typeof mediaEngine;
