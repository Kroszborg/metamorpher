// Repair with MuPDF: opening rebuilds a broken cross-reference table; every
// page is then loaded and interpreted, and the file is rewritten from scratch.
// Pages that cannot be loaded are dropped and reported.
import type { RepairReport } from '../types';
import { type Doc, type Mupdf, bufferToBytes, nameOf, openPdf, passwordError, writeOptions } from './common';
import { renderPixmap } from './render';

/**
 * Last-resort recovery: renders every page MuPDF can draw to a JPEG and builds
 * a new PDF of those pictures at the original page sizes. Text, links and form
 * fields are lost (the pages become images). Pages that cannot be drawn are
 * reported as failed.
 */
export function rasterizePdf(
  m: Mupdf,
  bytes: Uint8Array,
  opts: { dpi: number; quality: number },
  password?: string,
  progress?: (done: number, total: number) => void,
): { bytes: Uint8Array<ArrayBuffer>; report: RepairReport } {
  const src = openPdf(m, bytes, password);
  const out = new m.PDFDocument();
  try {
    let total = 0;
    try {
      total = src.countPages();
    } catch {
      total = 0;
    }
    const failed: number[] = [];
    for (let i = 0; i < total; i += 1) {
      try {
        const page = src.loadPage(i);
        try {
          const [x0, y0, x1, y1] = page.getBounds();
          const w = x1 - x0;
          const h = y1 - y0;
          const pix = renderPixmap(m, page, opts.dpi);
          try {
            const jpeg = pix.asJPEG(opts.quality, false);
            const image = new m.Image(jpeg);
            try {
              const resources = out.newDictionary();
              const xobjects = out.newDictionary();
              xobjects.put('Im0', out.addImage(image));
              resources.put('XObject', xobjects);
              const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
              const obj = out.addPage([0, 0, w, h], 0, resources, `q ${fmt(w)} 0 0 ${fmt(h)} 0 0 cm /Im0 Do Q`);
              out.insertPage(-1, obj);
            } finally {
              image.destroy();
            }
          } finally {
            pix.destroy();
          }
        } finally {
          page.destroy();
        }
      } catch {
        failed.push(i);
      }
      progress?.(i + 1, total + 1);
    }
    if (failed.length >= total) throw new Error('No page of this file could be drawn.');
    return {
      bytes: bufferToBytes(out.saveToBuffer(writeOptions())),
      report: {
        strategy: 'raster',
        repaired: src.wasRepaired(),
        pagesRecovered: total - failed.length,
        pagesFailed: failed,
        notes: ['The pages were rebuilt as pictures: their text can no longer be selected, searched or copied.'],
        messages: [],
      },
    };
  } finally {
    out.destroy();
    src.destroy();
  }
}

/** Engine messages that say nothing useful about the file. */
const NOISE = /dropping unclosed device|cannot create appearance stream/i;

/**
 * Opens damaged bytes. When MuPDF's own xref reconstruction fails (typically a
 * file cut off in the middle of an object), retries with the bytes up to the
 * last complete object.
 */
function openDamaged(m: Mupdf, bytes: Uint8Array, notes: string[]): Doc {
  const open = (b: Uint8Array) => {
    const d = m.Document.openDocument(b, 'application/pdf');
    const pdf = d.asPDF();
    if (!pdf) {
      d.destroy();
      throw new Error('This file is not a PDF.');
    }
    return pdf;
  };
  try {
    return open(bytes);
  } catch (first) {
    // Search the last 64 MB for the end of the last complete object.
    const from = Math.max(0, bytes.length - 64 * 1024 * 1024);
    const tail = new TextDecoder('latin1').decode(bytes.subarray(from));
    const at = tail.lastIndexOf('endobj');
    if (at > 0) {
      try {
        const doc = open(bytes.subarray(0, from + at + 'endobj'.length));
        notes.push('The file was cut off part-way: everything after the last complete object was dropped.');
        return doc;
      } catch {
        // fall through to the original error
      }
    }
    const detail = first instanceof Error ? first.message : String(first);
    throw new Error(`MuPDF could not read anything usable from this file (${detail}).`);
  }
}

