import { abortError, WorkerHost } from '../worker-host';
import type { OcrPdfWorkerApi } from './ocr-pdf.worker';
import type { LayerLine, OcrBox, OcrLanguage, OcrLine, OcrPageInfo, OcrProgress, OcrRender, OcrResult, PageSheet } from './types';

export * from './types';
export { linesText, textLayerOps, toPageLines } from './text-layer';
export { analyse, evidence, inkBand, parsePgm, rotate as rotateGray, toPgm, unrotateResult } from './orient';

/**
 * Languages served from /vendor/tesseract/lang (Tesseract 4 LSTM models,
 * integer "best_int" builds from tessdata_best, Apache-2.0). A model is
 * fetched only when a recognition asks for it.
 */
export const OCR_LANGUAGES: readonly OcrLanguage[] = [
  { code: 'eng', label: 'English', bytes: 2_952_873 },
  { code: 'hin', label: 'Hindi', bytes: 1_389_692 },
  { code: 'mar', label: 'Marathi', bytes: 1_966_154 },
  { code: 'ben', label: 'Bengali', bytes: 1_373_429 },
  { code: 'tam', label: 'Tamil', bytes: 1_446_167 },
  { code: 'tel', label: 'Telugu', bytes: 1_735_518 },
  { code: 'spa', label: 'Spanish', bytes: 2_100_190 },
  { code: 'fra', label: 'French', bytes: 707_406 },
  { code: 'deu', label: 'German', bytes: 1_333_102 },
  { code: 'por', label: 'Portuguese', bytes: 1_392_239 },
  { code: 'ita', label: 'Italian', bytes: 1_660_998 },
  { code: 'rus', label: 'Russian', bytes: 2_679_598 },
  { code: 'ara', label: 'Arabic', bytes: 1_661_906 },
];

/** The recognition engine (Tesseract 5 LSTM in WebAssembly), about 2.9 MB, fetched once. */
export const OCR_ENGINE_BYTES = 2_870_000;

// ── Tesseract worker ─────────────────────────────────────────────────────
// tesseract.js's own worker script (Apache-2.0) runs as a classic worker from
// /vendor/tesseract; we speak its message protocol directly so nothing is
// fetched from a CDN and the language data is never cached in IndexedDB.

type Packet = { jobId: string; action: string; status: 'resolve' | 'reject' | 'progress'; data: unknown };
type TessBox = { x0: number; y0: number; x1: number; y1: number };
type TessWord = { text: string; confidence: number; bbox: TessBox };
type TessLine = { words: TessWord[]; bbox: TessBox; baseline?: TessBox | null };
type TessBlock = { paragraphs: { lines: TessLine[] }[] };
type TessResult = { text: string | null; confidence: number | null; blocks: TessBlock[] | null };

