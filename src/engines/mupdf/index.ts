import { proxy, type Remote } from 'comlink';
import { WorkerHost } from '../worker-host';
import type { MupdfWorkerApi } from './mupdf.worker';
import type {
  CompressOptions,
  CompressStats,
  ExtractedImage,
  ExtractImagesOptions,
  PageText,
  PdfInfo,
  ProgressFn,
  RawPage,
  RedactionCheckerReport,
  RedactionRegion,
  RedactOptions,
  RedactResult,
  RenderedPage,
  RepairReport,
  SearchHit,
  SizeReport,
  TextMode,
  Matrix,
  TiffOptions,
} from './types';

export * from './types';
export { COMPRESS_PRESETS, type CompressPreset } from './ops/compress';

const host = new WorkerHost<MupdfWorkerApi>(
  () => new Worker(new URL('./mupdf.worker.ts', import.meta.url), { type: 'module' }),
);

/** Approximate one-time download of MuPDF (wasm + glue, uncompressed), for UI hints. */
export const MUPDF_DOWNLOAD_BYTES = 10_550_000;

type CallOptions = { signal?: AbortSignal; password?: string; onProgress?: ProgressFn };

/**
 * Runs a worker call with a progress callback proxied to the worker. Comlink
 * delivers callbacks on their own channel, so a late progress message could
 * arrive after the result; the callback goes quiet once the call settles.
 */
function withProgress<R>(fn: ProgressFn | undefined, call: (p: ProgressFn | undefined) => Promise<R>): Promise<R> {
  if (!fn) return call(undefined);
  let live = true;
  const p = proxy<ProgressFn>((done, total, note) => {
    if (live) fn(done, total, note);
  });
  return call(p).finally(() => {
    live = false;
  });
}

/** True for the errors the engine throws when a password is missing or wrong. */
export function isPasswordError(err: unknown): err is Error {
  return err instanceof Error && (err.name === 'PasswordRequiredError' || err.name === 'WrongPasswordError');
}

/**
 * An open document in the worker, for interactive tools that render and
 * search the same file many times. Reopens itself if the worker restarted
 * (after a cancelled call). Call `close()` when done.
 */
export class MupdfSession {
  #file: Blob;
  #password: string | undefined;
  #id: number;
  info: PdfInfo;

  private constructor(file: Blob, password: string | undefined, id: number, info: PdfInfo) {
    this.#file = file;
    this.#password = password;
    this.#id = id;
    this.info = info;
  }

  static async open(file: Blob, { signal, password }: CallOptions = {}): Promise<MupdfSession> {
    const { id, info } = await host.call((api) => api.open(file, password), signal);
    return new MupdfSession(file, password, id, info);
  }

