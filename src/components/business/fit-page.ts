/**
 * For documents laid out on one very tall page (receipts): find where the
 * content ends and cut the page there, keeping the text real. Client only.
 */
import { openPdfDocument } from '@/components/pdf-stage';

/** Points from the top of page 1 to the lowest non-white pixel (scanned at `dpi`). */
export async function contentBottom(pdf: Blob, dpi = 36): Promise<{ bottom: number; pages: number; pageHeight: number }> {
  const { doc, destroy } = await openPdfDocument(pdf);
  const canvas = document.createElement('canvas');
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available.');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let last = 0;
    for (let y = height - 1; y >= 0 && last === 0; y--) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = row + x * 4;
        if ((data[i] as number) < 245 || (data[i + 1] as number) < 245 || (data[i + 2] as number) < 245) {
          last = y + 1;
          break;
        }
      }
    }
    return { bottom: (last * 72) / dpi, pages: doc.numPages, pageHeight: viewport.height * (72 / dpi) };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await destroy();
  }
}

/** Keeps the top `height` points of page 1 (MediaBox and CropBox), dropping other pages. */
export async function cropTop(pdf: Blob, height: number): Promise<Blob> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(await pdf.arrayBuffer());
  while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  const page = doc.getPage(0);
  const box = page.getMediaBox();
  const h = Math.min(box.height, Math.max(36, height));
  page.setMediaBox(box.x, box.y + box.height - h, box.width, h);
  page.setCropBox(box.x, box.y + box.height - h, box.width, h);
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

/** Renders page 1 to a PNG `pixelWidth` wide (the paper width at the printer's resolution). */
export async function pageToPng(pdf: Blob, pixelWidth: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { doc, destroy } = await openPdfDocument(pdf);
  const canvas = document.createElement('canvas');
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pixelWidth / base.width });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The receipt could not be rendered.'))), 'image/png'),
    );
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await destroy();
  }
}