/** wasm-feature-detect's SIMD probe: a module using v128 ops validates only with SIMD support. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

class TesseractHost {
  #worker: Worker | null = null;
  #jobs = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: (p: number, status: string) => void }>();
  #nextJob = 1;
  #loaded: Promise<unknown> | null = null;
  #langs: string | null = null;
  #langsReady: Promise<unknown> | null = null;

  #start(): Worker {
    if (this.#worker) return this.#worker;
    const worker = new Worker(`${self.location.origin}/vendor/tesseract/worker.min.js`);
    worker.onmessage = (e: MessageEvent<Packet>) => {
      const { jobId, action, status, data } = e.data;
      const job = this.#jobs.get(`${action}-${jobId}`);
      if (!job) return;
      if (status === 'progress') {
        const p = data as { status?: string; progress?: number };
        job.progress?.(p.progress ?? 0, p.status ?? '');
        return;
      }
      this.#jobs.delete(`${action}-${jobId}`);
      if (status === 'resolve') job.resolve(data);
      else job.reject(new Error(typeof data === 'string' ? `Text recognition failed: ${data}` : 'Text recognition failed.'));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      this.terminate(new Error(e.message || 'The text recognition engine stopped unexpectedly.'));
    };
    this.#worker = worker;
    return worker;
  }

  #send(action: string, payload: unknown, progress?: (p: number, status: string) => void, transferList: Transferable[] = []): Promise<unknown> {
    const worker = this.#start();
    const jobId = `Job-${this.#nextJob}`;
    this.#nextJob += 1;
    return new Promise((resolve, reject) => {
      this.#jobs.set(`${action}-${jobId}`, { resolve, reject, progress });
      worker.postMessage({ workerId: 'Worker-mm', jobId, action, payload }, transferList);
    });
  }

  #load(): Promise<unknown> {
    if (!this.#loaded) {
      const simd = typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
      const core = `${self.location.origin}/vendor/tesseract/tesseract-core-${simd ? 'simd-' : ''}lstm.js`;
      this.#loaded = this.#send('load', { options: { lstmOnly: true, corePath: core, logging: false } });
    }
    return this.#loaded;
  }

  #languages(langs: string, progress?: OcrProgress): Promise<unknown> {
    if (this.#langs !== langs || !this.#langsReady) {
      this.#langs = langs;
      const note = 'Loading language data';
      this.#langsReady = this.#send(
        'loadLanguage',
        {
          langs,
          options: {
            langPath: `${self.location.origin}/vendor/tesseract/lang`,
            cacheMethod: 'none',
            gzip: true,
            lstmOnly: true,
          },
        },
        (p) => progress?.(p * 0.9, note),
      )
        .then(() => this.#send('initialize', { langs, oem: 1, config: {} }))
        .catch((err: unknown) => {
          this.#langs = null;
          this.#langsReady = null;
          throw err;
        });
    }
    return this.#langsReady;
  }

  async recognize(image: Uint8Array<ArrayBuffer>, langs: string, dpi: number | undefined, progress?: OcrProgress): Promise<TessResult> {
    progress?.(0, this.#loaded ? 'Recognising text' : 'Starting the text recognition engine');
    await this.#load();
    await this.#languages(langs, progress);
    return (await this.#send(
      'recognize',
      {
        image,
        options: { tessedit_pageseg_mode: '3', ...(dpi ? { user_defined_dpi: String(Math.round(dpi)) } : {}) },
        output: { text: true, blocks: true },
      },
      (p, status) => {
        if (status === 'recognizing text') progress?.(p, 'Recognising text');
      },
      [image.buffer],
    )) as TessResult;
  }

  terminate(reason: unknown = abortError()): void {
    const jobs = [...this.#jobs.values()];
    this.#jobs.clear();
    for (const job of jobs) job.reject(reason);
    this.#worker?.terminate();
    this.#worker = null;
    this.#loaded = null;
    this.#langs = null;
    this.#langsReady = null;
  }
}

const tesseract = new TesseractHost();

const box = (b: TessBox): OcrBox => [b.x0, b.y0, b.x1, b.y1];

function toResult(raw: TessResult, width: number, height: number): OcrResult {
  const lines: OcrLine[] = [];
  let confSum = 0;
  let confN = 0;
  for (const block of raw.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const words = line.words
          .filter((w) => w.text.trim().length > 0)
          .map((w) => ({ text: w.text, box: box(w.bbox), confidence: w.confidence }));
        if (words.length === 0) continue;
        for (const w of words) {
          confSum += w.confidence;
          confN += 1;
        }
        lines.push({ box: box(line.bbox), baseline: line.baseline ? box(line.baseline) : null, words });
      }
    }
  }
  return {
    width,
    height,
    text: (raw.text ?? '').replace(/\s+$/, ''),
    confidence: confN ? confSum / confN : 0,
    lines,
  };
}

/** Reads the width and height of a binary PGM/PPM header. */
function pnmSize(image: Uint8Array): { width: number; height: number } | null {
  const head = new TextDecoder().decode(image.subarray(0, 40));
  const m = /^P[56]\s+(\d+)\s+(\d+)/.exec(head);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

const pdfHost = new WorkerHost<OcrPdfWorkerApi>(
  () => new Worker(new URL('./ocr-pdf.worker.ts', import.meta.url), { type: 'module' }),
);

/**
 * A document open in the OCR worker: render a page, recognise it, add its
 * text layer, move on. Memory stays at about one page.
 */
export class OcrDocument {
  readonly pageCount: number;
  #signal: AbortSignal | undefined;

  private constructor(pageCount: number, signal: AbortSignal | undefined) {
    this.pageCount = pageCount;
    this.#signal = signal;
  }

  static async fromPdf(file: Blob, { password, signal }: { password?: string; signal?: AbortSignal } = {}): Promise<OcrDocument> {
    const n = await pdfHost.call((api) => api.openPdf(file, password), signal);
    return new OcrDocument(n, signal);
  }

  /** Images MuPDF can read (JPEG, PNG, GIF, BMP, TIFF), one page each (every page of a multi-page TIFF). */
  static async fromImages(images: Uint8Array[], { signal, sheet }: { signal?: AbortSignal; sheet?: PageSheet } = {}): Promise<OcrDocument> {
    const n = await pdfHost.call((api) => api.openImages(images, sheet), signal);
    return new OcrDocument(n, signal);
  }

  info(index: number): Promise<OcrPageInfo> {
    return pdfHost.call((api) => api.pageInfo(index), this.#signal);
  }

  render(index: number, dpi = 300): Promise<OcrRender> {
    return pdfHost.call((api) => api.render(index, dpi), this.#signal);
  }

  /** Turns a page clockwise by a multiple of 90° (the page's /Rotate; content untouched). */
  rotate(index: number, degrees: number): Promise<void> {
    return pdfHost.call((api) => api.rotate(index, degrees), this.#signal);
  }

  addTextLayer(index: number, lines: LayerLine[]): Promise<void> {
    return pdfHost.call((api) => api.addTextLayer(index, lines), this.#signal);
  }

  /** The finished PDF. The document is closed afterwards. */
  save(): Promise<Blob> {
    return pdfHost.call((api) => api.save(), this.#signal);
  }

  close(): void {
    void pdfHost.call((api) => Promise.resolve(api.close())).catch(() => undefined);
  }
}

/**
 * On-device text recognition (Tesseract.js 7 core, Apache-2.0). Lazy: the
 * engine and each language model are fetched from this origin on first use.
 * Aborting a call terminates the engine; the next call starts a fresh one.
 */
export const ocrEngine = {
  /**
   * Recognises an image: a binary PGM/PPM (what `OcrDocument.render` gives,
   * size read from its header) or an encoded PNG/JPEG/BMP with its size given.
   * `langs` are Tesseract codes ("eng", ["eng", "hin"]).
   */
  async recognize(
    image: Uint8Array<ArrayBuffer>,
    {
      langs,
      size,
      dpi,
      signal,
      onProgress,
    }: {
      langs: string | readonly string[];
      size?: { width: number; height: number };
      /** Resolution of the image, when known (it helps Tesseract size its expectations). */
      dpi?: number;
      signal?: AbortSignal;
      onProgress?: OcrProgress;
    },
  ): Promise<OcrResult> {
    if (signal?.aborted) throw abortError();
    const dims = size ?? pnmSize(image);
    if (!dims) throw new Error('The image size is unknown.');
    const codes = typeof langs === 'string' ? langs : langs.join('+');
    const onAbort = () => tesseract.terminate();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const raw = await tesseract.recognize(image, codes, dpi, onProgress);
      if (signal?.aborted) throw abortError();
      return toResult(raw, dims.width, dims.height);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },

  /** Stops the engines and frees their memory. */
  terminate(): void {
    tesseract.terminate();
    pdfHost.terminate();
  },
};

export type OcrEngine = typeof ocrEngine;

/** Total download for a set of languages plus the engine, for UI hints. */
export function ocrDownloadBytes(codes: readonly string[]): number {
  return OCR_ENGINE_BYTES + codes.reduce((n, c) => n + (OCR_LANGUAGES.find((l) => l.code === c)?.bytes ?? 0), 0);
}
