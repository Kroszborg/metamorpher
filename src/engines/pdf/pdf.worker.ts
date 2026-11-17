// PDF structure operations (merge, build from images) with @cantoo/pdf-lib, off the main thread.
import { PDFDocument } from '@cantoo/pdf-lib';
import { expose } from 'comlink';
import { type ImagePageLayout, pageBoxFor } from './page-sizes';

type Progress = (done: number, total: number) => void;

const pdfBlob = (bytes: Uint8Array) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });

async function loadPdf(blob: Blob, name: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(message)) {
      throw new Error(`${name} is password-protected. Remove the password first.`);
    }
    throw new Error(`${name} could not be read as a PDF (${message}).`);
  }
}

function sniff(bytes: Uint8Array): 'png' | 'jpeg' | 'other' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return 'other';
}

/** The EXIF orientation (1–8) of a JPEG, or 1 when it has none. */
function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1;
    offset += 2 + size;
  }
  return 1;
}

/** Decodes any browser-readable image (applying EXIF rotation) and re-encodes it. */
async function reencode(blob: Blob, type: 'image/png' | 'image/jpeg'): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available in this browser.');
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);
    const out = await canvas.convertToBlob({ type, quality: 0.95 });
    return new Uint8Array(await out.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

const api = {
  /** Concatenates every page of `files`, in order, into one PDF. */
  async merge(files: { name: string; blob: Blob }[], onProgress?: Progress): Promise<Blob> {
    const out = await PDFDocument.create();
    for (const [i, file] of files.entries()) {
      const src = await loadPdf(file.blob, file.name);
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const page of pages) out.addPage(page);
      onProgress?.(i + 1, files.length);
    }
    return pdfBlob(await out.save());
  },

  /**
   * One image per page. PNG is embedded losslessly and JPEG as-is (re-encoded
   * only when EXIF says it is rotated); other formats are converted to PNG.
   */
  async imagesToPdf(
    images: { name: string; blob: Blob }[],
    layout: ImagePageLayout,
    onProgress?: Progress,
  ): Promise<Blob> {
    const doc = await PDFDocument.create();
    for (const [i, image] of images.entries()) {
      let bytes = new Uint8Array(await image.blob.arrayBuffer());
      let kind = sniff(bytes);
      try {
        if (kind === 'jpeg' && jpegOrientation(bytes) > 1) bytes = await reencode(image.blob, 'image/jpeg');
        if (kind === 'other') {
          bytes = await reencode(image.blob, 'image/png');
          kind = 'png';
        }
      } catch {
        throw new Error(`${image.name} could not be decoded as an image.`);
      }
      const embedded = kind === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      const box = pageBoxFor(embedded.width, embedded.height, layout);
      const page = doc.addPage([box.pageWidth, box.pageHeight]);
      page.drawImage(embedded, { x: box.x, y: box.y, width: box.width, height: box.height });
      onProgress?.(i + 1, images.length);
    }
    return pdfBlob(await doc.save());
  },

  async pageCount(file: { name: string; blob: Blob }): Promise<number> {
    return (await loadPdf(file.blob, file.name)).getPageCount();
  },
};

export type PdfWorkerApi = typeof api;

expose(api);
