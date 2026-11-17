// PDF compression with MuPDF: image downsampling and JPEG re-encoding by
// effective on-page resolution, font subsetting, metadata removal, and a full
// rewrite with garbage collection, Flate and object streams.
import { zlibSync } from 'fflate';
import type * as M from 'mupdf';
import type { CompressOptions, CompressStats, ProgressFn } from '../types';
import {
  type Doc,
  type Mupdf,
  type Obj,
  bufferToBytes,
  filtersOf,
  imageObjects,
  openPdf,
  pageResources,
  storedLength,
  stripMetadata,
  walkXObjects,
  writeOptions,
} from './common';

/** Only downsample when the image is at least this much sharper than the target. */
const DOWNSAMPLE_THRESHOLD = 1.25;
/** Leave small images alone: re-encoding them saves almost nothing. */
const MIN_STREAM_BYTES = 4096;
/** Refuse to decode images beyond this many pixels (wasm memory). */
const MAX_PIXELS = 120_000_000;

/**
 * The smallest effective resolution (pixels per inch) each image is drawn at,
 * keyed by object number. An image drawn at several sizes keeps enough pixels
 * for its largest placement.
 */
export function placementDpi(m: Mupdf, doc: Doc, progress?: ProgressFn): Map<number, number> {
  const dpi = new Map<number, number>();
  const pages = doc.countPages();
  for (let i = 0; i < pages; i += 1) {
    progress?.(i, pages, `Measuring images on page ${i + 1} of ${pages}`);
    let page: M.PDFPage;
    try {
      page = doc.loadPage(i);
    } catch {
      continue;
    }
    // Device callbacks get fz_image pointers; MuPDF's store returns the same
    // fz_image for an object while it is cached, so matching pointers right
    // after the run maps placements back to object numbers.
    const drawn = new Map<number, number>();
    const record = (image: M.Image, ctm: M.Matrix) => {
      const wPts = Math.hypot(ctm[0], ctm[1]);
      const hPts = Math.hypot(ctm[2], ctm[3]);
      if (wPts < 0.01 || hPts < 0.01) return;
      const d = Math.min((image.getWidth() * 72) / wPts, (image.getHeight() * 72) / hPts);
      const prev = drawn.get(image.pointer);
      drawn.set(image.pointer, prev === undefined ? d : Math.min(prev, d));
    };
    const device = new m.Device({
      fillImage: (image: M.Image, ctm: M.Matrix) => record(image, ctm),
      fillImageMask: (image: M.Image, ctm: M.Matrix) => record(image, ctm),
      clipImageMask: (image: M.Image, ctm: M.Matrix) => record(image, ctm),
    });
    try {
      page.run(device, m.Matrix.identity);
      device.close();
      walkXObjects(pageResources(page), (num, ref, subtype) => {
        if (subtype !== 'Image') return;
        try {
          const image = doc.loadImage(ref);
          const d = drawn.get(image.pointer);
          if (d !== undefined) dpi.set(num, Math.min(dpi.get(num) ?? Infinity, d));
        } catch {
          // undecodable image: leave it alone
        }
      });
    } catch {
      // A page that fails to run keeps its images untouched.
    } finally {
      device.destroy();
      page.destroy();
    }
  }
  return dpi;
}

/** Pixel rows without stride padding or alpha, as an image stream stores them. */
function packedPixels(pix: M.Pixmap): Uint8Array {
  const w = pix.getWidth();
  const h = pix.getHeight();
  // getNumberOfComponents() counts the alpha channel too.
  const total = pix.getNumberOfComponents();
  const n = total - pix.getAlpha();
  const stride = pix.getStride();
  const src = pix.getPixels();
  const row = w * n;
  if (stride === row && !pix.getAlpha()) return new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + row * h));
  const out = new Uint8Array(row * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < n; c += 1) out[y * row + x * n + c] = src[y * stride + x * total + c] ?? 0;
    }
  }
  return out;
}

/** Few distinct colours in a sample (or grey levels, for grey images) → line art or a screenshot, which JPEG would smear. */
function looksLikeGraphics(pix: M.Pixmap): boolean {
  const n = pix.getNumberOfComponents(); // includes alpha
  const data = pix.getPixels();
  const total = pix.getWidth() * pix.getHeight();
  const step = Math.max(1, Math.floor(total / 8192));
  const colours = new Set<number>();
  for (let p = 0; p < total; p += step) {
    const o = p * n;
    const key = ((data[o] ?? 0) << 16) | ((data[o + 1] ?? 0) << 8) | (data[o + 2] ?? 0);
    colours.add(n >= 3 ? key : (data[o] ?? 0));
    if (colours.size > (n >= 3 ? 256 : 48)) return false;
  }
  return true;
}

