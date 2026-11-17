import { WorkerHost } from '../worker-host';
import type { GsWorkerApi } from './gs.worker';

const host = new WorkerHost<GsWorkerApi>(
  () => new Worker(new URL('./gs.worker.ts', import.meta.url), { type: 'module' }),
);

/** One-time download of Ghostscript (wasm + glue, uncompressed), for UI hints. */
export const GHOSTSCRIPT_DOWNLOAD_BYTES = 15_571_000;

export type GsPdfSettings = 'screen' | 'ebook' | 'printer' | 'prepress';

export type GsCompressOptions = {
  /** Ghostscript's distiller preset; it sets image resolution and JPEG quality defaults. */
  settings: GsPdfSettings;
  /** Downsample colour and grey images above this resolution (dpi). Null keeps the preset's value. */
  imageDpi: number | null;
  /** Convert everything to greyscale. */
  grayscale: boolean;
  /** Password of an encrypted input. */
  password?: string;
};

const IN = '/input.pdf';
const OUT = '/output.pdf';

function failure(log: string[]): Error {
  if (log.some((l) => /password/i.test(l))) {
    const err = new Error('That password is not correct for this PDF.');
    err.name = 'WrongPasswordError';
    return err;
  }
  const detail = log
    .filter((l) => /error/i.test(l))
    .slice(-1)
    .join(' ')
    .trim();
  return new Error(`Ghostscript could not rewrite this PDF${detail ? ` (${detail})` : ''}.`);
}

/**
 * Ghostscript engine (Ghostscript 10 compiled to WebAssembly, AGPL, ~15.5 MB).
 * Lazy and worker-hosted like the others. Only PDF rewriting (pdfwrite) is exposed.
 */
export const ghostscriptEngine = {
  /**
   * Rewrites a PDF with pdfwrite: every image is resampled and re-encoded and
   * fonts are re-embedded as subsets. Interactive features (form fields, some
   * annotations, structure tags) may not survive. Resolves with the new bytes
   * whatever their size; callers compare sizes.
   */
  async compress(file: Blob, opts: GsCompressOptions, { signal }: { signal?: AbortSignal } = {}): Promise<Blob> {
    const args = [
      '-sDEVICE=pdfwrite',
      '-dNOPAUSE',
      '-dBATCH',
      '-dSAFER',
      '-dQUIET',
      `-dPDFSETTINGS=/${opts.settings}`,
      '-dCompatibilityLevel=1.6',
      '-dDetectDuplicateImages=true',
      '-dCompressFonts=true',
      '-dSubsetFonts=true',
    ];
    if (opts.imageDpi) {
      for (const kind of ['Color', 'Gray']) {
        args.push(
          `-dDownsample${kind}Images=true`,
          `-d${kind}ImageDownsampleType=/Bicubic`,
          `-d${kind}ImageResolution=${opts.imageDpi}`,
          `-d${kind}ImageDownsampleThreshold=1.25`,
        );
      }
    }
    if (opts.grayscale) args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray');
    if (opts.password) args.push(`-sPDFPassword=${opts.password}`);
    args.push(`-sOutputFile=${OUT}`, IN);
    const result = await host.call((api) => api.run(args, file, IN, OUT), signal);
    if (!result.output || result.output.byteLength === 0 || result.code !== 0) throw failure(result.log);
    return new Blob([result.output], { type: 'application/pdf' });
  },

  terminate(): void {
    host.terminate();
  },
};

export type GhostscriptEngine = typeof ghostscriptEngine;
