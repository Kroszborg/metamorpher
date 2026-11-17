// Personal data and privacy checks with MuPDF: every character with its quad,
// detectors run per page, matches turned into boxes per line; the privacy
// report and the clean-up for the privacy scanner.
import { expose } from 'comlink';
import type * as M from 'mupdf';
import { type Doc, type Mupdf, bufferToBytes, openPdf, pageResources, quadBox, walkXObjects, writeOptions } from '../mupdf/ops/common';
import { checkRedactions, redactPdf } from '../mupdf/ops/redact';
import { STEXT_OPTIONS } from '../mupdf/ops/text';
import { type DetectOptions, PII_CATEGORIES, type PiiCategory } from './detectors';
import { locatePii, type PiiHit, type PositionedChar } from './locate';
import { cleanDocument, privacyReport, splitPageText } from './privacy';
import type { CleanOptions, PiiPage, PiiScanOptions, PrivacyReport } from './types';

let lib: Promise<Mupdf> | null = null;
function load(): Promise<Mupdf> {
  lib ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/mupdf/mupdf.js', self.location.origin).href
  ) as Promise<typeof M>;
  return lib;
}

const pdfBlob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes], { type: 'application/pdf' });

function pageChars(page: M.Page): PositionedChar[] {
  const chars: PositionedChar[] = [];
  let line = 0;
  const stext = page.toStructuredText(STEXT_OPTIONS);
  try {
    stext.walk({
      onChar(c, _origin, _font, _size, quad) {
        chars.push({ c, box: quadBox(quad), line });
      },
      endLine() {
        chars.push({ c: '\n', box: null, line });
        line += 1;
      },
    });
  } finally {
    stext.destroy();
  }
  return chars;
}

function imageCount(page: M.PDFPage): number {
  let n = 0;
  walkXObjects(pageResources(page), (_num, _ref, subtype) => {
    if (subtype === 'Image') n += 1;
  });
  return n;
}

function detectOptions(o: PiiScanOptions): DetectOptions {
  return { categories: new Set(o.categories), words: o.words, patterns: o.patterns };
}

let open: { doc: Doc; key: Blob } | null = null;

async function docFor(file: Blob, password?: string): Promise<Doc> {
  if (open?.key === file) return open.doc;
  open?.doc.destroy();
  open = null;
  const doc = openPdf(await load(), new Uint8Array(await file.arrayBuffer()), password);
  open = { doc, key: file };
  return doc;
}

/**
 * The shared fake-redaction checker reads every annotation's interior colour,
 * which MuPDF 1.28 refuses (throws) for types without one (notes, highlights,
 * ink). Those cannot be filled cover-ups, so they are left out of a copy
 * that the checker then reads. Page geometry is unchanged.
 */
function checkCovered(m: Mupdf, bytes: Uint8Array, password?: string): ReturnType<typeof checkRedactions> {
  const doc = openPdf(m, bytes, password);
  let copy: Uint8Array<ArrayBuffer> | null = null;
  try {
    let changed = false;
    for (let i = 0; i < doc.countPages(); i += 1) {
      const page = doc.loadPage(i);
      try {
        // Deleting one annotation can leave the rest of a fetched list stale: fetch again after each.
        for (let guard = 0; guard < 10_000; guard += 1) {
          const victim = page.getAnnotations().find((a) => a.getType() !== 'Redact' && !a.hasInteriorColor());
          if (!victim) break;
          page.deleteAnnotation(victim);
          changed = true;
        }
      } finally {
        page.destroy();
      }
    }
    if (changed) copy = bufferToBytes(doc.saveToBuffer(writeOptions({ encrypt: 'no' })));
  } finally {
    doc.destroy();
  }
  return copy ? checkRedactions(m, copy) : checkRedactions(m, bytes, password);
}

const BUILT_IN = PII_CATEGORIES.map((c) => c.id).filter((c) => c !== 'custom');

