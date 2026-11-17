import { abortError } from '../worker-host';
import { passwordMessage, unreadableMessage } from './messages';
import { assetUrl, loadPdfJs } from './render';

type PdfJsDocument = Awaited<ReturnType<typeof import('pdfjs-dist')['getDocument']>['promise']>;

/** A page as it is displayed: size in PDF points after its own /Rotate, which is also given. */
export type PreviewPageInfo = { width: number; height: number; rotation: 0 | 90 | 180 | 270 };

export type PreviewRenderOptions = {
  /** Target width of the image in device pixels. The height follows the page's aspect ratio. */
  width?: number;
  /** Or a scale, where 1 renders one pixel per PDF point. Ignored when `width` is set. */
  scale?: number;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  signal?: AbortSignal;
};

/**
 * An open PDF for on-demand rendering and text: thumbnails, previews, margin
 * detection, searching. Renders run one at a time, most recent request first,
 * so a grid that requests the visible pages renders those before stale ones.
 * Always call `close()`.
 */
export type PdfPreview = {
  readonly numPages: number;
  /** Displayed size and rotation of page `index` (0-based). */
  pageInfo(index: number): Promise<PreviewPageInfo>;
  /** Renders page `index` as an image blob. Rejects with an AbortError when `signal` fires. */
  renderPage(index: number, options?: PreviewRenderOptions): Promise<Blob>;
  /** Renders page `index` to raw pixels (for analysis, such as finding blank margins). */
  renderPixels(index: number, options?: Omit<PreviewRenderOptions, 'format' | 'quality'>): Promise<ImageData>;
  /** The page's text, items joined with spaces and lines with newlines. */
  pageText(index: number, signal?: AbortSignal): Promise<string>;
  close(): void;
};

// Browsers refuse canvases much beyond ~16k px a side.
const MAX_SIDE = 8192;

type Task = { run: () => Promise<void>; signal?: AbortSignal; reject: (err: unknown) => void };

export async function openPdfPreview(
  file: Blob,
  { signal, name = 'This PDF' }: { signal?: AbortSignal; name?: string } = {},
): Promise<PdfPreview> {
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
  let doc: PdfJsDocument;
  try {
    doc = await task.promise;
  } catch (err) {
    void task.destroy();
    if (signal?.aborted) throw abortError();
    if (err instanceof Error && err.name === 'PasswordException') throw new Error(passwordMessage(name));
    throw new Error(unreadableMessage(name, err instanceof Error ? err.message : String(err)));
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  let closed = false;
  const queue: Task[] = [];
  let busy = false;
  let canvas: HTMLCanvasElement | null = null;

  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length > 0) {
      // Newest first: what the user is looking at now beats what scrolled away.
      const next = queue.pop();
      if (!next) break;
      if (closed || next.signal?.aborted) {
        next.reject(abortError());
        continue;
      }
      await next.run();
    }
    busy = false;
  };

  function schedule<T>(fn: () => Promise<T>, taskSignal?: AbortSignal): Promise<T> {
    if (closed || taskSignal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      queue.push({
        signal: taskSignal,
        reject,
        run: () =>
          fn().then(resolve, (err: unknown) =>
            reject(closed || taskSignal?.aborted ? abortError() : err),
          ),
      });
      void pump();
    });
  }

  async function draw(index: number, options: PreviewRenderOptions): Promise<HTMLCanvasElement> {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    let scale = options.width ? options.width / base.width : (options.scale ?? 1);
    scale = Math.min(scale, MAX_SIDE / base.width, MAX_SIDE / base.height);
    const viewport = page.getViewport({ scale });
    canvas ??= document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const render = page.render({ canvas, viewport, background: '#ffffff' });
    const cancel = () => render.cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      await render.promise;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      page.cleanup();
    }
    return canvas;
  }

  const check = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= doc.numPages) {
      throw new RangeError(`Page ${index + 1} does not exist.`);
    }
  };

  return {
    numPages: doc.numPages,

    async pageInfo(index) {
      check(index);
      const page = await doc.getPage(index + 1);
      const view = page.getViewport({ scale: 1 });
      const rotation = (((page.rotate % 360) + 360) % 360) as PreviewPageInfo['rotation'];
      return { width: view.width, height: view.height, rotation };
    },

    renderPage(index, options = {}) {
      check(index);
      return schedule(async () => {
        const c = await draw(index, options);
        const type = `image/${options.format ?? 'jpeg'}`;
        return new Promise<Blob>((resolve, reject) =>
          c.toBlob(
            (b) => (b ? resolve(b) : reject(new Error(`Page ${index + 1} could not be encoded.`))),
            type,
            options.quality ?? 0.85,
          ),
        );
      }, options.signal);
    },

    renderPixels(index, options = {}) {
      check(index);
      return schedule(async () => {
        const c = await draw(index, options);
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('2D canvas is not available in this browser.');
        return ctx.getImageData(0, 0, c.width, c.height);
      }, options.signal);
    },

    async pageText(index, textSignal) {
      check(index);
      if (textSignal?.aborted) throw abortError();
      const page = await doc.getPage(index + 1);
      const content = await page.getTextContent();
      page.cleanup();
      if (textSignal?.aborted) throw abortError();
      let out = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        out += item.str;
        out += item.hasEOL ? '\n' : ' ';
      }
      return out;
    },

    close() {
      if (closed) return;
      closed = true;
      for (const t of queue.splice(0)) t.reject(abortError());
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      void task.destroy();
    },
  };
}