/** Collects every page object and hangs them under a new page tree, in file order. */
function rebuildPageTree(doc: Doc): number {
  const pages: number[] = [];
  const n = doc.countObjects();
  for (let num = 1; num < n; num += 1) {
    try {
      const obj = doc.newIndirect(num);
      if (obj.isDictionary() && nameOf(obj.get('Type')) === 'Page') pages.push(num);
    } catch {
      // unreadable object
    }
  }
  if (pages.length === 0) return 0;
  const tree = doc.addObject(doc.newDictionary());
  const kids = doc.newArray();
  tree.put('Type', doc.newName('Pages'));
  for (const num of pages) {
    const page = doc.newIndirect(num);
    page.put('Parent', tree);
    kids.push(page);
  }
  tree.put('Kids', kids);
  tree.put('Count', pages.length);
  const trailer = doc.getTrailer();
  let root = trailer.get('Root');
  if (!root.isDictionary()) {
    root = doc.addObject(doc.newDictionary());
    root.put('Type', doc.newName('Catalog'));
    trailer.put('Root', root);
  }
  root.put('Pages', tree);
  return pages.length;
}

function countPagesSafely(doc: Doc): number {
  try {
    return doc.countPages();
  } catch {
    return 0;
  }
}

/**
 * Repairs with MuPDF: rebuilds a broken cross-reference table while opening,
 * trims a truncated tail, rebuilds a lost page tree from the page objects that
 * survive, interprets every page and rewrites the file from scratch. Pages
 * that cannot be loaded are dropped and reported.
 */
export function repairPdf(
  m: Mupdf,
  bytes: Uint8Array,
  password?: string,
  progress?: (done: number, total: number) => void,
): { bytes: Uint8Array<ArrayBuffer>; report: RepairReport } {
  const messages: string[] = [];
  const notes: string[] = [];
  m.setLog((message: string) => {
    if (messages.length < 200 && !NOISE.test(message)) messages.push(message);
  });
  try {
    const doc = openDamaged(m, bytes, notes);
    try {
      if (doc.needsPassword()) {
        if (!password) throw passwordError('needed');
        if (doc.authenticatePassword(password) === 0) throw passwordError('wrong');
      }
      if (doc.wasRepaired()) notes.push('The cross-reference table (the index of objects) was damaged and has been rebuilt.');
      let total = countPagesSafely(doc);
      if (total === 0) {
        total = rebuildPageTree(doc);
        if (total > 0) notes.push(`The page list was lost; it was rebuilt from the ${total} pages found in the file.`);
      }
      const failed: number[] = [];
      const blank = new m.Device({});
      for (let i = 0; i < total; i += 1) {
        try {
          const page = doc.loadPage(i);
          try {
            page.run(blank, m.Matrix.identity);
          } finally {
            page.destroy();
          }
        } catch {
          failed.push(i);
        }
        progress?.(i + 1, total + 1);
      }
      blank.close();
      blank.destroy();
      if (total - failed.length <= 0) throw new Error('MuPDF found no readable pages in this file.');

      let out: Uint8Array<ArrayBuffer>;
      let strategy: RepairReport['strategy'] = 'mupdf';
      if (failed.length === 0) {
        out = bufferToBytes(doc.saveToBuffer(writeOptions({ encrypt: 'no' })));
      } else {
        // Copy only the pages that load into a fresh document.
        const fresh = new m.PDFDocument();
        try {
          const graft = fresh.newGraftMap();
          for (let i = 0; i < total; i += 1) {
            if (failed.includes(i)) continue;
            try {
              graft.graftPage(-1, doc, i);
            } catch {
              failed.push(i);
            }
          }
          out = bufferToBytes(fresh.saveToBuffer(writeOptions()));
        } finally {
          fresh.destroy();
        }
        strategy = 'mupdf-pages';
      }
      if (messages.some((msg) => /zlib|flate|decode|unknown font|font resource|cannot load|not a dict/i.test(msg))) {
        notes.push('Some page content, images or fonts were damaged; what could be read was kept.');
      }
      return {
        bytes: out,
        report: {
          strategy,
          repaired: notes.length > 0 || messages.length > 0 || failed.length > 0,
          pagesRecovered: total - failed.length,
          pagesFailed: failed.sort((a, b) => a - b),
          notes,
          messages: [...new Set(messages)].slice(0, 12),
        },
      };
    } finally {
      doc.destroy();
    }
  } finally {
    m.setLog(null);
  }
}
