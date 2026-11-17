// Extracts embedded images at their stored quality: JPEG and JPEG 2000
// streams are saved byte-for-byte, everything else is decoded to lossless PNG.
import type * as M from 'mupdf';
import type { ExtractedImage, ExtractImagesOptions } from '../types';
import { type Doc, type Mupdf, filtersOf, pageResources, walkXObjects } from './common';

function colorspaceLabel(image: M.Image): string {
  const cs = image.getColorSpace();
  if (!cs) return image.getImageMask() ? 'Mask' : 'None';
  if (cs.isCMYK()) return 'CMYK';
  if (cs.isGray()) return 'Gray';
  if (cs.isRGB()) return 'RGB';
  if (cs.isIndexed()) return 'Indexed';
  return cs.getType();
}

/** Decoded pixels of an image in grey (one-channel images) or RGB, without alpha. */
function colourPixmap(m: Mupdf, image: M.Image): M.Pixmap {
  const pix = image.toPixmap();
  const pcs = pix.getColorSpace();
  // PNG holds grey or RGB: one-channel spaces (ICC grey, Separation) become grey,
  // everything else (CMYK, Lab, DeviceN) RGB.
  const target = pix.getNumberOfComponents() - pix.getAlpha() === 1 ? m.ColorSpace.DeviceGray : m.ColorSpace.DeviceRGB;
  if (pcs && pcs.getName() === target.getName() && !pix.getAlpha()) return pix;
  const converted = pix.convertToColorSpace(target, false);
  pix.destroy();
  return converted;
}

/**
 * The image with its soft mask (or stencil mask) as the PNG alpha channel.
 * MuPDF's draw device does not apply an image's mask (the PDF interpreter
 * does, with a soft-mask group), so the two are combined here. A mask of a
 * different size is sampled to the image's size.
 */
function withAlpha(m: Mupdf, image: M.Image, maskImage: M.Image): M.Pixmap {
  const colour = colourPixmap(m, image);
  const mask = maskImage.toPixmap();
  try {
    const w = colour.getWidth();
    const h = colour.getHeight();
    const n = colour.getNumberOfComponents();
    const cs = n === 1 ? m.ColorSpace.DeviceGray : m.ColorSpace.DeviceRGB;
    const out = new m.Pixmap(cs, [0, 0, w, h], true);
    const src = colour.getPixels();
    const srcStride = colour.getStride();
    const mw = mask.getWidth();
    const mh = mask.getHeight();
    const mn = mask.getNumberOfComponents(); // bytes per pixel, alpha included
    const mStride = mask.getStride();
    const mp = mask.getPixels();
    const dst = out.getPixels();
    const dStride = out.getStride();
    for (let y = 0; y < h; y += 1) {
      const my = Math.min(mh - 1, Math.floor(((y + 0.5) * mh) / h));
      for (let x = 0; x < w; x += 1) {
        const mx = Math.min(mw - 1, Math.floor(((x + 0.5) * mw) / w));
        const a = mp[my * mStride + mx * mn] ?? 255;
        const d = y * dStride + x * (n + 1);
        const s = y * srcStride + x * n;
        // MuPDF pixmaps hold premultiplied colour; the PNG writer divides it out again.
        for (let c = 0; c < n; c += 1) dst[d + c] = Math.round(((src[s + c] ?? 0) * a) / 255);
        dst[d + n] = a;
      }
    }
    return out;
  } finally {
    mask.destroy();
    colour.destroy();
  }
}

function toPng(m: Mupdf, image: M.Image, opts: ExtractImagesOptions): Uint8Array {
  const mask = opts.applyMasks ? image.getMask() : null;
  const pix = mask ? withAlpha(m, image, mask) : colourPixmap(m, image);
  try {
    return pix.asPNG().slice();
  } finally {
    pix.destroy();
    mask?.destroy();
  }
}

/**
 * Calls `onImage` for each distinct image XObject, in page order. Stencil
 * masks and soft masks are not separate results (masks are merged into the
 * image they belong to when `applyMasks` is set). Returns counts.
 */
export function extractImages(
  m: Mupdf,
  doc: Doc,
  opts: ExtractImagesOptions,
  onImage: (img: ExtractedImage) => void,
  progress?: (done: number, total: number) => void,
): { saved: number; skipped: number } {
  const seen = new Set<number>();
  const masks = new Set<number>();
  let saved = 0;
  let skipped = 0;
  const pages = doc.countPages();
  for (let p = 0; p < pages; p += 1) {
    const page = doc.loadPage(p);
    try {
      const found: { num: number; ref: M.PDFObject }[] = [];
      walkXObjects(pageResources(page), (num, ref, subtype) => {
        if (subtype !== 'Image' || seen.has(num)) return;
        seen.add(num);
        const sm = ref.get('SMask');
        if (sm.isIndirect()) masks.add(sm.asIndirect());
        found.push({ num, ref });
      });
      let n = 0;
      for (const { num, ref } of found) {
        if (masks.has(num)) continue;
        if (ref.get('ImageMask').isBoolean() && ref.get('ImageMask').asBoolean()) {
          skipped += 1;
          continue;
        }
        let image: M.Image;
        try {
          image = doc.loadImage(ref);
        } catch {
          skipped += 1;
          continue;
        }
        try {
          const w = image.getWidth();
          const h = image.getHeight();
          if (w < opts.minSize && h < opts.minSize) {
            skipped += 1;
            continue;
          }
          n += 1;
          const name = `page-${p + 1}-image-${n}`;
          const colorspace = colorspaceLabel(image);
          const filters = filtersOf(ref);
          const single = filters.length === 1 ? filters[0] : null;
          const masked = image.getMask() !== null && opts.applyMasks;
          const cmyk = colorspace === 'CMYK';
          const decodeArray = ref.get('Decode').isArray();
          if (single === 'DCTDecode' && !masked && !decodeArray && !(cmyk && opts.cmykToRgb)) {
            const raw = ref.readRawStream();
            onImage({ name, ext: 'jpg', blob: new Blob([raw.asUint8Array().slice()], { type: 'image/jpeg' }), width: w, height: h, colorspace, source: 'original' });
            raw.destroy();
          } else if (single === 'JPXDecode' && !masked) {
            const raw = ref.readRawStream();
            onImage({ name, ext: 'jp2', blob: new Blob([raw.asUint8Array().slice()], { type: 'image/jp2' }), width: w, height: h, colorspace, source: 'original' });
            raw.destroy();
          } else {
            const png = toPng(m, image, opts);
            onImage({ name, ext: 'png', blob: new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), width: w, height: h, colorspace, source: 'decoded' });
          }
          saved += 1;
        } catch {
          skipped += 1;
        } finally {
          image.destroy();
        }
      }
    } finally {
      page.destroy();
    }
    progress?.(p + 1, pages);
  }
  return { saved, skipped };
}

