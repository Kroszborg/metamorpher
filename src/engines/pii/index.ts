import { proxy } from 'comlink';
import { WorkerHost } from '../worker-host';
import type { PiiWorkerApi } from './pii.worker';
import type { CleanOptions, PiiPage, PiiScanOptions, PrivacyReport } from './types';

export * from './detectors';
export { charsFromWords, locatePii, type PiiBox, type PiiHit, type PositionedChar } from './locate';
export { splitTextArrays } from './split-tj';
export * from './types';

const host = new WorkerHost<PiiWorkerApi>(() => new Worker(new URL('./pii.worker.ts', import.meta.url), { type: 'module' }));

type CallOptions = { signal?: AbortSignal; password?: string; onProgress?: (done: number, total: number) => void };

/**
 * Personal-data search over a PDF's text (MuPDF in its own worker; the file
 * stays open between scans of the same Blob, so changing the categories is
 * quick). Scanned pages have no text: run OCR and `locatePii` over the words.
 */
export const piiEngine = {
  scan(file: Blob, options: PiiScanOptions, { signal, password, onProgress }: CallOptions = {}): Promise<PiiPage[]> {
    let live = true;
    const p = onProgress
      ? proxy((done: number, total: number) => {
          if (live) onProgress(done, total);
        })
      : undefined;
    return host.call((api) => api.scan(file, options, password, p), signal).finally(() => {
      live = false;
    });
  },

  /**
   * Works around MuPDF 1.28 shifting the rest of a line after redacted text
   * drawn from a TJ array: rewrites those pages' text as plain Tj strings
   * (identical appearance). Resolves with the copy to redact, or null when the
   * file needs no change. The copy is unencrypted.
   */
  prepareRedaction(file: Blob, pages: number[], { signal, password }: CallOptions = {}): Promise<Blob | null> {
    return host.call((api) => api.prepareRedaction(file, pages, password), signal);
  },

  /** The privacy report: metadata, hidden content, scripts, comments, form data, fonts, links, personal data, covered text. */
  privacy(file: Blob, { signal, password, onProgress }: CallOptions = {}): Promise<PrivacyReport> {
    let live = true;
    const p = onProgress
      ? proxy((done: number, total: number) => {
          if (live) onProgress(done, total);
        })
      : undefined;
    return host.call((api) => api.privacy(file, password, p), signal).finally(() => {
      live = false;
    });
  },

  /** Removes the chosen items. `redactionPassed` verifies the covered-text redaction (null when there was none). */
  clean(
    file: Blob,
    opts: CleanOptions,
    { signal, password }: CallOptions = {},
  ): Promise<{ blob: Blob; removed: string[]; redactionPassed: boolean | null }> {
    return host.call((api) => api.clean(file, opts, password), signal);
  },

  pageTexts(file: Blob, { signal, password }: CallOptions = {}): Promise<string[]> {
    return host.call((api) => api.pageTexts(file, password), signal);
  },

  close(): void {
    void host.call((api) => Promise.resolve(api.close())).catch(() => undefined);
  },
};

/** Maps a MuPDF page-space box to PDF user space with the page's transform (for the page stage). */
export function pageBoxToUser(box: [number, number, number, number], t: readonly number[]): [number, number, number, number] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = t;
  const det = a * d - b * c || 1;
  const inv = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det] as const;
  const pts = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ].map(([x = 0, y = 0]) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
