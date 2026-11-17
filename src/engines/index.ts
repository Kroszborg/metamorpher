import { ZipWriter, zipFiles } from './archive';
import { ffmpegEngine } from './ffmpeg';
import { ghostscriptEngine } from './ghostscript';
import { imageEngine } from './image';
import { mediaEngine } from './media';
import { mupdfEngine } from './mupdf';
import { pdfEngine } from './pdf';
import { qpdfEngine } from './qpdf';

export { abortError, isAbortError } from './worker-host';

/**
 * Every engine, handed to tools as `ctx.engines`. Engines are lazy: a worker,
 * pdf.js or the ffmpeg core is only fetched and started on its first call.
 */
export const engines = {
  pdf: pdfEngine,
  image: imageEngine,
  ffmpeg: ffmpegEngine,
  media: mediaEngine,
  archive: { zip: zipFiles, ZipWriter },
  mupdf: mupdfEngine,
  qpdf: qpdfEngine,
  ghostscript: ghostscriptEngine,
};

export type Engines = typeof engines;