  async #call<R>(fn: (api: Remote<MupdfWorkerApi>, id: number) => Promise<R>, signal?: AbortSignal): Promise<R> {
    try {
      return await host.call((api) => fn(api, this.#id), signal);
    } catch (err) {
      if (!(err instanceof Error) || err.name !== 'SessionClosedError') throw err;
      const { id } = await host.call((api) => api.open(this.#file, this.#password), signal);
      this.#id = id;
      return host.call((api) => fn(api, this.#id), signal);
    }
  }

  get pageCount(): number {
    return this.info.pageCount;
  }

  renderPage(index: number, { dpi = 96, format = 'png', signal }: { dpi?: number; format?: 'png' | 'jpeg'; signal?: AbortSignal } = {}): Promise<RenderedPage> {
    return this.#call((api, id) => api.renderPage(id, index, dpi, format), signal);
  }

  /** Raw grey or RGB pixels of a page (no alpha), for custom encoders. */
  renderRaw(index: number, { dpi, gray = false, signal }: { dpi: number; gray?: boolean; signal?: AbortSignal }): Promise<RawPage> {
    return this.#call((api, id) => api.renderRaw(id, index, dpi, gray), signal);
  }

  /** Positioned text lines of a page (points, top-left origin). */
  pageText(index: number, signal?: AbortSignal): Promise<PageText> {
    return this.#call((api, id) => api.pageText(id, index), signal);
  }

  /**
   * PDF user space → MuPDF page space for one page. Boxes from the PDF stage
   * (user space) map into the coordinates of `search`, `pageText` and
   * `redact` through it; its inverse maps back.
   */
  pageTransform(index: number, signal?: AbortSignal): Promise<Matrix> {
    return this.#call((api, id) => Promise.resolve(api.pageTransform(id, index)), signal);
  }

  /** Case-insensitive search; each hit has one quad per line it spans. */
  search(needle: string, { pages, signal }: { pages?: number[]; signal?: AbortSignal } = {}): Promise<SearchHit[]> {
    return this.#call((api, id) => api.search(id, needle, pages), signal);
  }

  close(): void {
    const id = this.#id;
    void host.call((api) => Promise.resolve(api.close(id))).catch(() => undefined);
  }
}

/**
 * MuPDF engine (MuPDF.js 1.28, AGPL). Lazy: the ~10 MB wasm is fetched from
 * /vendor/mupdf on first use and runs in one module worker. Every call takes
 * a signal; aborting terminates the worker (open sessions reopen on demand).
 * Calls on an encrypted file without the right password reject with an Error
 * named PasswordRequiredError or WrongPasswordError (see isPasswordError).
 */
export const mupdfEngine = {
  /** Page count, version, encryption and permissions, metadata. Works without a password for encryption details. */
  inspect(file: Blob, { signal, password }: CallOptions = {}): Promise<PdfInfo> {
    return host.call((api) => api.inspect(file, password), signal);
  },

  /** True when the file is encrypted (open password or permission restrictions). */
  isEncrypted(file: Blob, { signal }: CallOptions = {}): Promise<boolean> {
    return host.call((api) => api.isEncrypted(file), signal);
  },

  /**
   * An unencrypted copy. `password` is the open or owner password; files with
   * only permission restrictions need none (pass '').
   */
  decrypt(file: Blob, password: string, { signal }: CallOptions = {}): Promise<Blob> {
    return host.call((api) => api.decrypt(file, password), signal);
  },

  /** Resolves with `blob: null` (and `stats.keptOriginal`) when the result would not be smaller. */
  compress(
    file: Blob,
    options: CompressOptions,
    { signal, password, onProgress }: CallOptions = {},
  ): Promise<{ blob: Blob | null; stats: CompressStats }> {
    return withProgress(onProgress, (p) => host.call((api) => api.compress(file, options, password, p), signal));
  },

  analyzeSize(file: Blob, { signal, password, onProgress }: CallOptions = {}): Promise<SizeReport> {
    return withProgress(onProgress, (p) => host.call((api) => api.analyzeSize(file, password, p), signal));
  },

  /** Rebuilds the xref, drops unloadable pages and rewrites the file. Rejects when nothing is readable. */
  repair(file: Blob, { signal, password, onProgress }: CallOptions = {}): Promise<{ blob: Blob; report: RepairReport }> {
    return withProgress(onProgress, (p) => host.call((api) => api.repair(file, password, p), signal));
  },

  /**
   * Last-resort repair: every page MuPDF can draw becomes a JPEG picture in a
   * new PDF. Text, links and form fields are lost; say so to the user.
   */
  rasterize(
    file: Blob,
    opts: { dpi: number; quality: number },
    { signal, password, onProgress }: CallOptions = {},
  ): Promise<{ blob: Blob; report: RepairReport }> {
    return withProgress(onProgress, (p) => host.call((api) => api.rasterize(file, opts, password, p), signal));
  },

  /** Renders pages into one multi-page TIFF (Deflate-compressed). */
  toTiff(file: Blob, opts: TiffOptions, { signal, password, onProgress }: CallOptions = {}): Promise<Blob> {
    return withProgress(onProgress, (p) => host.call((api) => api.toTiff(file, opts, password, p), signal));
  },

  /** One string per page. 'layout' keeps columns and tables aligned on a character grid. */
  extractText(file: Blob, mode: TextMode, { signal, password, onProgress }: CallOptions = {}): Promise<string[]> {
    return withProgress(onProgress, (p) => host.call((api) => api.extractText(file, mode, password, p), signal));
  },

  extractImages(
    file: Blob,
    options: ExtractImagesOptions,
    { signal, password, onProgress }: CallOptions = {},
  ): Promise<{ images: ExtractedImage[]; skipped: number }> {
    return withProgress(onProgress, (p) => host.call((api) => api.extractImages(file, options, password, p), signal));
  },

  /** Removes everything under the boxes (text, image pixels, covered vector art) and verifies the output. */
  redact(
    file: Blob,
    regions: RedactionRegion[],
    options: RedactOptions,
    { signal, password, onProgress }: CallOptions = {},
  ): Promise<RedactResult> {
    return withProgress(onProgress, (p) => host.call((api) => api.redact(file, regions, options, password, p), signal));
  },

  /** Finds text that is still extractable under black boxes or unapplied redaction marks. */
  checkRedactions(file: Blob, { signal, password, onProgress }: CallOptions = {}): Promise<RedactionCheckerReport> {
    return withProgress(onProgress, (p) => host.call((api) => api.checkRedactions(file, password, p), signal));
  },

  /** Opens a document for repeated rendering, text and search calls. */
  openSession(file: Blob, options: CallOptions = {}): Promise<MupdfSession> {
    return MupdfSession.open(file, options);
  },

  terminate(): void {
    host.terminate();
  },
};

export type MupdfEngine = typeof mupdfEngine;

/**
 * For other tools: true when a PDF is encrypted (it needs an open password, or
 * it opens freely but carries owner-password restrictions).
 */
export function isEncrypted(file: Blob, options: CallOptions = {}): Promise<boolean> {
  return mupdfEngine.isEncrypted(file, options);
}

/**
 * For other tools: an unencrypted copy of `file`. `password` is the open (or
 * owner) password; pass '' for a file that only has permission restrictions.
 * Rejects with an error that `isPasswordError` recognises when it is wrong.
 */
export function decrypt(file: Blob, password: string, options: CallOptions = {}): Promise<Blob> {
  return mupdfEngine.decrypt(file, password, options);
}
