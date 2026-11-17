import { proxy } from 'comlink';
import { WorkerHost } from '../worker-host';
import type { ExtractWorkerApi } from './extract.worker';
import type { ExtractProgress, RawPage, WordPage } from './types';

export * from './types';
export { type CellValue, detectTable, type PageTable, parseNumber } from './tables';
export { buildDocument, type DocBlock, type DocImage, type DocModel, type DocTable, type Para, type Run, type RunStyle } from './model';
export { findTables, type FoundTable, mergeWrappedRows, readingOrder, type TableCell } from './layout';

const host = new WorkerHost<ExtractWorkerApi>(
  () => new Worker(new URL('./extract.worker.ts', import.meta.url), { type: 'module' }),
);

type CallOptions = { signal?: AbortSignal; password?: string; onProgress?: ExtractProgress };

function withProgress<R>(fn: ExtractProgress | undefined, call: (p: ExtractProgress | undefined) => Promise<R>): Promise<R> {
  if (!fn) return call(undefined);
  let live = true;
  const p = proxy<ExtractProgress>((d, t, n) => {
    if (live) fn(d, t, n);
  });
  return call(p).finally(() => {
    live = false;
  });
}

/**
 * Structure of PDF pages (MuPDF in a worker): styled lines, images and links
 * for reflowing into Word, HTML and EPUB; positioned words for tables.
 * Password errors are the MuPDF engine's (see isPasswordError).
 */
export const pdfExtract = {
  structure(
    file: Blob,
    { images = true, signal, password, onProgress }: CallOptions & { images?: boolean } = {},
  ): Promise<{ pages: RawPage[]; title?: string; author?: string }> {
    return withProgress(onProgress, (p) => host.call((api) => api.structure(file, { password, images }, p), signal));
  },
  words(file: Blob, { signal, password, onProgress }: CallOptions = {}): Promise<WordPage[]> {
    return withProgress(onProgress, (p) => host.call((api) => api.words(file, { password }, p), signal));
  },
  fixedHtml(file: Blob, { signal, password, onProgress }: CallOptions = {}): Promise<{ pages: string[]; title?: string }> {
    return withProgress(onProgress, (p) => host.call((api) => api.fixedHtml(file, { password }, p), signal));
  },
};
