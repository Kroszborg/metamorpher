// Page rendering with MuPDF's draw device.
import type * as M from 'mupdf';
import type { RawPage, RenderedPage } from '../types';
import type { Doc, Mupdf } from './common';

// Keep pixmaps within what the wasm heap and canvases handle comfortably.
const MAX_SIDE = 12_000;
const MAX_AREA = 100_000_000;

export function scaleFor(page: M.Page, dpi: number): number {
  const [x0, y0, x1, y1] = page.getBounds();
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return Math.min(dpi / 72, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
}

export function renderPixmap(m: Mupdf, page: M.Page, dpi: number, gray = false, annotations = true): M.Pixmap {
  const s = scaleFor(page, dpi);
  const cs = gray ? m.ColorSpace.DeviceGray : m.ColorSpace.DeviceRGB;
  return page.toPixmap(m.Matrix.scale(s, s), cs, false, annotations);
}

export function renderPage(
  m: Mupdf,
  doc: Doc,
  index: number,
  dpi: number,
  format: 'png' | 'jpeg' = 'png',
  quality = 85,
): RenderedPage {
  const page = doc.loadPage(index);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const pix = renderPixmap(m, page, dpi);
    try {
      const bytes = format === 'png' ? pix.asPNG() : pix.asJPEG(quality, false);
      return {
        index,
        blob: new Blob([bytes.slice()], { type: format === 'png' ? 'image/png' : 'image/jpeg' }),
        width: pix.getWidth(),
        height: pix.getHeight(),
        pageWidth: x1 - x0,
        pageHeight: y1 - y0,
      };
    } finally {
      pix.destroy();
    }
  } finally {
    page.destroy();
  }
}

/** Raw 8-bit pixels (grey or RGB, no alpha), for encoders the engine does not have (TIFF). */
export function renderRaw(m: Mupdf, doc: Doc, index: number, dpi: number, gray: boolean): RawPage {
  const page = doc.loadPage(index);
  try {
    const pix = renderPixmap(m, page, dpi, gray);
    try {
      const w = pix.getWidth();
      const h = pix.getHeight();
      const n = pix.getNumberOfComponents();
      const stride = pix.getStride();
      const src = pix.getPixels();
      const row = w * n;
      const pixels = new Uint8Array(row * h);
      if (stride === row) pixels.set(src.subarray(0, row * h));
      else for (let y = 0; y < h; y += 1) pixels.set(src.subarray(y * stride, y * stride + row), y * row);
      return { index, width: w, height: h, components: n === 1 ? 1 : 3, pixels };
    } finally {
      pix.destroy();
    }
  } finally {
    page.destroy();
  }
}
