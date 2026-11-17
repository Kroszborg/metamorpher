import { proxy } from 'comlink';
import { WorkerHost } from '../worker-host';
import type { ImagePageLayout } from './page-sizes';
import type { PdfWorkerApi } from './pdf.worker';
import { type RenderOptions, renderPdfPages } from './render';
import { pageOps } from './page-ops';
import { openPdfPreview, type PdfPreview } from './preview';

export { PAGE_SIZES, type ImagePageLayout, type Orientation, type PageSize } from './page-sizes';
export type { RenderFormat, RenderOptions } from './render';
export { PASSWORD_PROTECTED } from './messages';
export * from './page-ops';
export type { PdfPreview, PreviewPageInfo, PreviewRenderOptions } from './preview';

const host = new WorkerHost<PdfWorkerApi>(
  () => new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' }),
);

type NamedBlob = { name: string; blob: Blob };
type CallOptions = { signal?: AbortSignal; onProgress?: (done: number, total: number) => void };

/**
 * PDF engine. Structure work (@cantoo/pdf-lib) runs in a module worker;
 * rendering uses pdf.js with its parsing worker self-hosted from this origin.
 * Every call rejects with an AbortError when `signal` fires.
 */
export const pdfEngine = {
  merge(files: NamedBlob[], { signal, onProgress }: CallOptions = {}): Promise<Blob> {
    return host.call((api) => api.merge(files, onProgress && proxy(onProgress)), signal);
  },

  imagesToPdf(
    images: NamedBlob[],
    layout: ImagePageLayout,
    { signal, onProgress }: CallOptions = {},
  ): Promise<Blob> {
    return host.call(
      (api) => api.imagesToPdf(images, layout, onProgress && proxy(onProgress)),
      signal,
    );
  },

  pageCount(file: NamedBlob, { signal }: CallOptions = {}): Promise<number> {
    return host.call((api) => api.pageCount(file), signal);
  },

  /** Renders every page to PNG/JPEG, one at a time. Resolves with the page count. */
  renderPages(file: Blob, options: RenderOptions): Promise<number> {
    return renderPdfPages(file, options);
  },

  /** Opens a PDF for on-demand page images and text (thumbnails, previews). Call `close()` when done. */
  open(file: Blob, options: { signal?: AbortSignal; name?: string } = {}): Promise<PdfPreview> {
    return openPdfPreview(file, options);
  },

  /** Page management: rewrite, assemble (split/extract/mix), split by size, N-up. See page-ops.ts. */
  pages: pageOps,

  terminate(): void {
    host.terminate();
  },
};

export type PdfEngine = typeof pdfEngine;
