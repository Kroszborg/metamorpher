/** Small HTML helpers for documents laid out by the typeset engine (MuPDF's HTML/CSS subset). */

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

/**
 * MuPDF shapes "fi", "fl", "ff" into ligature glyphs with the built-in
 * fonts, and text extracted from the PDF then reads "ﬁrst" (U+FB01), which
 * applicant tracking systems and search can miss. Ending the text run after
 * each such "f" keeps plain letters; spacing is unchanged.
 */
export function breakLigatures(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith('<') ? part : part.replace(/f(?=[fil])/g, '<span>f</span>')))
    .join('');
}

/** Escaped text with line breaks kept. */
export function lines(text: string): string {
  return esc(text.trim()).replace(/\r?\n/g, '<br>');
}

/** A number of points as CSS, rounded to 0.01. */
export function pt(n: number): string {
  return `${Math.max(0, Math.round(n * 100) / 100)}pt`;
}

/**
 * MuPDF sizes table cells by their content box (padding and borders are
 * added), like CSS without box-sizing. Gives the content width of a cell that
 * should take `outer` points with `padX` padding on each side.
 */
export function cellWidth(outer: number, padX: number, border = 0): string {
  return pt(outer - 2 * padX - border);
}

/** Image size that fits in a box, keeping its aspect ratio. */
export function fitBox(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: maxW, h: maxH };
  const k = Math.min(maxW / w, maxH / h);
  return { w: w * k, h: h * k };
}

export type SizedImage = { src: string; width: number; height: number };

/** Loads a data URL and reports its pixel size (main thread). */
export function sizeImage(src: string): Promise<SizedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('This image could not be read.'));
    img.src = src;
  });
}

/** Reads an image file into a PNG/JPEG data URL, scaled down to `maxSide` pixels. */
export async function imageFileToDataUrl(file: Blob, maxSide = 800): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be read. Try a PNG or JPG.');
  }
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparency (logos); photos are smaller as JPEG.
    const png = canvas.toDataURL('image/png');
    if (file.type === 'image/jpeg' && png.length > 200_000) return canvas.toDataURL('image/jpeg', 0.9);
    return png;
  } finally {
    bitmap.close();
  }
}

/** Turns document CSS for MuPDF into CSS a browser preview renders the same way. */
export function previewCss(css: string): string {
  return css
    .replace(/font-family:\s*sans-serif/g, 'font-family:Arial,"Liberation Sans",Helvetica,sans-serif')
    .replace(/font-family:\s*serif/g, 'font-family:"Times New Roman","Liberation Serif",Times,serif')
    .replace(/font-family:\s*monospace/g, 'font-family:"Courier New","Liberation Mono",Courier,monospace')
    .replace(/font-family:\s*Calibri/gi, 'font-family:Calibri,Carlito,Arial,sans-serif');
}

/** A whole HTML document for an iframe preview of one page width. */
export function previewDocument(body: string, css: string, page: { width: number; margin: number | { x: number; y: number } }): string {
  const m = typeof page.margin === 'number' ? { x: page.margin, y: page.margin } : page.margin;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html{background:#fff}
body{margin:0;width:${pt(page.width - 2 * m.x)};padding:${pt(m.y)} ${pt(m.x)};-webkit-print-color-adjust:exact;print-color-adjust:exact}
table{border-spacing:0}
img{display:inline-block}
${previewCss(css)}
</style></head><body>${body}</body></html>`;
}
