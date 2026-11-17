import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { baseName, extensionOf } from '@/lib/files';
import { abortError } from './worker-host';

export type ZipEntry = { name: string; blob: Blob };

// Already-compressed formats are stored as-is; deflating them again only costs time.
const STORED = /^(image\/(?!svg|bmp|x-tga|tiff)|video\/|audio\/(?!wav|aiff)|application\/(pdf|zip|epub))/;

/**
 * Streams entries into a ZIP one at a time, so a caller can drop each source
 * (for example a rendered page) as soon as it has been added.
 */
export class ZipWriter {
  #chunks: Uint8Array[] = [];
  #error: Error | null = null;
  #names = new Set<string>();
  #zip = new Zip((err, chunk) => {
    if (err) this.#error = err;
    else this.#chunks.push(chunk);
  });

  async add(name: string, blob: Blob): Promise<void> {
    const ext = extensionOf(name);
    let unique = name;
    for (let n = 2; this.#names.has(unique.toLowerCase()); n += 1) {
      unique = ext ? `${baseName(name)} (${n}).${ext}` : `${name} (${n})`;
    }
    this.#names.add(unique.toLowerCase());
    const data = new Uint8Array(await blob.arrayBuffer());
    const entry = STORED.test(blob.type)
      ? new ZipPassThrough(unique)
      : new ZipDeflate(unique, { level: 6 });
    this.#zip.add(entry);
    entry.push(data, true);
    if (this.#error) throw this.#error;
  }

  finish(): Blob {
    this.#zip.end();
    if (this.#error) throw this.#error;
    return new Blob(this.#chunks as Uint8Array<ArrayBuffer>[], { type: 'application/zip' });
  }
}

/** Packs files into one ZIP blob. Duplicate names get " (2)" style suffixes. */
export async function zipFiles(entries: readonly ZipEntry[], signal?: AbortSignal): Promise<Blob> {
  const writer = new ZipWriter();
  for (const entry of entries) {
    if (signal?.aborted) throw abortError();
    await writer.add(entry.name, entry.blob);
  }
  return writer.finish();
}