const api = {
  /**
   * Scans every page. Each page reports how much text it has and whether it
   * holds pictures, so a scan without a text layer can be pointed to OCR.
   */
  async scan(
    file: Blob,
    options: PiiScanOptions,
    password?: string,
    progress?: (done: number, total: number) => void,
  ): Promise<PiiPage[]> {
    const doc = await docFor(file, password);
    const opts = detectOptions(options);
    const total = doc.countPages();
    const pages: PiiPage[] = [];
    for (let i = 0; i < total; i += 1) {
      const page = doc.loadPage(i);
      try {
        const chars = pageChars(page);
        const textChars = chars.filter((c) => c.box && /\S/.test(c.c)).length;
        const [a, b, c, d, e, f] = page.getTransform();
        pages.push({
          index: i,
          textChars,
          images: imageCount(page),
          transform: [a, b, c, d, e, f],
          hits: locatePii(chars, i, opts),
        });
      } finally {
        page.destroy();
      }
      progress?.(i + 1, total);
    }
    return pages;
  },

  /** Text of every page, as the detectors see it (for reports and tests). */
  async pageTexts(file: Blob, password?: string): Promise<string[]> {
    const doc = await docFor(file, password);
    const out: string[] = [];
    for (let i = 0; i < doc.countPages(); i += 1) {
      const page = doc.loadPage(i);
      try {
        out.push(pageChars(page).map((c) => c.c).join(''));
      } finally {
        page.destroy();
      }
    }
    return out;
  },

  /**
   * A copy of the file whose pages `pages` draw text with one string per Tj
   * (same appearance, same positions), so MuPDF's redaction keeps the text
   * after a removed run in place. Null when nothing needed rewriting.
   * The copy is unencrypted; the redaction output is written unencrypted anyway.
   */
  async prepareRedaction(file: Blob, pages: number[], password?: string): Promise<Blob | null> {
    const doc = openPdf(await load(), new Uint8Array(await file.arrayBuffer()), password);
    try {
      if (!splitPageText(doc, pages)) return null;
      return pdfBlob(bufferToBytes(doc.saveToBuffer(writeOptions({ garbage: 'compact', encrypt: 'no' }))));
    } finally {
      doc.destroy();
    }
  },

  /** Everything the privacy scanner reports. */
  async privacy(file: Blob, password?: string, progress?: (done: number, total: number) => void): Promise<PrivacyReport> {
    const m = await load();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await docFor(file, password);
    const base = privacyReport(m, doc, bytes);
    progress?.(1, 3);
    const counts = new Map<PiiCategory, { count: number; examples: string[] }>();
    const opts = detectOptions({ categories: BUILT_IN, words: [], patterns: [] });
    for (let i = 0; i < doc.countPages(); i += 1) {
      const page = doc.loadPage(i);
      try {
        for (const h of locatePii(pageChars(page), i, opts)) {
          const c = counts.get(h.category) ?? { count: 0, examples: [] };
          c.count += 1;
          if (c.examples.length < 3 && !c.examples.includes(h.text)) c.examples.push(h.text);
          counts.set(h.category, c);
        }
      } finally {
        page.destroy();
      }
    }
    progress?.(2, 3);
    let covered: PrivacyReport['covered'] = [];
    let coverChecked = false;
    try {
      covered = checkCovered(m, bytes, password).findings.map((f) => ({ page: f.page, box: f.box, text: f.text, kind: f.kind }));
      coverChecked = true;
    } catch {
      coverChecked = false;
    }
    progress?.(3, 3);
    return { ...base, pii: [...counts].map(([category, v]) => ({ category, ...v })), covered, coverChecked };
  },

  /** A cleaned copy: the chosen items removed, written as a full rewrite (no old revisions). */
  async clean(
    file: Blob,
    opts: CleanOptions,
    password?: string,
  ): Promise<{ blob: Blob; removed: string[]; redactionPassed: boolean | null }> {
    const m = await load();
    const source = new Uint8Array(await file.arrayBuffer());
    let regions: { page: number; box: [number, number, number, number] }[] = [];
    if (opts.covered) regions = checkCovered(m, source, password).findings.map((f) => ({ page: f.page, box: f.box }));
    const doc = openPdf(m, source, password);
    let bytes: Uint8Array<ArrayBuffer>;
    let removed: string[];
    try {
      if (regions.length) splitPageText(doc, regions.map((r) => r.page));
      removed = cleanDocument(m, doc, opts);
      bytes = bufferToBytes(doc.saveToBuffer(writeOptions({ garbage: 'deduplicate', encrypt: 'no' })));
    } finally {
      doc.destroy();
    }
    let redactionPassed: boolean | null = null;
    if (regions.length) {
      const r = redactPdf(m, bytes, regions, { fillBlack: true, stripHidden: false });
      bytes = r.bytes;
      redactionPassed = r.check.passed;
      removed.push(`Text hidden under ${regions.length} dark ${regions.length === 1 ? 'box' : 'boxes'} (now truly redacted)`);
    }
    removed.push('Earlier saved revisions (the file was rewritten from scratch)');
    return { blob: pdfBlob(bytes), removed, redactionPassed };
  },

  close(): void {
    open?.doc.destroy();
    open = null;
  },
};

export type PiiWorkerApi = typeof api;
export type { PiiHit };

expose(api);
