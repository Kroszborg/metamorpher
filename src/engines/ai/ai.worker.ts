/// <reference lib="webworker" />
/**
 * On-device models with Transformers.js (Apache-2.0) and ONNX Runtime Web.
 *
 * - The ONNX Runtime wasm is served from this origin (/vendor/ort), never a CDN.
 * - Model files come from huggingface.co only while a call says `allowDownload`
 *   (the user pressed "Download"); otherwise every remote request is refused here,
 *   so a missing model fails with MODEL_NOT_DOWNLOADED instead of fetching.
 * - Downloaded files live in Cache Storage under `metamorpher-models`.
 */
import {
  AutoTokenizer,
  env,
  InterruptableStoppingCriteria,
  pipeline,
  RawImage,
  StyleTextToSpeech2Model,
  Tensor,
  TextStreamer,
} from '@huggingface/transformers';
import { expose, transfer } from 'comlink';
import { MODEL_CACHE } from './cache';
import type { Device, DtypeSpec } from './catalog';
const NOT_DOWNLOADED = 'MODEL_NOT_DOWNLOADED';

let allowDownload = false;
let blockedRequests = 0;
const realFetch: typeof fetch = (input, init) => fetch(input, init);

function urlOf(input: RequestInfo | URL): URL {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(href, self.location.href);
}

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.cacheKey = MODEL_CACHE;
// The service worker already caches /vendor; do not keep a second copy of the runtime.
env.useWasmCache = false;
env.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = urlOf(input);
  if (url.origin === self.location.origin) return realFetch(input, init);
  const head = (init?.method ?? 'GET').toUpperCase() === 'HEAD';
  if (!allowDownload) {
    if (!head) blockedRequests += 1;
    return new Response(null, { status: 404, statusText: 'Not downloaded' });
  }
  if (url.hostname !== 'huggingface.co') return new Response(null, { status: 403, statusText: 'Host not allowed' });
  return realFetch(input, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
};
const onnx = env.backends.onnx;
if (onnx.wasm) {
  const base = `${self.location.origin}/vendor/ort/`;
  onnx.wasm.wasmPaths = {
    mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`,
  };
  // The site is not cross-origin isolated, so WebAssembly threads are unavailable.
  onnx.wasm.numThreads = 1;
  onnx.wasm.proxy = false;
}

export type LoadOptions = { repo: string; device: Device; dtype: DtypeSpec; allowDownload: boolean };
export type LoadProgress = (loaded: number, total: number) => void;

type Callable = (...args: unknown[]) => Promise<unknown>;
type Loaded = { key: string; run: Callable & { dispose?: () => Promise<void> } };

/** One loaded pipeline per task kind: switching models frees the previous one. */
const loaded = new Map<string, Loaded>();

async function load(task: string, opts: LoadOptions, onProgress?: LoadProgress): Promise<Callable> {
  const key = `${opts.repo}|${opts.device}|${JSON.stringify(opts.dtype)}`;
  const current = loaded.get(task);
  if (current?.key === key) return current.run;
  if (current) {
    loaded.delete(task);
    await current.run.dispose?.().catch(() => {});
  }
  allowDownload = opts.allowDownload;
  blockedRequests = 0;
  try {
    const run = (await pipeline(task as Parameters<typeof pipeline>[0], opts.repo, {
      device: opts.device,
      dtype: opts.dtype as never,
      progress_callback: (info: unknown) => {
        const i = info as { status?: string; loaded?: number; total?: number };
        if (i.status === 'progress_total' && typeof i.loaded === 'number' && typeof i.total === 'number') {
          onProgress?.(i.loaded, i.total);
        }
      },
    })) as unknown as Loaded['run'];
    loaded.set(task, { key, run });
    return run;
  } catch (err) {
    if (!opts.allowDownload && blockedRequests > 0) {
      throw new Error(`${NOT_DOWNLOADED}: ${opts.repo} is not in this browser's model storage.`);
    }
    throw err;
  } finally {
    allowDownload = false;
  }
}

// ── Kokoro text-to-speech ───────────────────────────────────────────────

/** Voices offered by the PDF to audio tool (all downloaded with the model, ~0.5 MB each). */
export const KOKORO_VOICES = ['af_heart', 'af_bella', 'am_michael', 'am_fenrir', 'bf_emma', 'bm_george'] as const;

type Tts = {
  key: string;
  model: StyleTextToSpeech2Model;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  voices: Map<string, Float32Array>;
};
let tts: Tts | null = null;

async function loadVoice(repo: string, voice: string, allow: boolean): Promise<Float32Array> {
  const url = `https://huggingface.co/${repo}/resolve/main/voices/${voice}.bin`;
  const cache = await caches.open(MODEL_CACHE);
  let res = await cache.match(url);
  if (!res) {
    if (!allow) throw new Error(`${NOT_DOWNLOADED}: voice ${voice} is not in this browser's model storage.`);
    const fresh = await realFetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!fresh.ok) throw new Error(`The voice ${voice} could not be downloaded (${fresh.status}).`);
    await cache.put(url, fresh.clone());
    res = fresh;
  }
  return new Float32Array(await res.arrayBuffer());
}

