import type { PdfPreview } from '@/engines/pdf';

/** A page's displayed size in points and the blank margins found on it, as fractions of that size. */
export type Detected = {
  width: number;
  height: number;
  /** null when the page is blank. */
  margins: { left: number; top: number; right: number; bottom: number } | null;
};

/** Pixels darker than this (on any channel) count as content. Scanner noise usually stays above it. */
const INK = 236;
/** Rendering width used for detection; enough to find margins to about 0.4%. */
const WIDTH = 300;

/** The bounding box of non-white pixels, as margins in fractions of the image. */
export function blankMargins(img: ImageData): Detected['margins'] {
  const { width: w, height: h, data } = img;
  const ink = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    return (data[o] ?? 255) < INK || (data[o + 1] ?? 255) < INK || (data[o + 2] ?? 255) < INK;
  };
  // A row or column counts only with at least two inked pixels, to ignore specks.
  const rowHas = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x += 1) if (ink(x, y) && ++n >= 2) return true;
    return false;
  };
  const colHas = (x: number, y0: number, y1: number) => {
    let n = 0;
    for (let y = y0; y <= y1; y += 1) if (ink(x, y) && ++n >= 2) return true;
    return false;
  };
  let top = 0;
  while (top < h && !rowHas(top)) top += 1;
  if (top === h) return null;
  let bottom = h - 1;
  while (bottom > top && !rowHas(bottom)) bottom -= 1;
  let left = 0;
  while (left < w && !colHas(left, top, bottom)) left += 1;
  let right = w - 1;
  while (right > left && !colHas(right, top, bottom)) right -= 1;
  return { left: left / w, top: top / h, right: (w - 1 - right) / w, bottom: (h - 1 - bottom) / h };
}

/** Finds the blank margins of every page, one page at a time. */
export async function detectMargins(
  preview: PdfPreview,
  signal: AbortSignal,
  onPage: (index: number, result: Detected) => void,
): Promise<void> {
  for (let i = 0; i < preview.numPages; i += 1) {
    const [info, img] = await Promise.all([
      preview.pageInfo(i),
      preview.renderPixels(i, { width: WIDTH, signal }),
    ]);
    onPage(i, { width: info.width, height: info.height, margins: blankMargins(img) });
  }
}
