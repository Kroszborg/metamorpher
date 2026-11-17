// PDF stamping, signing, forms and metadata with @cantoo/pdf-lib, off the main thread.
import { PDFDocument } from '@cantoo/pdf-lib';
import { expose } from 'comlink';
import { pruneUnreachable } from './cleanup';
import { frameOf, openPdf, savePdf } from './document';
import { flatten } from './ops/flatten';
import { fillForm, readForm } from './ops/forms';
import { invertColors } from './ops/invert';
import { readMetadata, writeMetadata } from './ops/metadata';
import { placeOverlays } from './ops/overlays';
import { stampText } from './ops/text-stamp';
import { watermark } from './ops/watermark';
import type {
  FieldValue,
  FlattenSpec,
  FormInfo,
  InvertSpec,
  MetadataInfo,
  MetadataSpec,
  OverlayItem,
  PageSize,
  TextStampSpec,
  WatermarkSpec,
} from './types';

/** Boosts an inverted greyscale rendering: white text on black, soft edges kept. */
async function contrastImage(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not available in this browser.');
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255;
      // Invert, then a steep S-curve around mid grey.
      const t = Math.min(1, Math.max(0, (1 - lum - 0.25) / 0.5));
      const v = Math.round(t * t * (3 - 2 * t) * 255);
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

/** One page of a stamped document, as a standalone PDF for the live preview. */
async function singlePage(doc: PDFDocument, index: number): Promise<Blob> {
  await doc.flush();
  const out = await PDFDocument.create({ updateMetadata: false });
  const [page] = await out.copyPages(doc, [index]);
  if (page) out.addPage(page);
  return savePdf(out);
}

export type PreviewRequest =
  | { kind: 'text'; spec: TextStampSpec }
  | { kind: 'watermark'; spec: WatermarkSpec }
  | { kind: 'invert'; spec: InvertSpec };

const api = {
  async pageSizes(file: Blob): Promise<PageSize[]> {
    const doc = await openPdf(file);
    return doc.getPages().map((p) => {
      const f = frameOf(p);
      return { width: f.width, height: f.height, rotation: f.rotation };
    });
  },

  async stampText(file: Blob, spec: TextStampSpec): Promise<{ blob: Blob; pages: number; pageCount: number }> {
    const doc = await openPdf(file);
    const pages = await stampText(doc, spec);
    return { blob: await savePdf(doc), pages, pageCount: doc.getPageCount() };
  },

  async watermark(file: Blob, spec: WatermarkSpec): Promise<Blob> {
    const doc = await openPdf(file);
    await watermark(doc, spec);
    return savePdf(doc);
  },

  async invert(file: Blob, spec: InvertSpec): Promise<Blob> {
    const doc = await openPdf(file);
    let images = spec.images;
    if (spec.mode === 'contrast' && images) {
      images = await Promise.all(images.map((b) => (b ? contrastImage(b) : null)));
    }
    await invertColors(doc, { ...spec, images });
    return savePdf(doc);
  },

  async flatten(file: Blob, spec: FlattenSpec): Promise<{ blob: Blob; annotations: number; fields: number }> {
    const doc = await openPdf(file);
    await doc.flush();
    const result = await flatten(doc, spec);
    return { blob: await savePdf(doc), ...result };
  },

  async readMetadata(file: Blob): Promise<MetadataInfo> {
    return readMetadata(await openPdf(file));
  },

  async writeMetadata(file: Blob, spec: MetadataSpec): Promise<Blob> {
    const doc = await openPdf(file);
    writeMetadata(doc, spec);
    return savePdf(doc);
  },

  async placeOverlays(file: Blob, items: OverlayItem[]): Promise<Blob> {
    const doc = await openPdf(file);
    await placeOverlays(doc, items);
    return savePdf(doc);
  },

  async readForm(file: Blob): Promise<FormInfo> {
    return readForm(await openPdf(file));
  },

  async fillForm(
    file: Blob,
    values: Record<string, FieldValue>,
    options: { flatten: boolean },
  ): Promise<{ blob: Blob; unencodable: string[] }> {
    const doc = await openPdf(file);
    const unencodable = await fillForm(doc, values);
    if (options.flatten) {
      if (unencodable.length) {
        throw new Error(
          `Some values use characters the built-in form font cannot draw (${unencodable.join(', ')}). Save without flattening instead.`,
        );
      }
      await doc.flush();
      await flatten(doc, { forms: true, annotations: false, keepLinks: true, removeJavaScript: false });
    } else {
      await doc.flush();
      pruneUnreachable(doc);
    }
    return { blob: await savePdf(doc), unencodable };
  },

  /** Applies an operation to one page and returns that page alone. */
  async preview(file: Blob, request: PreviewRequest, page: number): Promise<Blob> {
    const doc = await openPdf(file);
    const index = Math.min(Math.max(0, page), doc.getPageCount() - 1);
    if (request.kind === 'text') await stampText(doc, request.spec, index);
    else if (request.kind === 'watermark') await watermark(doc, request.spec, index);
    else {
      let images = request.spec.images;
      if (request.spec.mode === 'contrast' && images) {
        images = await Promise.all(images.map((b, i) => (b && i === index ? contrastImage(b) : null)));
      }
      await invertColors(doc, { ...request.spec, images }, index);
    }
    return singlePage(doc, index);
  },
};

export type StampWorkerApi = typeof api;

expose(api);