async function loadTts(opts: LoadOptions, onProgress?: LoadProgress): Promise<Tts> {
  const key = `${opts.repo}|${opts.device}|${JSON.stringify(opts.dtype)}`;
  if (tts?.key === key) return tts;
  tts = null;
  allowDownload = opts.allowDownload;
  blockedRequests = 0;
  try {
    const progress_callback = (info: unknown) => {
      const i = info as { status?: string; loaded?: number; total?: number };
      if (i.status === 'progress_total' && typeof i.loaded === 'number' && typeof i.total === 'number') onProgress?.(i.loaded, i.total);
    };
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(opts.repo, { device: opts.device, dtype: opts.dtype as never, progress_callback }),
      AutoTokenizer.from_pretrained(opts.repo, { progress_callback }),
    ]);
    const voices = new Map<string, Float32Array>();
    for (const v of KOKORO_VOICES) voices.set(v, await loadVoice(opts.repo, v, opts.allowDownload));
    tts = { key, model, tokenizer, voices };
    return tts;
  } catch (err) {
    if (!opts.allowDownload && (blockedRequests > 0 || (err instanceof Error && err.message.includes(NOT_DOWNLOADED)))) {
      throw new Error(`${NOT_DOWNLOADED}: ${opts.repo} is not in this browser's model storage.`);
    }
    throw err;
  } finally {
    allowDownload = false;
  }
}

type GenMessage = { role: 'system' | 'user' | 'assistant'; content: string };
let stopper: InterruptableStoppingCriteria | null = null;

type Rgba = { data: Uint8ClampedArray; width: number; height: number };

