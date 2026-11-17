/**
 * Decoding to RGBA pixels inside the image worker.
 *
 * - JPEG, PNG, WebP, AVIF, GIF (first frame), BMP and ICO use the browser's
 *   own decoder via createImageBitmap with `imageOrientation: 'from-image'`,
 *   so EXIF orientation is applied.
 * - HEIC/HEIF uses libheif (rotation/mirroring from the file applied).
 *
 * Colour: with `keepProfile`, an RGB source with a non-sRGB ICC profile
 * (Display P3, Adobe RGB…) is decoded without colour conversion and the
 * profile is returned, so the encoder can embed it again and nothing shifts.
 * Otherwise the browser's colour management converts to sRGB (for HEIC the
 * pixels are re-tagged with their profile through a PNG wrapper so the
 * browser can do the same). CMYK and grayscale profiles are always converted.
 *
 * Output is always 8-bit RGBA; 16-bit and HDR sources are reduced to that.
 */
import { zlibSync } from 'fflate';
import { iccFromNclx } from './cicp';
import { decodeHeic } from './codecs';
import { DECODE_FAILED, MAX_PIXELS } from './limits';
import { iccColourSpace, isSrgbProfile, readIcc } from './icc';
import { readHeif } from './isobmff';
import { iccDescription, type ImageProbe, probeImage } from './probe';
import { offscreen } from './pixels';

export function checkPixelLimit(width: number, height: number): void {
  if (width * height > MAX_PIXELS) {
    const mp = ((width * height) / 1e6).toFixed(0);
    throw new Error(
      `This image is ${width} × ${height} (${mp} megapixels). Images up to ${MAX_PIXELS / 1e6} megapixels can be processed in the browser: editing one needs about 40 bytes of memory per pixel, about 4 GB at that size. Scale it down with a desktop app first (removing metadata works at any size).`,
    );
  }
}

function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  const { width, height } = bitmap;
  const canvas = offscreen(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available in this browser.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height);
  // Release the canvas backing store now rather than at GC.
  canvas.width = 0;
  canvas.height = 0;
  return data;
}

// ── PNG wrapper used to colour-manage HEIC pixels through the browser ─────

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i += 1) c = (CRC[(c ^ (out[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}

function pngTaggedWithIcc(img: ImageData, icc: Uint8Array): Blob {
  const { width, height, data } = img;
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  // iCCP: keyword "icc", NUL, compression method 0, zlib-compressed profile.
  const profile = zlibSync(icc);
  const iccp = new Uint8Array(5 + profile.length);
  iccp.set([0x69, 0x63, 0x63, 0, 0]);
  iccp.set(profile, 5);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('iCCP', iccp),
    chunk('IDAT', zlibSync(raw, { level: 1 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  return new Blob(parts as Uint8Array<ArrayBuffer>[], { type: 'image/png' });
}

/** Converts pixels in `icc`'s colour space to sRGB with the browser's colour management. */
async function toSrgb(img: ImageData, icc: Uint8Array): Promise<ImageData> {
  try {
    const bitmap = await createImageBitmap(pngTaggedWithIcc(img, icc), { colorSpaceConversion: 'default' });
    return bitmapToImageData(bitmap);
  } catch {
    return img; // Profile the browser cannot use: keep the coded values.
  }
}

async function decodeHeif(blob: Blob, icc: Uint8Array | undefined, keep: boolean): Promise<ImageData> {
  const img = bitmapToImageData(await decodeHeic(blob));
  if (!icc || keep) return img;
  return toSrgb(img, icc);
}

/**
 * How colour was handled: `srgb` (the source was sRGB or untagged), `kept`
 * (pixels are in the source's profile, returned as `icc` for embedding) or
 * `converted` (the source's profile was converted to sRGB).
 */
export type ColourHandling = 'srgb' | 'kept' | 'converted';

export type Decoded = {
  image: ImageData;
  probe: ImageProbe;
  colour: ColourHandling;
  /** The profile the pixels are in, when `colour` is 'kept'. */
  icc?: Uint8Array;
  /** Description of the source's non-sRGB profile ("Display P3"), if any. */
  profile?: string;
};

/** Decodes the first frame to 8-bit RGBA, orientation applied. */
export async function decodeImage(blob: Blob, { keepProfile = false }: { keepProfile?: boolean } = {}): Promise<Decoded> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const probe = probeImage(bytes);
  if (probe.width && probe.height) checkPixelLimit(probe.width, probe.height);
  if (probe.format === 'svg') {
    throw new Error('SVG files are vector images; use SVG to PNG to rasterise them.');
  }
  let source = readIcc(bytes, probe.format);
  // HEIC/AVIF tagged only with CICP code points (nclx): a matching profile is made, and the
  // pixels are decoded as coded and converted (or kept) through it like an embedded profile.
  let fromNclx = false;
  if (!source && (probe.format === 'heic' || probe.format === 'avif')) {
    const nclx = readHeif(bytes)?.nclx;
    source = nclx ? iccFromNclx(nclx) : undefined;
    fromNclx = !!source;
  }
  const wide = source && !isSrgbProfile(source) ? source : undefined;
  const keep = !!wide && keepProfile && !probe.cmyk && iccColourSpace(wide) === 'RGB ';
  let image: ImageData;
  if (probe.format === 'heic') {
    image = await decodeHeif(blob, wide, keep);
  } else {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
        premultiplyAlpha: 'none',
        colorSpaceConversion: keep || fromNclx ? 'none' : 'default',
      });
    } catch {
      throw new Error(`${DECODE_FAILED}: This browser cannot read this image.`);
    }
    checkPixelLimit(bitmap.width, bitmap.height);
    image = bitmapToImageData(bitmap);
    if (fromNclx && wide && !keep) image = await toSrgb(image, wide);
  }
  const profile = wide ? (iccDescription(wide) ?? 'an embedded colour profile') : undefined;
  return {
    image,
    probe: { ...probe, width: image.width, height: image.height },
    colour: keep ? 'kept' : wide ? 'converted' : 'srgb',
    icc: keep ? wide : undefined,
    profile,
  };
}
