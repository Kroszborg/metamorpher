/** Turning drawn, typed and photographed signatures into trimmed transparent PNGs. Client only. */

export type Ink = { blob: Blob; width: number; height: number };

/** Longest side of a processed photo, in pixels. */
const MAX_PHOTO_SIDE = 1600;

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be created.'))), 'image/png'),
  );
}

/** Crops a canvas to its non-transparent pixels (plus `pad`) and encodes it as PNG. Null when empty. */
export async function trimCanvas(source: HTMLCanvasElement, pad = 4): Promise<Ink | null> {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx || source.width === 0 || source.height === 0) return null;
  const { width: w, height: h } = source;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')?.drawImage(source, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await canvasBlob(out);
  return { blob, width: out.width, height: out.height };
}

/** Loads an image file (EXIF orientation applied), scaled down to at most MAX_PHOTO_SIDE. */
export async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be read. Try a PNG or JPG.');
  }
  try {
    const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * Makes light pixels transparent: luminance at or above `threshold` (0–255)
 * becomes clear, with a soft ramp just below it so strokes keep smooth edges.
 * Ink keeps its colour. `threshold` 256 keeps the image as it is.
 */
export function removeBackground(source: HTMLCanvasElement, threshold: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0);
  if (threshold > 255) return out;
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const soft = 40;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    const a = lum >= threshold ? 0 : lum <= threshold - soft ? 1 : (threshold - lum) / soft;
    d[i + 3] = Math.round(d[i + 3]! * a);
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Renders `text` in a CSS font (already loaded) to a trimmed transparent PNG. */
export async function renderTyped(text: string, fontFamily: string, color: string): Promise<Ink | null> {
  const size = 120;
  const font = `${size}px ${fontFamily}`;
  try {
    await document.fonts.load(font, text);
  } catch {
    // Draw with whatever font is available.
  }
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  probe.font = font;
  const width = Math.ceil(probe.measureText(text).width + size);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(8000, width);
  canvas.height = Math.ceil(size * 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, canvas.height / 2);
  return trimCanvas(canvas, 6);
}

/** Width of `text` in Helvetica-metric points (Arial and Liberation Sans share its widths). */
export function measureHelvetica(text: string, size: number): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * size * 0.55;
  ctx.font = `${size * 10}px Arial, "Liberation Sans", Helvetica, sans-serif`;
  return ctx.measureText(text).width / 10;
}
