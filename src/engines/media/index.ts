import { proxy, type Remote } from 'comlink';
import { FfmpegInputTooLargeError, ffmpegEngine } from '@/engines/ffmpeg';
import { baseName, extensionOf, mimeFor } from '@/lib/files';
import { abortError, isAbortError, WorkerHost } from '../worker-host';
import { convertPlan, type FfmpegPlan, gifPlanArgs, gifToVideoArgs, mergeArgs, softTrimPlan } from './ffmpeg-args';
import { parseFfmpegProbe } from './ffmpeg-probe';
import type { MediaWorkerApi } from './media.worker';
import { CONTAINERS, containerForExtension, sameContainer, VIDEO_CODEC_LABEL } from './presets';
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
  TrimRequest,
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
const deepProbes = new WeakMap<Blob, Promise<MediaInfo>>();

/**
 * Whether the fast engine's reading of a file leaves out what a tool needs, so
 * ffmpeg should look at it: an unreadable container, a track whose codec
 * Mediabunny does not know (Theora, H.263, AMR), or an Ogg video read as audio only.
 */
function needsSoftwareProbe(file: File, info: MediaInfo): boolean {
  if (!info.readable) return true;
  if ((info.video && info.video.codec === null) || (info.audio && info.audio.codec === null)) return true;
  return extensionOf(file.name) === 'ogv' && !info.video;
}

/** A playable stand-in for the player: H.264/AAC MP4 (or M4A) at 360p or less. */
function proxyArgs(info: MediaInfo): { ext: string; post: string[]; bytes: number } {
  const audio = info.audio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2'] : ['-an'];
  if (!info.video) return { ext: 'm4a', post: ['-vn', ...audio, '-movflags', '+faststart'], bytes: (info.duration * 110_000) / 8 + 1e6 };
  const short = Math.min(info.video.width, info.video.height) || 360;
  const k = Math.min(1, 360 / short);
  const w = Math.max(2, Math.round((info.video.width * k) / 2) * 2);
  const h = Math.max(2, Math.round((info.video.height * k) / 2) * 2);
  return {
    ext: 'mp4',
    post: [
      '-map', '0:v:0', ...audio,
      '-vf', `scale=${w}:${h},setsar=1`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-g', '48',
      '-movflags', '+faststart',
    ],
    bytes: (info.duration * 900_000) / 8 + 1e6,
  };
}

function inputExt(file: File): string {
  return extensionOf(file.name) || 'bin';
}