type ImageResult = 'recompressed' | 'downsampled' | 'kept';

function recompressImage(
  m: Mupdf,
  doc: Doc,
  ref: Obj,
  effectiveDpi: number | undefined,
  opts: CompressOptions,
  smaskTargets: Set<number>,
): ImageResult {
  if (ref.get('ImageMask').isBoolean() && ref.get('ImageMask').asBoolean()) return 'kept';
  if (ref.get('Mask').isArray()) return 'kept'; // colour-key masking needs exact colours
  const bpc = ref.get('BitsPerComponent');
  if (bpc.isNumber() && bpc.asNumber() < 8 && !filtersOf(ref).includes('JPXDecode')) {
    // 1/2/4-bit images (scans in CCITT/JBIG2, palettes) are already compact and would blur.
    return 'kept';
  }
  const filters = filtersOf(ref);
  if (filters.some((f) => f === 'JBIG2Decode' || f === 'CCITTFaxDecode')) return 'kept';
  const original = storedLength(ref);
  if (original < MIN_STREAM_BYTES) return 'kept';
  const isMask = smaskTargets.has(ref.asIndirect());

  const image = doc.loadImage(ref);
  const w = image.getWidth();
  const h = image.getHeight();
  if (w * h > MAX_PIXELS || w < 16 || h < 16) return 'kept';

  let scale = 1;
  if (opts.maxImageDpi && effectiveDpi !== undefined && effectiveDpi > opts.maxImageDpi * DOWNSAMPLE_THRESHOLD) {
    scale = opts.maxImageDpi / effectiveDpi;
  }
  const lossyOriginal = filters.includes('DCTDecode') || filters.includes('JPXDecode');
  // Nothing to gain from re-encoding a JPEG at the same size unless we change it.
  if (scale === 1 && !opts.grayscaleImages && filters.length === 1 && filters[0] === 'DCTDecode' && opts.imageQuality >= 85) {
    return 'kept';
  }

  let pix = image.toPixmap();
  try {
    if (pix.getAlpha()) {
      const flat = pix.convertToColorSpace(pix.getColorSpace() ?? m.ColorSpace.DeviceRGB, false);
      pix.destroy();
      pix = flat;
    }
    const cs = pix.getColorSpace();
    let target: M.ColorSpace;
    if (isMask || opts.grayscaleImages || cs?.isGray()) target = m.ColorSpace.DeviceGray;
    else target = m.ColorSpace.DeviceRGB;
    if (!cs || cs.getName() !== target.getName()) {
      const converted = pix.convertToColorSpace(target, false);
      pix.destroy();
      pix = converted;
    }

    const graphics = !lossyOriginal && looksLikeGraphics(pix);
    if ((graphics || isMask) && scale === 1) return 'kept';

    let out = pix;
    let tw = w;
    let th = h;
    if (scale < 1) {
      tw = Math.max(1, Math.round(w * scale));
      th = Math.max(1, Math.round(h * scale));
      const source = new m.Image(pix);
      out = new m.Pixmap(target, [0, 0, tw, th], false);
      out.clear(255);
      const device = new m.DrawDevice(m.Matrix.identity, out);
      device.fillImage(source, [tw, 0, 0, th, 0, 0], 1);
      device.close();
      device.destroy();
      source.destroy();
    }

    // Lossless (masks, line art, screenshots) keeps sharp edges; photos become JPEG.
    const lossless = graphics || isMask;
    const bytes = lossless
      ? zlibSync(packedPixels(out), { level: 9 })
      : out.asJPEG(Math.round(Math.min(100, Math.max(1, opts.imageQuality))), false).slice();
    if (out !== pix) out.destroy();

    // Only replace the stream when it is clearly smaller than what is stored now.
    if (bytes.length >= original * 0.9) return 'kept';
    ref.writeRawStream(bytes);
    ref.put('Filter', doc.newName(lossless ? 'FlateDecode' : 'DCTDecode'));
    ref.delete('DecodeParms');
    ref.delete('Decode');
    ref.put('Width', tw);
    ref.put('Height', th);
    ref.put('BitsPerComponent', 8);
    ref.put('ColorSpace', doc.newName(target === m.ColorSpace.DeviceGray ? 'DeviceGray' : 'DeviceRGB'));
    ref.delete('Intent');
    return scale < 1 ? 'downsampled' : 'recompressed';
  } finally {
    pix.destroy();
    image.destroy();
  }
}

