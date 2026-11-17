/**
 * On-device AI models (Transformers.js + ONNX Runtime Web) in module workers.
 *
 * Nothing is downloaded unless a call passes `allowDownload: true`, which the
 * tools only do after the user presses a "Download model" button that shows
 * the size and host. Each kind of work has its own worker, so cancelling a
 * transcription does not unload the chat model.
 */
import { proxy, type Remote } from 'comlink';
import { abortError, WorkerHost } from '@/engines/worker-host';
import type { AiWorkerApi, LoadOptions } from './ai.worker';
import { markDownloaded } from './cache';
import type { Device, ModelSpec, ModelTask } from './catalog';

export * from './cache';
export * from './catalog';
export * from './device';

const PIPELINE: Record<ModelTask, string> = {
  embed: 'feature-extraction',
  chat: 'text-generation',
  asr: 'automatic-speech-recognition',
  segment: 'background-removal',
  upscale: 'image-to-image',
  tts: 'text-to-audio',
};

const make = () =>
  new WorkerHost<AiWorkerApi>(
    () => new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module', name: 'metamorpher-ai' }),
  );
const hosts: Partial<Record<ModelTask, WorkerHost<AiWorkerApi>>> = {};
const hostFor = (task: ModelTask) => (hosts[task] ??= make());

export type RunOptions = {
  device: Device;
  /** Only true right after the user agreed to download this model. */
  allowDownload?: boolean;
  signal?: AbortSignal;
  /** Download / load progress in bytes. */
  onDownload?: (loaded: number, total: number) => void;
};

/** True for the error a call rejects with when the model is not in storage and downloading was not allowed. */
export function isNotDownloaded(err: unknown): boolean {
  return err instanceof Error && err.message.includes('MODEL_NOT_DOWNLOADED');
}

function opts(spec: ModelSpec, o: RunOptions): LoadOptions {
  return { repo: spec.repo, device: o.device, dtype: spec.dtype[o.device], allowDownload: !!o.allowDownload };
}

async function call<R>(spec: ModelSpec, o: RunOptions, fn: (api: Remote<AiWorkerApi>) => Promise<R>): Promise<R> {
  const host = hostFor(spec.task);
  // Load first (with progress), then run: a download is never started by a plain run.
  await host.call(
    (api) => api.ensure(PIPELINE[spec.task], opts(spec, o), o.onDownload ? proxy(o.onDownload) : undefined),
    o.signal,
  );
  if (o.allowDownload) markDownloaded(spec, o.device);
  return host.call(fn, o.signal);
}

export const localAi = {
  /** Downloads (when allowed) and loads a model, keeping it ready in its worker. */
  ensure(spec: ModelSpec, o: RunOptions): Promise<void> {
    return call(spec, o, async () => undefined);
  },

  /** Normalised embeddings, `dims` floats per text. */
  async embed(spec: ModelSpec, texts: string[], o: RunOptions & { onEmbedded?: (done: number) => void }): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const flat = await call(spec, o, (api) =>
      api.embed(opts(spec, o), texts, o.onEmbedded ? proxy(o.onEmbedded) : undefined),
    );
    const dims = flat.length / texts.length;
    return texts.map((_, i) => flat.subarray(i * dims, (i + 1) * dims));
  },

  /**
   * Streams an answer from a local chat model. Aborting stops generation
   * between tokens and keeps the model loaded.
   */
  async generate(
    spec: ModelSpec,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    o: RunOptions & { maxNewTokens?: number; onText?: (piece: string, full: string) => void },
  ): Promise<string> {
    const host = hostFor('chat');
    await host.call((api) => api.ensure(PIPELINE.chat, opts(spec, o), o.onDownload ? proxy(o.onDownload) : undefined), o.signal);
    if (o.allowDownload) markDownloaded(spec, o.device);
    let full = '';
    const onAbort = () => void host.call((api) => api.stop()).catch(() => {});
    o.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const text = await host.call((api) =>
        api.generate(
          opts(spec, o),
          messages,
          o.maxNewTokens ?? 512,
          proxy((piece: string) => {
            full += piece;
            o.onText?.(piece, full);
          }),
        ),
      );
      if (o.signal?.aborted) throw abortError();
      return text;
    } finally {
      o.signal?.removeEventListener('abort', onAbort);
    }
  },

  /** One ≤ 30 s window of 16 kHz mono audio. */
  transcribe(spec: ModelSpec, audio: Float32Array, language: string | null, o: RunOptions) {
    return call(spec, o, (api) => api.transcribe(opts(spec, o), audio, language));
  },

  /** Foreground mask (one byte per pixel) for an RGBA image. */
  segment(spec: ModelSpec, image: ImageData, o: RunOptions): Promise<Uint8Array> {
    return call(spec, o, (api) =>
      api.segment(opts(spec, o), { data: image.data, width: image.width, height: image.height }),
    );
  },

  /** Tiled super-resolution of an RGBA image. */
  upscale(
    spec: ModelSpec,
    image: ImageData,
    o: RunOptions & { tile?: number; onTile?: (done: number, total: number) => void },
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
    return call(spec, o, (api) =>
      api.upscale(
        opts(spec, o),
        { data: image.data, width: image.width, height: image.height },
        spec.scale ?? 2,
        o.tile ?? 128,
        proxy((d: number, t: number) => o.onTile?.(d, t)),
      ),
    );
  },

  /** Kokoro speech for each text (24 kHz mono samples, short pauses between texts). */
  speak(
    spec: ModelSpec,
    texts: string[],
    o: RunOptions & { voice: string; speed?: number; onSpoken?: (index: number) => void },
  ): Promise<Float32Array> {
    return call(spec, o, (api) =>
      api.speak(opts(spec, o), texts, o.voice, o.speed ?? 1, proxy((i: number) => o.onSpoken?.(i))),
    );
  },

  /** Stops every model worker and frees their memory. */
  terminateAll(): void {
    for (const h of Object.values(hosts)) h?.terminate();
  },
};