async function runFfmpeg(
  file: File,
  plan: FfmpegPlan,
  reason: FallbackReason,
  started: number,
  { signal, onProgress }: MediaCallOptions,
  expectedOutputBytes?: number,
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
      expectedOutputBytes,
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

  /**
   * `probe`, and for files the fast engine cannot fully read (AVI, WMV, FLV,
   * MPEG-PS, OGV, 3GP with H.263…) what ffmpeg.wasm reads from them instead
   * (`engine: 'ffmpeg'`; loads the 31 MB core once). Cached per File.
   */
  inspect(file: File, signal?: AbortSignal): Promise<MediaInfo> {
    if (signal?.aborted) return Promise.reject(abortError());
    let p = deepProbes.get(file);
    if (!p) {
      p = (async () => {
        const fast = await this.probe(file).catch(() => null);
        if (fast && !needsSoftwareProbe(file, fast)) return fast;
        const log = await ffmpegEngine.inspect({ input: file, inputExt: inputExt(file) });
        const soft = parseFfmpegProbe(log, file.size);
        if (soft) return soft;
        if (fast) return fast;
        throw new Error('Neither engine can read this file. It may be damaged or not a media file.');
      })().catch((err: unknown) => {
        deepProbes.delete(file);
        throw err;
      });
      deepProbes.set(file, p);
    }
    return p;
  },

  /**
   * Evenly spaced JPEG frames for a timeline. Video the fast engine cannot
   * decode is read by ffmpeg.wasm (one run, one seek per frame). Empty when
   * neither can.
   */
  async thumbnails(file: File, count: number, height: number, signal?: AbortSignal): Promise<Blob[]> {
    const fast = await previews.call((api) => api.thumbnails(file, count, height), signal).catch((err: unknown) => {
      if (signal?.aborted || isAbortError(err)) throw err;
      return [] as Blob[];
    });
    if (fast.length) return fast;
    const info = await this.inspect(file, signal);
    if (!info.video || !(info.duration > 0) || (info.engine !== 'ffmpeg' && info.video.canDecode)) return [];
    const times = Array.from({ length: count }, (_, i) => (info.duration * (i + 0.5)) / count);
    const out = await ffmpegEngine.runMany({
      input: file,
      inputExt: inputExt(file),
      outputs: times.map((_, i) => `t${i}.jpg`),
      args: (input, outs) => [
        '-hide_banner',
        ...times.flatMap((t) => ['-ss', t.toFixed(3), '-i', input]),
        ...outs.flatMap((o, i) => ['-map', `${i}:v:0`, '-frames:v', '1', '-vf', `scale=-2:${height}`, '-q:v', '6', o]),
      ],
      expectedOutputBytes: count * 64 * 1024,
      signal,
    });
    return out.filter((b): b is Blob => b !== null);
  },

  /**
   * Peak levels (0–1) of the audio in `buckets` equal slices, for a timeline.
   * Audio the fast engine cannot decode is read by ffmpeg.wasm as low-rate
   * mono PCM. Empty without audio.
   */
  async waveform(file: File, buckets: number, signal?: AbortSignal): Promise<number[]> {
    const fast = await previews.call((api) => api.waveform(file, buckets), signal).catch((err: unknown) => {
      if (signal?.aborted || isAbortError(err)) throw err;
      return [] as number[];
    });
    if (fast.length) return fast;
    const info = await this.inspect(file, signal);
    if (!info.audio || !(info.duration > 0) || (info.engine !== 'ffmpeg' && info.audio.canDecode)) return [];
    // 8 kHz, lower for long files so the PCM stays under about 15 MB.
    const rate = Math.max(400, Math.min(8000, Math.floor(7_500_000 / info.duration)));
    const [pcm] = await ffmpegEngine.runMany({
      input: file,
      inputExt: inputExt(file),
      outputs: ['wave.pcm'],
      args: (input, [o]) => ['-hide_banner', '-i', input, '-map', '0:a:0', '-ac', '1', '-ar', String(rate), '-f', 's16le', o!],
      expectedOutputBytes: info.duration * rate * 2,
      signal,
    });
    if (!pcm) return [];
    const samples = new Int16Array(await pcm.arrayBuffer());
    const peaks = new Array<number>(buckets).fill(0);
    for (let i = 0; i < samples.length; i++) {
      const b = Math.min(buckets - 1, Math.floor((i / rate / info.duration) * buckets));
      const v = Math.abs(samples[i]!) / 32768;
      if (v > peaks[b]!) peaks[b] = v;
    }
    const max = Math.max(...peaks, 1e-6);
    return peaks.map((p) => Math.min(1, p / max));
  },

  /**
   * A small H.264/AAC copy (360p, low quality) of a file the browser cannot
   * play, made with ffmpeg.wasm, for the preview player. Same timeline as the
   * source, starting at 0.
   */
  async previewProxy(file: File, opts: MediaCallOptions = {}): Promise<Blob> {
    const info = await this.inspect(file, opts.signal);
    const p = proxyArgs(info);
    return ffmpegEngine.run({
      input: file,
      inputExt: inputExt(file),
      outputExt: p.ext,
      args: (input, output) => ['-hide_banner', '-i', input, ...p.post, output],
      expectedOutputBytes: p.bytes,
      signal: opts.signal,
      onProgress: (f) => opts.onProgress?.(f, 'Software engine: building a preview'),
    });
  },

  /**
   * Keeps `start`–`end` (seconds from the file's start) in the file's own
   * format. Precise mode re-encodes from the exact in point when needed; fast
   * mode copies from the key frame before it. Formats only ffmpeg reads are
   * cut by ffmpeg.wasm: fast mode copies the streams (any input size, as long
   * as the kept part fits the 1 GB output limit); precise mode re-encodes.
   */
  async trim(file: File, req: TrimRequest, opts: MediaCallOptions = {}): Promise<MediaResult> {
    const started = Date.now();
    const info = await this.inspect(file, opts.signal);
    const ext = inputExt(file);
    if (info.engine !== 'ffmpeg') {
      const container = sameContainer(ext, !!info.video);
      // A copied Ogg cut starts at a page boundary plus Opus pre-roll (0.4 s early, measured) and Ogg has no
      // edit list to hide it, so Ogg audio is always cut by re-encoding (at the source's bitrate).
      const ogg = !info.video && (container === 'opus' || container === 'ogg');
      const result = await this.convert(
        file,
        { container, video: { quality: 'copy' }, audio: { bitrate: 'copy' }, trim: ogg ? { ...req, accurate: true } : req },
        opts,
      );
      if (ogg && !req.accurate) result.report.notes.unshift('Ogg audio cannot be cut exactly without re-encoding, so this cut was re-encoded at the source’s bitrate.');
      return result;
    }
    const plan = softTrimPlan(info, ext, req);
    const reason: FallbackReason = info.readable
      ? { code: 'video-decode', message: `decode ${info.video?.label ?? info.audio?.label ?? ext.toUpperCase()}` }
      : { code: 'container-read', message: `read ${ext.toUpperCase()} files` };
    return runFfmpeg(file, plan, reason, started, opts, plan.expectedBytes);
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
    // What ffmpeg reads from files the fast engine cannot (bitrates and codecs for the plan's caps and copies).
    const probed = await this.inspect(file, opts.signal).catch(() => null);
    const info = probed && (probed.readable || probed.engine === 'ffmpeg') ? probed : null;
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
    const infos = await Promise.all(
      files.map((f) => this.inspect(f, opts.signal).then((i) => (i.readable || i.engine === 'ffmpeg' ? i : null), () => null)),
    );
    const [first, ...rest] = files;
    if (!first) throw new Error('Add clips to merge.');
    const note = `Software engine: ${describeFallback(reason).replace(/; using.*$/, '')}`;
    // This core's libopus only encodes mono reliably, so for Opus ffmpeg joins to PCM and WebCodecs encodes.
    const viaPcm = req.container === 'opus';
    const ffReq: MergeRequest = viaPcm ? { ...req, container: 'wav' } : req;
    opts.onProgress?.(0, note);
    let built: ReturnType<typeof mergeArgs> | null = null;
    try {
      const blob = await ffmpegEngine.run({
        input: first,
        inputExt: inputExt(first),
        extraInputs: rest.map((f) => ({ blob: f, ext: inputExt(f) })),
        outputExt: CONTAINERS[ffReq.container].ext,
        args: (input, output, extra) => {
          built = mergeArgs(ffReq, infos, [input, ...extra]);
          return ['-hide_banner', ...built.args, output];
        },
        signal: opts.signal,
        onProgress: (f) => opts.onProgress?.(viaPcm ? f * 0.7 : f, note),
      });
      const b = built as ReturnType<typeof mergeArgs> | null;
      if (viaPcm) {
        const wav = new File([blob], 'merged.wav', { type: 'audio/wav' });
        const encoded = await tryFast((api, p) => api.convert(wav, { container: 'opus', video: { discard: true }, audio: { bitrate: b?.audioBitrate ?? req.audioBitrate } }, p), {
          signal: opts.signal,
          onProgress: (f, n) => opts.onProgress?.(0.7 + f * 0.3, n),
        });
        if (!encoded.ok) throw new Error(`${describeFallback(reason).replace(/; using.*$/, '.')} Encoding the joined audio to Opus failed too.`);
        return {
          blob: fastResult(encoded, started).blob,
          ext: 'opus',
          report: {
            engine: 'ffmpeg',
            engineLabel: 'ffmpeg.wasm join + WebCodecs encode',
            fallback: reason,
            audio: encoded.audio,
            notes: ['Joined by the software engine, then encoded with WebCodecs (its Opus encoder keeps stereo).'],
            ms: Date.now() - started,
          },
        };
      }
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