const api = {
  /** Loads (and with `allowDownload`, downloads) a model without running it. */
  async ensure(task: string, opts: LoadOptions, onProgress?: LoadProgress): Promise<void> {
    if (task === 'text-to-audio') await loadTts(opts, onProgress);
    else await load(task, opts, onProgress);
  },

  /**
   * Speaks each text with Kokoro (24 kHz mono), with a short pause between
   * them, and returns the samples. `onDone` reports each finished text.
   */
  async speak(
    opts: LoadOptions,
    texts: string[],
    voice: string,
    speed: number,
    onDone: (index: number) => void,
  ): Promise<Float32Array> {
    const t = await loadTts(opts);
    const style = t.voices.get(voice) ?? t.voices.get(KOKORO_VOICES[0]);
    if (!style) throw new Error('The voice is missing.');
    const { toPhonemes } = await import('./kokoro-text');
    const pieces: Float32Array[] = [];
    const gap = new Float32Array(Math.round(24_000 * 0.28));
    for (const [i, text] of texts.entries()) {
      const phonemes = await toPhonemes(text, voice.startsWith('b'));
      if (phonemes) {
        const { input_ids } = t.tokenizer(phonemes, { truncation: true }) as { input_ids: Tensor };
        const len = input_ids.dims.at(-1) ?? 0;
        const offset = 256 * Math.min(Math.max(len - 2, 0), 509);
        const out = (await t.model({
          input_ids,
          style: new Tensor('float32', style.slice(offset, offset + 256), [1, 256]),
          speed: new Tensor('float32', [speed], [1]),
        })) as { waveform: Tensor };
        pieces.push(new Float32Array(out.waveform.data as Float32Array), gap);
      }
      onDone(i);
    }
    const total = pieces.reduce((n, p) => n + p.length, 0);
    const all = new Float32Array(total);
    let at = 0;
    for (const p of pieces) {
      all.set(p, at);
      at += p.length;
    }
    return transfer(all, [all.buffer]);
  },

  /** Mean-pooled, normalised sentence embeddings, one row per text. */
  async embed(opts: LoadOptions, texts: string[], onProgress?: (done: number) => void): Promise<Float32Array> {
    const run = await load('feature-extraction', opts);
    const batch = 16;
    let dims = 0;
    const rows: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batch) {
      const out = (await run(texts.slice(i, i + batch), { pooling: 'mean', normalize: true })) as {
        data: Float32Array;
        dims: number[];
      };
      dims = out.dims[1] ?? 0;
      rows.push(new Float32Array(out.data));
      onProgress?.(Math.min(texts.length, i + batch));
    }
    const all = new Float32Array(texts.length * dims);
    let at = 0;
    for (const r of rows) {
      all.set(r, at);
      at += r.length;
    }
    return transfer(all, [all.buffer]);
  },

  /** Streams a chat answer token by token. `stop()` ends it early. */
  async generate(
    opts: LoadOptions,
    messages: GenMessage[],
    maxNewTokens: number,
    onText: (piece: string) => void,
  ): Promise<string> {
    const run = (await load('text-generation', opts)) as Callable & { tokenizer: unknown };
    stopper = new InterruptableStoppingCriteria();
    let text = '';
    const streamer = new TextStreamer(run.tokenizer as ConstructorParameters<typeof TextStreamer>[0], {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (piece: string) => {
        text += piece;
        onText(piece);
      },
    });
    try {
      await run(messages, {
        max_new_tokens: maxNewTokens,
        do_sample: false,
        repetition_penalty: 1.1,
        streamer,
        stopping_criteria: stopper,
      });
    } finally {
      stopper = null;
    }
    return text;
  },

  stop(): void {
    stopper?.interrupt();
  },

  /** Whisper on one stretch of 16 kHz mono audio (≤ 30 s), with segment timestamps. */
  async transcribe(
    opts: LoadOptions,
    audio: Float32Array,
    language: string | null,
  ): Promise<{ text: string; chunks: { start: number; end: number | null; text: string }[] }> {
    const run = await load('automatic-speech-recognition', opts);
    const out = (await run(audio, {
      return_timestamps: true,
      task: 'transcribe',
      ...(language ? { language } : {}),
    })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
    return {
      text: out.text,
      chunks: (out.chunks ?? []).map((c) => ({ start: c.timestamp[0], end: c.timestamp[1], text: c.text })),
    };
  },

  /** Foreground mask (0–255, one byte per pixel) at the image's own size. */
  async segment(opts: LoadOptions, image: Rgba): Promise<Uint8Array> {
    const run = await load('background-removal', opts);
    const raw = new RawImage(image.data, image.width, image.height, 4).rgb();
    const out = (await run(raw)) as RawImage;
    const rgba = out.channels === 4 ? out : out.rgba();
    const mask = new Uint8Array(image.width * image.height);
    const d = rgba.data;
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] ?? 0;
    return transfer(mask, [mask.buffer]);
  },

  /**
   * Super-resolution in tiles: each tile is run with a margin of real
   * neighbouring pixels and only its centre is kept, so tiles meet without seams
   * and memory stays bounded by the tile size.
   */
  async upscale(
    opts: LoadOptions,
    image: Rgba,
    scale: number,
    tile: number,
    onTile: (done: number, total: number) => void,
  ): Promise<Rgba> {
    const run = await load('image-to-image', opts);
    const { width, height, data } = image;
    const margin = 16;
    const outW = width * scale;
    const outH = height * scale;
    const out = new Uint8ClampedArray(outW * outH * 4);
    const cols = Math.ceil(width / tile);
    const rows = Math.ceil(height / tile);
    const total = cols * rows;
    let done = 0;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const x0 = tx * tile;
        const y0 = ty * tile;
        const x1 = Math.min(width, x0 + tile);
        const y1 = Math.min(height, y0 + tile);
        const px0 = Math.max(0, x0 - margin);
        const py0 = Math.max(0, y0 - margin);
        const px1 = Math.min(width, x1 + margin);
        const py1 = Math.min(height, y1 + margin);
        const pw = px1 - px0;
        const ph = py1 - py0;
        const rgb = new Uint8ClampedArray(pw * ph * 3);
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const s = ((py0 + y) * width + (px0 + x)) * 4;
            const t = (y * pw + x) * 3;
            rgb[t] = data[s] ?? 0;
            rgb[t + 1] = data[s + 1] ?? 0;
            rgb[t + 2] = data[s + 2] ?? 0;
          }
        }
        const result = (await run(new RawImage(rgb, pw, ph, 3))) as RawImage;
        const rw = result.width;
        const rc = result.channels;
        const rd = result.data;
        // Copy the scaled centre (x0..x1, y0..y1) of this tile into place; alpha is taken from the source.
        for (let y = y0 * scale; y < y1 * scale; y++) {
          const sy = y - py0 * scale;
          for (let x = x0 * scale; x < x1 * scale; x++) {
            const sx = x - px0 * scale;
            const s = (sy * rw + sx) * rc;
            const t = (y * outW + x) * 4;
            out[t] = rd[s] ?? 0;
            out[t + 1] = rd[s + 1] ?? 0;
            out[t + 2] = rd[s + 2] ?? 0;
            out[t + 3] = data[((Math.floor(y / scale) * width + Math.floor(x / scale)) * 4) + 3] ?? 255;
          }
        }
        done += 1;
        onTile(done, total);
      }
    }
    return transfer({ data: out, width: outW, height: outH }, [out.buffer]);
  },

  /** Frees every loaded model in this worker. */
  async dispose(): Promise<void> {
    tts = null;
    for (const [task, l] of loaded) {
      loaded.delete(task);
      await l.run.dispose?.().catch(() => {});
    }
  },
};

export type AiWorkerApi = typeof api;
expose(api);
