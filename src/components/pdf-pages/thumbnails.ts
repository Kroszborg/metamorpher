'use client';

import type { PdfPreview } from '@/engines/pdf';

/** Rendered width of a thumbnail in device pixels (sharp at 2× for ~120 px cells). */
export const THUMB_WIDTH = 240;

export type Thumbnail = {
  url: string;
  /** Displayed page size in points (after the page's own rotation). */
  width: number;
  height: number;
};

const caches = new WeakMap<PdfPreview, Map<number, Thumbnail>>();

function cacheOf(preview: PdfPreview): Map<number, Thumbnail> {
  let cache = caches.get(preview);
  if (!cache) {
    cache = new Map();
    caches.set(preview, cache);
  }
  return cache;
}

export function cachedThumbnail(preview: PdfPreview, index: number): Thumbnail | undefined {
  return caches.get(preview)?.get(index);
}

/** Renders (or returns the cached) thumbnail of page `index`. Rejects with an AbortError on `signal`. */
export async function requestThumbnail(preview: PdfPreview, index: number, signal?: AbortSignal): Promise<Thumbnail> {
  const hit = cachedThumbnail(preview, index);
  if (hit) return hit;
  const [blob, info] = await Promise.all([
    preview.renderPage(index, { width: THUMB_WIDTH, format: 'jpeg', quality: 0.8, signal }),
    preview.pageInfo(index),
  ]);
  const cache = cacheOf(preview);
  const raced = cache.get(index);
  if (raced) return raced;
  const thumb = { url: URL.createObjectURL(blob), width: info.width, height: info.height };
  cache.set(index, thumb);
  return thumb;
}

/** Frees every thumbnail URL of a document. Called when it is closed. */
export function releaseThumbnails(preview: PdfPreview): void {
  const cache = caches.get(preview);
  if (!cache) return;
  for (const t of cache.values()) URL.revokeObjectURL(t.url);
  caches.delete(preview);
}
