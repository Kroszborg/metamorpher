import '@/lib/polyfills';
import { abortError } from '../worker-host';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;
let parserWorker: Worker | null = null;

/** Loads pdf.js on first use and points it at our self-hosted parsing worker. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    parserWorker ??= new Worker(new URL('./pdfjs.worker.ts', import.meta.url), { type: 'module' });
    pdfjs.GlobalWorkerOptions.workerPort = parserWorker;
    return pdfjs;
  });
  return pdfjsPromise;
}

/** Self-hosted pdf.js resources, copied into public/vendor by scripts/copy-runtime-assets.mjs. */
export function assetUrl(path: string): string {
  return new URL(`/vendor/pdfjs/${path}`, window.location.origin).href;
}

export type RenderFormat = 'png' | 'jpeg';

export type RenderOptions = {
  /** Output resolution; 72 renders one pixel per PDF point. */
  dpi: number;
  format: RenderFormat;
  /** JPEG quality, 0–1. */
  quality?: number;
  signal?: AbortSignal;
  /**
   * Receives each page as soon as it is encoded. Pages are rendered one at a
   * time into a single reused canvas, so memory stays flat for long documents.
   */
  onPage: (page: { index: number; total: number; blob: Blob }) => Promise<void> | void;
};

// Browsers refuse canvases much beyond ~16k px a side or ~268M px in total.
const MAX_SIDE = 16_384;
const MAX_AREA = 120_000_000;

export async function renderPdfPages(file: Blob, options: RenderOptions): Promise<number> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    standardFontDataUrl: assetUrl('standard_fonts/'),
    cMapUrl: assetUrl('cmaps/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    disableWorkerRendering: true,
  });
  const onAbort = () => void task.destroy();
  signal?.addEventListener('abort', onAbort, { once: true });

  const canvas = document.createElement('canvas');
  try {
    const doc = await task.promise;
    const total = doc.numPages;
    for (let n = 1; n <= total; n += 1) {
      if (signal?.aborted) throw abortError();
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = options.dpi / 72;
      scale = Math.min(
        scale,
        MAX_SIDE / base.width,
        MAX_SIDE / base.height,
        Math.sqrt(MAX_AREA / (base.width * base.height)),
      );
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error(`Page ${n} could not be encoded.`))),
          `image/${options.format}`,
          options.quality ?? 0.92,
        ),
      );
      page.cleanup();
      await options.onPage({ index: n - 1, total, blob });
    }
    return total;
  } catch (err) {
    if (signal?.aborted) throw abortError();
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Remove the password first.');
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // Release the bitmap memory right away instead of waiting for GC.
    canvas.width = 0;
    canvas.height = 0;
    await task.destroy();
  }
}
