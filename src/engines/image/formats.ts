/** Names, extensions and "keep the format" rules shared by the image tools. */
import type { SourceFormat } from './probe';
import type { CanvasFormat } from './types';

export const FORMAT_EXT: Record<CanvasFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  bmp: 'bmp',
  ico: 'ico',
};

export const FORMAT_LABEL: Record<CanvasFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  gif: 'GIF',
  bmp: 'BMP',
  ico: 'ICO',
};

/** Formats that store transparency. */
export const FORMAT_ALPHA: Record<CanvasFormat, boolean> = {
  jpeg: false,
  bmp: false,
  png: true,
  webp: true,
  avif: true,
  gif: true,
  ico: true,
};

/** Formats that store animation (GIF, animated WebP, APNG). */
export const FORMAT_ANIMATES: Record<CanvasFormat, boolean> = {
  jpeg: false,
  png: true,
  webp: true,
  avif: false,
  gif: true,
  bmp: false,
  ico: false,
};

export const LOSSY_FORMATS: readonly CanvasFormat[] = ['jpeg', 'webp', 'avif'];

/** Image inputs the engine reads, for `<input accept>` (HEIC included). */
export const IMAGE_ACCEPT = [
  'image/*',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.ico',
  '.avif',
  '.heic',
  '.heif',
] as const;

/**
 * The output format that "keeps" a source format. Formats the engine cannot
 * write map to the closest one: HEIC to JPG, TIFF to PNG.
 */
export function keepFormat(source: SourceFormat): CanvasFormat {
  switch (source) {
    case 'jpeg':
    case 'heic':
      return 'jpeg';
    case 'webp':
      return 'webp';
    case 'avif':
      return 'avif';
    case 'bmp':
      return 'bmp';
    case 'gif':
      return 'gif';
    default:
      return 'png';
  }
}

/** Source format from a file name, for labels before the header is read. */
export function formatFromName(name: string): SourceFormat {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, SourceFormat> = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    jfif: 'jpeg',
    png: 'png',
    gif: 'gif',
    webp: 'webp',
    bmp: 'bmp',
    avif: 'avif',
    heic: 'heic',
    heif: 'heic',
    ico: 'ico',
    tif: 'tiff',
    tiff: 'tiff',
    svg: 'svg',
  };
  return map[ext] ?? 'unknown';
}

/** Whether the page can show this format in an <img> directly. */
export function browserCanShow(format: SourceFormat): boolean {
  return ['jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg'].includes(format);
}
