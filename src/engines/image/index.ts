import { proxy } from 'comlink';
import { WorkerHost } from '../worker-host';
import type { ImageWorkerApi } from './image.worker';
import type { MetadataReport } from './metadata';
import type { ImageProbe } from './probe';
import type {
  CanvasFormat,
  CompressOptions,
  CompressResult,
  EncodeOptions,
  ProcessOptions,
  ProcessResult,
  ProgressFn,
  RenditionSpec,
} from './types';

export type {
  CanvasFormat,
  ColourHandling,
  CompressFormat,
  CompressOptions,
  CompressResult,
  CropRect,
  EncodeOptions,
  OutputFormat,
  ProcessOptions,
  ProcessResult,
  ProgressFn,
  RenditionSpec,
  ResizeSpec,
  SourceInfo,
} from './types';
export { CAN_EMBED_ICC } from './icc';
export type { ExifSummary } from './exif';
export type { MetadataReport } from './metadata';
export type { ImageProbe, SourceFormat } from './probe';
export { encodeIcoMulti } from './encoders';
export {
  browserCanShow,
  FORMAT_ALPHA,
  FORMAT_ANIMATES,
  FORMAT_EXT,
  FORMAT_LABEL,
  formatFromName,
  IMAGE_ACCEPT,
  keepFormat,
  LOSSY_FORMATS,
} from './formats';
export { MAX_ANIMATION_PIXELS, MAX_PIXELS } from './limits';

/** True when the error means the browser could not decode the input image. */
export function isDecodeError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('IMAGE_DECODE_FAILED');
}

/** The human part of an engine error (drops the internal decode marker). */
export function imageErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Something went wrong while processing this image.';
  return err.message.replace(/^IMAGE_DECODE_FAILED:\s*/, '');
}

/**
 * Creates an image engine with its own worker. The shared `imageEngine`
 * (ctx.engines.image) is one of these; tools that run cancellable live
 * previews next to a job can create a separate one, so cancelling a preview
 * never terminates the job's worker.
 */
export function createImageEngine() {
  const host = new WorkerHost<ImageWorkerApi>(
    () => new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' }),
  );
  let supported: Promise<CanvasFormat[]> | null = null;
  const progress = (fn?: ProgressFn) => (fn ? proxy(fn) : undefined);

  return {
    /**
     * Decode, then encode as `options.format`. Orientation applied; metadata is
     * not carried over (except EXIF with `exif` for JPEG); colour per `colour`.
     * Animated GIF/WebP/APNG stay animated when written as GIF, WebP or PNG.
     */
    convert(blob: Blob, options: EncodeOptions, signal?: AbortSignal, onProgress?: ProgressFn): Promise<Blob> {
      return host.call((api) => api.convert(blob, options, progress(onProgress)), signal);
    },

    /**
     * Rotate/flip/crop/resize (Lanczos3) and encode in one pass; every frame
     * of an animation when the output keeps it.
     */
    process(blob: Blob, options: ProcessOptions, signal?: AbortSignal, onProgress?: ProgressFn): Promise<ProcessResult> {
      return host.call((api) => api.process(blob, options, progress(onProgress)), signal);
    },

    /** Several sizes and formats from one decode. */
    renditions(
      blob: Blob,
      specs: RenditionSpec[],
      signal?: AbortSignal,
    ): Promise<{ blob: Blob; width: number; height: number }[]> {
      return host.call((api) => api.renditions(blob, specs), signal);
    },

    /** Encodes raw RGBA pixels. The ImageData is copied to the worker. */
    encodePixels(image: ImageData, options: EncodeOptions, signal?: AbortSignal): Promise<Blob> {
      return host.call((api) => api.encodePixels(image, options), signal);
    },

    /**
     * Re-encodes at a quality or towards a target size. `cache` keeps the last
     * decoded image in the worker for repeated previews of the same file;
     * `proxySide` compresses a scaled-down copy for a quick preview (the
     * result has `proxy: true` and is not the real output).
     */
    compress(
      blob: Blob,
      options: CompressOptions,
      signal?: AbortSignal,
      extra: { cache?: boolean; proxySide?: number; onProgress?: ProgressFn } = {},
    ): Promise<CompressResult> {
      const { onProgress, ...rest } = extra;
      return host.call((api) => api.compress(blob, options, rest, progress(onProgress)), signal);
    },

    /** A small JPEG/PNG rendering for display, plus the full displayed size. */
    preview(
      blob: Blob,
      maxSide: number,
      signal?: AbortSignal,
    ): Promise<{ blob: Blob; width: number; height: number; transparent: boolean }> {
      return host.call((api) => api.preview(blob, maxSide), signal);
    },

    /** Header-only facts: format, displayed size, orientation, animation, alpha. */
    probe(blob: Blob, signal?: AbortSignal): Promise<ImageProbe> {
      return host.call((api) => api.probe(blob), signal);
    },

    dimensions(blob: Blob, signal?: AbortSignal): Promise<{ width: number; height: number }> {
      return host.call((api) => api.dimensions(blob), signal);
    },

    readMetadata(blob: Blob, signal?: AbortSignal): Promise<MetadataReport> {
      return host.call((api) => api.readMetadata(blob), signal);
    },

    /** Lossless metadata removal (see metadata.ts for what each format keeps). */
    stripMetadata(
      blob: Blob,
      options: { keepIcc?: boolean } = {},
      signal?: AbortSignal,
    ): Promise<{ blob: Blob; removed: string[]; keptOrientation?: number }> {
      return host.call((api) => api.stripMetadata(blob, options), signal);
    },

    /** Drops the decoded image a preview engine keeps for repeated `compress`/`preview` calls. */
    release(): Promise<void> {
      return host.call((api) => api.release());
    },

    /** Cached after the first call. Every format is supported in every browser now. */
    supportedFormats(): Promise<CanvasFormat[]> {
      supported ??= host.call((api) => api.supportedFormats()).catch((err: unknown) => {
        supported = null;
        throw err;
      });
      return supported;
    },

    terminate(): void {
      host.terminate();
    },
  };
}

/**
 * Image engine. Decodes with the browser (libheif for HEIC), resamples with
 * Lanczos3 and encodes with WebAssembly codecs (MozJPEG, oxipng, libwebp,
 * libavif) in a module worker. Codecs are fetched from /vendor on first use.
 */
export const imageEngine = createImageEngine();

export type ImageEngine = ReturnType<typeof createImageEngine>;
