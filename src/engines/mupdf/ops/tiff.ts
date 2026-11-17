// Multi-page TIFF from rendered pages: one Deflate-compressed strip per page
// (with the horizontal predictor for colour and grey), little-endian, baseline
// tags plus resolution and page numbers. Readable by every TIFF reader that
// supports Adobe Deflate (libtiff, Windows, macOS Preview, Photoshop, GIMP).
import { zlibSync } from 'fflate';
import type * as M from 'mupdf';
import type { ProgressFn, TiffOptions } from '../types';
import { type Doc, type Mupdf } from './common';
import { renderPixmap } from './render';

type Field = { tag: number; type: 3 | 4 | 5; values: number[] };

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const TYPE_SIZE = { 3: 2, 4: 4, 5: 8 } as const;

/** Packs a pixmap into tightly packed rows of 1, 3 (grey, RGB) or 1-bit samples. */
function packRows(pix: M.Pixmap, mode: TiffOptions['color']): { data: Uint8Array; rowBytes: number } {
  const w = pix.getWidth();
  const h = pix.getHeight();
  const n = pix.getNumberOfComponents(); // bytes per pixel, alpha included
  const stride = pix.getStride();
  const src = pix.getPixels();
  if (mode === 'bw') {
    // Threshold at mid-grey; 1 bit per pixel, 0 = white (PhotometricInterpretation 0).
    const rowBytes = Math.ceil(w / 8);
    const data = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if ((src[y * stride + x * n] ?? 255) < 128) {
          const at = y * rowBytes + (x >> 3);
          data[at] = (data[at] ?? 0) | (0x80 >> (x & 7));
        }
      }
    }
    return { data, rowBytes };
  }
  const c = mode === 'gray' ? 1 : 3;
  const rowBytes = w * c;
  const data = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * rowBytes;
    const from = y * stride;
    if (n === c) data.set(src.subarray(from, from + rowBytes), row);
    else for (let x = 0; x < w; x += 1) for (let k = 0; k < c; k += 1) data[row + x * c + k] = src[from + x * n + k] ?? 0;
    // Horizontal differencing (TIFF predictor 2), right to left so each sample uses its original neighbour.
    for (let i = rowBytes - 1; i >= c; i -= 1) data[row + i] = ((data[row + i] ?? 0) - (data[row + i - c] ?? 0)) & 0xff;
  }
  return { data, rowBytes };
}

class TiffWriter {
  #chunks: Uint8Array[] = [];
  #offset = 0;
  /** Where the previous IFD's "next IFD" pointer lives, to patch when the next page is added. */
  #nextPointer: { chunk: Uint8Array; at: number } | null = null;

  constructor() {
    const header = new Uint8Array(8);
    const v = new DataView(header.buffer);
    v.setUint16(0, 0x4949); // "II": little-endian
    v.setUint16(2, 42, true);
    this.#push(header);
    this.#nextPointer = { chunk: header, at: 4 };
  }

