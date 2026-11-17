import type { JobContext } from '@/components/workbench';
import { isDecodeError } from '@/engines/image';
import { extensionOf } from '@/lib/files';

/** Inputs most browsers cannot decode; ffmpeg turns them into PNG first. */
const FFMPEG_FIRST = new Set(['tif', 'tiff', 'tga']);
/** Formats every browser decodes: a failure means a damaged file, so ffmpeg is not tried. */
const NATIVE = new Set(['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'bmp', 'ico', 'avif', 'heic', 'heif', 'svg']);

/** The first frame of `file` as PNG, decoded by ffmpeg (downloaded on first use). */
export function ffmpegToPng(file: Blob, inputExt: string, ctx: JobContext): Promise<Blob> {
  ctx.onProgress(0.1, 'Decoding with ffmpeg');
  return ctx.engines.ffmpeg.run({
    input: file,
    inputExt,
    outputExt: 'png',
    args: (i, o) => ['-i', i, '-frames:v', '1', o],
    signal: ctx.signal,
  });
}

/**
 * Runs `fn` on the file, or on a PNG made by ffmpeg when the browser cannot
 * decode it (TIFF, TGA and other formats outside the web's usual set).
 */
export async function withDecodeFallback<T>(file: File, ctx: JobContext, fn: (source: Blob) => Promise<T>): Promise<T> {
  const ext = extensionOf(file.name);
  if (FFMPEG_FIRST.has(ext)) return fn(await ffmpegToPng(file, ext, ctx));
  try {
    return await fn(file);
  } catch (err) {
    if (!isDecodeError(err)) throw err;
    if (NATIVE.has(ext)) throw new Error('This image could not be read. The file may be damaged or incomplete.');
    return fn(await ffmpegToPng(file, ext || 'img', ctx));
  }
}