export function compressPdf(
  m: Mupdf,
  bytes: Uint8Array,
  opts: CompressOptions,
  password?: string,
  progress?: ProgressFn,
): { bytes: Uint8Array<ArrayBuffer> | null; stats: CompressStats } {
  const doc = openPdf(m, bytes, password);
  try {
    const stats: CompressStats = {
      inputBytes: bytes.byteLength,
      outputBytes: bytes.byteLength,
      keptOriginal: false,
      imagesTotal: 0,
      imagesRecompressed: 0,
      imagesDownsampled: 0,
      fontsSubset: false,
    };

    if (opts.recompressImages) {
      const dpi = opts.maxImageDpi ? placementDpi(m, doc, (d, t, note) => progress?.(d, t * 3, note)) : new Map<number, number>();
      const images = imageObjects(doc);
      stats.imagesTotal = images.length;
      const smaskTargets = new Set<number>();
      for (const num of images) {
        const ref = doc.newIndirect(num);
        const sm = ref.get('SMask');
        if (!sm.isIndirect()) continue;
        smaskTargets.add(sm.asIndirect());
        // A soft mask is drawn wherever its image is: give it the same resolution budget.
        const parent = dpi.get(num);
        const pw = ref.get('Width');
        const mw = sm.get('Width');
        if (parent !== undefined && pw.isNumber() && mw.isNumber() && pw.asNumber() > 0) {
          dpi.set(sm.asIndirect(), (parent * mw.asNumber()) / pw.asNumber());
        }
      }
      images.forEach((num, i) => {
        progress?.(1 + i / Math.max(1, images.length), 3, `Optimising image ${i + 1} of ${images.length}`);
        try {
          const result = recompressImage(m, doc, doc.newIndirect(num), dpi.get(num), opts, smaskTargets);
          if (result === 'downsampled') stats.imagesDownsampled += 1;
          if (result !== 'kept') stats.imagesRecompressed += 1;
        } catch {
          // An image MuPDF cannot decode is left exactly as it was.
        }
      });
    }

    progress?.(2, 3, 'Rewriting the file');
    if (opts.subsetFonts) {
      try {
        doc.subsetFonts();
        stats.fontsSubset = true;
      } catch {
        stats.fontsSubset = false;
      }
    }
    if (opts.stripMetadata) stripMetadata(doc);

    const buf = doc.saveToBuffer(
      writeOptions({
        garbage: opts.garbage,
        'compress-images': true,
        'compress-fonts': true,
        objstms: opts.objectStreams ? 'yes' : undefined,
        clean: opts.cleanContent,
        // Keep the original encryption of an encrypted input.
        encrypt: 'keep',
      }),
    );
    const out = bufferToBytes(buf);
    progress?.(3, 3);
    if (out.byteLength >= bytes.byteLength) {
      stats.keptOriginal = true;
      return { bytes: null, stats };
    }
    stats.outputBytes = out.byteLength;
    return { bytes: out, stats };
  } finally {
    doc.destroy();
  }
}

export const COMPRESS_PRESETS = {
  light: {
    recompressImages: true,
    maxImageDpi: 220,
    imageQuality: 85,
    grayscaleImages: false,
    stripMetadata: false,
    subsetFonts: true,
    garbage: 'compact',
    objectStreams: true,
    cleanContent: false,
  },
  balanced: {
    recompressImages: true,
    maxImageDpi: 150,
    imageQuality: 72,
    grayscaleImages: false,
    stripMetadata: true,
    subsetFonts: true,
    garbage: 'deduplicate',
    objectStreams: true,
    cleanContent: true,
  },
  strong: {
    recompressImages: true,
    maxImageDpi: 96,
    imageQuality: 55,
    grayscaleImages: false,
    stripMetadata: true,
    subsetFonts: true,
    garbage: 'deduplicate',
    objectStreams: true,
    cleanContent: true,
  },
} as const satisfies Record<string, CompressOptions>;

export type CompressPreset = keyof typeof COMPRESS_PRESETS;