  #push(chunk: Uint8Array): number {
    const at = this.#offset;
    this.#chunks.push(chunk);
    this.#offset += chunk.length;
    if (this.#offset % 2) {
      this.#chunks.push(new Uint8Array(1)); // keep everything word-aligned
      this.#offset += 1;
    }
    return at;
  }

  addPage(fields: Field[], strip: Uint8Array): void {
    const stripAt = this.#push(strip);
    const all = [...fields, { tag: 273, type: LONG, values: [stripAt] } as Field].sort((a, b) => a.tag - b.tag);
    const ifdSize = 2 + all.length * 12 + 4;
    const ifdAt = this.#offset;
    // Values that do not fit in the 4-byte slot go right after the IFD.
    let extraAt = ifdAt + ifdSize;
    const extras: { at: number; field: Field }[] = [];
    for (const f of all) {
      const size = TYPE_SIZE[f.type] * f.values.length;
      if (size > 4) {
        extras.push({ at: extraAt, field: f });
        extraAt += size + (size % 2);
      }
    }
    const buf = new Uint8Array(extraAt - ifdAt);
    const v = new DataView(buf.buffer);
    v.setUint16(0, all.length, true);
    const write = (pos: number, f: Field) => {
      f.values.forEach((value, i) => {
        if (f.type === SHORT) v.setUint16(pos + i * 2, value, true);
        else if (f.type === LONG) v.setUint32(pos + i * 4, value, true);
        else {
          v.setUint32(pos + i * 8, value, true);
          v.setUint32(pos + i * 8 + 4, 1, true);
        }
      });
    };
    all.forEach((f, i) => {
      const pos = 2 + i * 12;
      v.setUint16(pos, f.tag, true);
      v.setUint16(pos + 2, f.type, true);
      v.setUint32(pos + 4, f.values.length, true);
      const extra = extras.find((e) => e.field === f);
      if (extra) v.setUint32(pos + 8, extra.at, true);
      else write(pos + 8, f);
    });
    for (const e of extras) write(e.at - ifdAt, e.field);
    if (this.#nextPointer) {
      const p = this.#nextPointer;
      new DataView(p.chunk.buffer, p.chunk.byteOffset).setUint32(p.at, ifdAt, true);
    }
    this.#push(buf);
    this.#nextPointer = { chunk: buf, at: 2 + all.length * 12 };
  }

  finish(): Blob {
    return new Blob(this.#chunks as Uint8Array<ArrayBuffer>[], { type: 'image/tiff' });
  }
}

/** Renders `pages` (0-based; all when omitted) into one multi-page TIFF. */
export function pdfToTiff(m: Mupdf, doc: Doc, opts: TiffOptions, progress?: ProgressFn): Blob {
  const count = doc.countPages();
  const pages = (opts.pages ?? Array.from({ length: count }, (_, i) => i)).filter((i) => i >= 0 && i < count);
  if (pages.length === 0) throw new Error('No pages to convert.');
  const tiff = new TiffWriter();
  pages.forEach((index, n) => {
    progress?.(n, pages.length, `Page ${n + 1} of ${pages.length}`);
    const page = doc.loadPage(index);
    try {
      const pix = renderPixmap(m, page, opts.dpi, opts.color !== 'rgb');
      try {
        const w = pix.getWidth();
        const h = pix.getHeight();
        const { data } = packRows(pix, opts.color);
        const strip = zlibSync(data, { level: 6 });
        const samples = opts.color === 'rgb' ? 3 : 1;
        const dpi = Math.round(opts.dpi);
        tiff.addPage(
          [
            { tag: 254, type: LONG, values: [pages.length > 1 ? 2 : 0] },
            { tag: 256, type: LONG, values: [w] },
            { tag: 257, type: LONG, values: [h] },
            { tag: 258, type: SHORT, values: Array<number>(samples).fill(opts.color === 'bw' ? 1 : 8) },
            { tag: 259, type: SHORT, values: [8] }, // Adobe Deflate
            { tag: 262, type: SHORT, values: [opts.color === 'rgb' ? 2 : opts.color === 'gray' ? 1 : 0] },
            { tag: 277, type: SHORT, values: [samples] },
            { tag: 278, type: LONG, values: [h] },
            { tag: 279, type: LONG, values: [strip.length] },
            { tag: 282, type: RATIONAL, values: [dpi] },
            { tag: 283, type: RATIONAL, values: [dpi] },
            { tag: 284, type: SHORT, values: [1] },
            { tag: 296, type: SHORT, values: [2] }, // inches
            { tag: 297, type: SHORT, values: [n, pages.length] },
            ...(opts.color === 'bw' ? [] : [{ tag: 317, type: SHORT, values: [2] } as Field]),
          ],
          strip,
        );
      } finally {
        pix.destroy();
      }
    } finally {
      page.destroy();
    }
  });
  progress?.(pages.length, pages.length);
  return tiff.finish();
}
