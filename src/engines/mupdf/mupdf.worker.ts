// MuPDF (WebAssembly) in a module worker. MuPDF.js locates its wasm with
// `new URL('mupdf-wasm.wasm', import.meta.url)` and uses top-level await, so it
// is served unbundled from public/vendor/mupdf (scripts/copy-runtime-assets.mjs)
// and imported from this origin at runtime; only its types are bundled.
import { expose, transfer } from 'comlink';
import type * as M from 'mupdf';
import { analyzeSize } from './ops/analyze';
import { type Doc, type Mupdf, openPdf } from './ops/common';
import { compressPdf } from './ops/compress';
import { extractImages } from './ops/images';
import { checkRedactions, redactPdf } from './ops/redact';
import { renderPage, renderRaw } from './ops/render';
import { rasterizePdf, repairPdf } from './ops/repair';
import { decrypt, docInfo, inspect, isEncrypted } from './ops/security';
import { extractText, pageText, searchText } from './ops/text';
import { pdfToTiff } from './ops/tiff';
import type {
  CompressOptions,
  CompressStats,
  ExtractedImage,
  ExtractImagesOptions,
  PageText,
  PdfInfo,
  ProgressFn,
  RawPage,
  RedactionCheckerReport,
  RedactionRegion,
  RedactOptions,
  RedactResult,
  RenderedPage,
  RepairReport,
  SearchHit,
  SizeReport,
  TextMode,
  Matrix,
  TiffOptions,
} from './types';

let lib: Promise<Mupdf> | null = null;
function load(): Promise<Mupdf> {
  lib ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/mupdf/mupdf.js', self.location.origin).href
  ) as Promise<typeof M>;
  return lib;
}

const bytesOf = async (file: Blob) => new Uint8Array(await file.arrayBuffer());
const pdfBlob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes], { type: 'application/pdf' });

// Open documents kept for interactive tools (previews, search). Lost when the worker restarts.
const sessions = new Map<number, Doc>();
let nextSession = 1;

function session(id: number): Doc {
  const doc = sessions.get(id);
  if (!doc) {
    const err = new Error('The document is no longer open.');
    err.name = 'SessionClosedError';
    throw err;
  }
  return doc;
}

const api = {
  async inspect(file: Blob, password?: string): Promise<PdfInfo> {
    return inspect(await load(), await bytesOf(file), password);
  },

  async isEncrypted(file: Blob): Promise<boolean> {
    return isEncrypted(await load(), await bytesOf(file));
  },

  async decrypt(file: Blob, password: string): Promise<Blob> {
    return pdfBlob(decrypt(await load(), await bytesOf(file), password));
  },

  async compress(
    file: Blob,
    options: CompressOptions,
    password?: string,
    progress?: ProgressFn,
  ): Promise<{ blob: Blob | null; stats: CompressStats }> {
    const { bytes, stats } = compressPdf(await load(), await bytesOf(file), options, password, progress);
    return { blob: bytes ? pdfBlob(bytes) : null, stats };
  },

  async analyzeSize(file: Blob, password?: string, progress?: ProgressFn): Promise<SizeReport> {
    return analyzeSize(await load(), await bytesOf(file), password, progress);
  },

  async repair(file: Blob, password?: string, progress?: ProgressFn): Promise<{ blob: Blob; report: RepairReport }> {
    const { bytes, report } = repairPdf(await load(), await bytesOf(file), password, progress);
    return { blob: pdfBlob(bytes), report };
  },

  async rasterize(
    file: Blob,
    opts: { dpi: number; quality: number },
    password?: string,
    progress?: ProgressFn,
  ): Promise<{ blob: Blob; report: RepairReport }> {
    const { bytes, report } = rasterizePdf(await load(), await bytesOf(file), opts, password, progress);
    return { blob: pdfBlob(bytes), report };
  },

  async toTiff(file: Blob, opts: TiffOptions, password?: string, progress?: ProgressFn): Promise<Blob> {
    const m = await load();
    const doc = openPdf(m, await bytesOf(file), password);
    try {
      return pdfToTiff(m, doc, opts, progress);
    } finally {
      doc.destroy();
    }
  },

  async extractText(file: Blob, mode: TextMode, password?: string, progress?: ProgressFn): Promise<string[]> {
    const doc = openPdf(await load(), await bytesOf(file), password);
    try {
      return extractText(doc, mode, progress);
    } finally {
      doc.destroy();
    }
  },

  async extractImages(
    file: Blob,
    options: ExtractImagesOptions,
    password?: string,
    progress?: ProgressFn,
  ): Promise<{ images: ExtractedImage[]; skipped: number }> {
    const m = await load();
    const doc = openPdf(m, await bytesOf(file), password);
    try {
      const images: ExtractedImage[] = [];
      const { skipped } = extractImages(m, doc, options, (img) => images.push(img), progress);
      return { images, skipped };
    } finally {
      doc.destroy();
    }
  },

  async redact(
    file: Blob,
    regions: RedactionRegion[],
    options: RedactOptions,
    password?: string,
    progress?: ProgressFn,
  ): Promise<RedactResult> {
    const { bytes, check } = redactPdf(await load(), await bytesOf(file), regions, options, password, progress);
    return { blob: pdfBlob(bytes), check };
  },

  async checkRedactions(file: Blob, password?: string, progress?: ProgressFn): Promise<RedactionCheckerReport> {
    return checkRedactions(await load(), await bytesOf(file), password, progress);
  },

  // ── Sessions ──
  async open(file: Blob, password?: string): Promise<{ id: number; info: PdfInfo }> {
    const doc = openPdf(await load(), await bytesOf(file), password);
    const id = nextSession;
    nextSession += 1;
    sessions.set(id, doc);
    return { id, info: docInfo(doc, false) };
  },

  close(id: number): void {
    sessions.get(id)?.destroy();
    sessions.delete(id);
  },

  async renderPage(id: number, index: number, dpi: number, format: 'png' | 'jpeg'): Promise<RenderedPage> {
    return renderPage(await load(), session(id), index, dpi, format);
  },

  async renderRaw(id: number, index: number, dpi: number, gray: boolean): Promise<RawPage> {
    const raw = renderRaw(await load(), session(id), index, dpi, gray);
    return transfer(raw, [raw.pixels.buffer]);
  },

  async pageText(id: number, index: number): Promise<PageText> {
    const doc = session(id);
    const page = doc.loadPage(index);
    try {
      return pageText(page, index);
    } finally {
      page.destroy();
    }
  },

  /** PDF user space → MuPDF page space (top-left origin, /Rotate and the crop box applied) for one page. */
  pageTransform(id: number, index: number): Matrix {
    const page = session(id).loadPage(index);
    try {
      const [a, b, c, d, e, f] = page.getTransform();
      return [a, b, c, d, e, f];
    } finally {
      page.destroy();
    }
  },

  async search(id: number, needle: string, pages?: number[]): Promise<SearchHit[]> {
    return searchText(await load(), session(id), needle, pages);
  },
};

export type MupdfWorkerApi = typeof api;

expose(api);
