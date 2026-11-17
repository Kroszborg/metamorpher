/**
 * pdf.js for on-screen previews. Shares pdf.js's global worker port with the
 * pdf engine when that is already set up; otherwise starts its own
 * self-hosted parsing worker. Client only.
 */
import '@/lib/polyfills';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ENCRYPTED_MESSAGE } from '@/engines/pdf-stamp/messages';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdfjs.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return pdfjs;
  });
  pdfjsPromise.catch(() => {
    pdfjsPromise = null;
  });
  return pdfjsPromise;
}

const assetUrl = (path: string) => new URL(`/vendor/pdfjs/${path}`, window.location.origin).href;

export type OpenedPdf = { doc: PDFDocumentProxy; destroy: () => Promise<void> };

/** Opens a PDF for rendering. Rejects with a readable message for encrypted or broken files. */
export async function openPdfDocument(file: Blob): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    standardFontDataUrl: assetUrl('standard_fonts/'),
    cMapUrl: assetUrl('cmaps/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    disableWorkerRendering: true,
  });
  try {
    const doc = await task.promise;
    return { doc, destroy: () => task.destroy() };
  } catch (err) {
    void task.destroy();
    if (err instanceof Error && err.name === 'PasswordException') throw new Error(ENCRYPTED_MESSAGE);
    throw new Error(`This file could not be opened as a PDF${err instanceof Error && err.message ? ` (${err.message})` : ''}.`);
  }
}

/** Renders one page (0-based) to a PNG at `dpi`, oriented as the reader sees it. */
export async function renderPageToPng(file: Blob, index: number, dpi: number): Promise<Blob> {
  const { doc, destroy } = await openPdfDocument(file);
  const canvas = document.createElement('canvas');
  try {
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The page could not be rendered.'))), 'image/png'),
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await destroy();
  }
}
