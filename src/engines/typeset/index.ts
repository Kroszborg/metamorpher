import { proxy } from 'comlink';
import { WorkerHost } from '../worker-host';
import type { TypesetWorkerApi } from './typeset.worker';
import type { ProgressFn, ReflowRequest, SlidesRequest, SlidesResult, TextBoxesResult, TextBoxRequest, TypesetRequest, TypesetResult } from './types';

export * from './page';
export * from './types';
export { documentCss, type ThemeOptions } from './theme';

const host = new WorkerHost<TypesetWorkerApi>(
  () => new Worker(new URL('./typeset.worker.ts', import.meta.url), { type: 'module' }),
);

/** MuPDF (wasm + glue), the same files the PDF engine uses; cached once for both. */
export const TYPESET_DOWNLOAD_BYTES = 10_550_000;

type CallOptions = { signal?: AbortSignal; onProgress?: ProgressFn };

function withProgress<R>(fn: ProgressFn | undefined, call: (p: ProgressFn | undefined) => Promise<R>): Promise<R> {
  if (!fn) return call(undefined);
  let live = true;
  const p = proxy<ProgressFn>((done, total, note) => {
    if (live) fn(done, total, note);
  });
  return call(p).finally(() => {
    live = false;
  });
}

/**
 * Document layout engine: HTML blocks and tables in, a PDF with selectable,
 * searchable text out (MuPDF's HTML layout in a worker, Noto fonts fetched
 * from /vendor/fonts when the text needs them, subsetted on embedding).
 * `onProgress(fraction, 1, note)` reports 0–1.
 */
export const typesetEngine = {
  render(req: TypesetRequest, { signal, onProgress }: CallOptions = {}): Promise<TypesetResult> {
    return withProgress(onProgress, (p) => host.call((api) => api.render(req, p), signal));
  },

  /** EPUB, FB2, MOBI and XHTML books, laid out by MuPDF itself. */
  reflow(file: Blob, req: ReflowRequest, { signal, onProgress }: CallOptions = {}): Promise<TypesetResult & { title?: string }> {
    return withProgress(onProgress, (p) => host.call((api) => api.reflow(file, req, p), signal));
  },

  /** Presentations (the model from the PowerPoint reader) → one PDF page per slide. */
  slides(req: SlidesRequest, { signal, onProgress }: CallOptions = {}): Promise<SlidesResult> {
    return withProgress(onProgress, (p) => host.call((api) => api.slides(req, p), signal));
  },

  /** Text boxes laid out one per page (shaped, any script the fonts cover), for drawing into another PDF. */
  textBoxes(boxes: TextBoxRequest[], css: string, { signal }: CallOptions = {}): Promise<TextBoxesResult> {
    return host.call((api) => api.textBoxes(boxes, css), signal);
  },

  terminate(): void {
    host.terminate();
  },
};
