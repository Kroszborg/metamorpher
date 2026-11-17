// Decodes photos, finds the page, flattens and cleans it. OffscreenCanvas for
// decoding (EXIF orientation applied) and encoding; the maths is in process.ts.
import { expose } from 'comlink';
import { applyFilter, detectPage, type Filter, flatSize, type Quad, type Rgba, rotate, warp } from './process';

/** Detection works on a small copy; the long side in pixels. */
const DETECT_SIDE = 480;
/** Long side of a finished page in pixels (about 300 dpi on A4). */
const OUTPUT_SIDE = 3300;

async function decode(file: Blob, maxSide?: number): Promise<{ img: Rgba; fullWidth: number; fullHeight: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be read. Use a JPEG, PNG, WebP or AVIF photo.');
  }
  try {
    const k = maxSide ? Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)) : 1;
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not prepare the image.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { img: { data: data.data, width: w, height: h }, fullWidth: bitmap.width, fullHeight: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function encode(img: Rgba, type: 'image/jpeg' | 'image/png', quality = 0.85): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not encode the page.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas.convertToBlob(type === 'image/png' ? { type } : { type, quality });
}

const api = {
  /** Finds the page corners (in full-size image pixels) and gives a preview image. */
  async detect(file: Blob): Promise<{ quad: Quad; found: boolean; width: number; height: number; preview: Blob }> {
    const { img, fullWidth, fullHeight } = await decode(file, DETECT_SIDE);
    const { quad, found } = detectPage(img);
    const k = fullWidth / img.width;
    const full = quad.map(([x, y]) => [Math.round(x * k), Math.round(y * k)]) as Quad;
    const { img: shown } = await decode(file, 1400);
    return { quad: full, found, width: fullWidth, height: fullHeight, preview: await encode(shown, 'image/jpeg', 0.8) };
  },

  /** The flattened, cleaned page as JPEG (PNG for black and white). */
  async process(file: Blob, quad: Quad, filter: Filter, quarter: 0 | 1 | 2 | 3, maxSide = OUTPUT_SIDE): Promise<{ blob: Blob; width: number; height: number }> {
    const { img } = await decode(file);
    const { width, height } = flatSize(quad, maxSide);
    let page = warp(img, quad, width, height);
    applyFilter(page, filter);
    page = rotate(page, quarter);
    const blob = await encode(page, filter === 'bw' ? 'image/png' : 'image/jpeg', filter === 'original' ? 0.88 : 0.85);
    return { blob, width: page.width, height: page.height };
  },

  /** Raw pixels of a processed page, for tests and previews that need them. */
  async preview(file: Blob, quad: Quad, filter: Filter, quarter: 0 | 1 | 2 | 3): Promise<Blob> {
    const { blob } = await api.process(file, quad, filter, quarter, 900);
    return blob;
  },
};

export type ScanWorkerApi = typeof api;

expose(api);
