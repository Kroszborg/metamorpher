import type { Engines } from '@/engines';

/** Largest image the on-device vision tools accept, in pixels. */
export const MAX_PIXELS = 40_000_000;

/**
 * Decodes an image file to RGBA pixels with its orientation applied. Formats
 * the browser cannot decode (HEIC, TIFF…) go through the image engine first.
 */
export async function decodeToImageData(file: Blob, engines: Engines, signal: AbortSignal): Promise<ImageData> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  } catch {
    const png = await engines.image.convert(file, { format: 'png' }, signal);
    bitmap = await createImageBitmap(png, { premultiplyAlpha: 'none' });
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new Error(
        `This image is ${bitmap.width} × ${bitmap.height} pixels; the limit here is ${Math.round(MAX_PIXELS / 1e6)} megapixels. Resize it first.`,
      );
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser cannot read image pixels.');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** "#rrggbb" → [r, g, b]. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1] as string, 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
