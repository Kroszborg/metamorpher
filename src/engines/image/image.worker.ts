// Image decode → transform → encode, off the main thread. Pixels are decoded
// by the browser (or libheif for HEIC) and encoded with WebAssembly codecs.
import { expose } from 'comlink';
import { type AnimationInfo, decodeAnimation, encodeAnimatedWebp, readAnimation } from './animation';
import { encodeAvif, encodeJpeg, encodePng, encodeWebp, resizeLanczos } from './codecs';
import { checkPixelLimit, type Decoded, decodeImage } from './decode';
import { encodeBmp, encodeIco } from './encoders';
import { exifForCopy } from './exif';
import { FORMAT_ANIMATES } from './formats';
import { GifWriter } from './gif';
import { CAN_EMBED_ICC, embedIcc } from './icc';
import { MAX_ANIMATION_PIXELS } from './limits';
import { readMetadata, sourceExif, stripMetadata } from './metadata';
import { crop, flatten, flip, hasTransparency, offscreen, pad, parseColor, rotate } from './pixels';
import { encodeApng, encodePngFast } from './png';
import { type ImageProbe, probeImage } from './probe';
import type {
  CanvasFormat,
  CompressFormat,
  CompressOptions,
  CompressResult,
  EncodeOptions,
  ProcessOptions,
  ProcessResult,
  ProgressFn,
  RenditionSpec,
  ResizeSpec,
  SourceInfo,
} from './types';

const MIME: Record<CanvasFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};
const HAS_ALPHA: Record<CanvasFormat, boolean> = { jpeg: false, bmp: false, png: true, webp: true, avif: true, gif: true, ico: true };

const toBlob = (bytes: Uint8Array, format: CanvasFormat) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[format] });

// The last decoded image, so repeated previews of one file skip decoding.
let cache: { key: string; decoded: Decoded } | null = null;
const CACHE_MAX_PIXELS = 30e6;

function fileKey(blob: Blob, keepProfile: boolean): string {
  const f = blob as Partial<File>;
  return `${blob.size}:${blob.type}:${f.name ?? ''}:${f.lastModified ?? ''}:${keepProfile ? 'keep' : 'srgb'}`;
}

async function decode(blob: Blob, { keepProfile = false, useCache = false } = {}): Promise<Decoded> {
  const key = fileKey(blob, keepProfile);
  if (useCache && cache?.key === key) return cache.decoded;
  cache = null;
  const decoded = await decodeImage(blob, { keepProfile });
  if (useCache && decoded.image.width * decoded.image.height <= CACHE_MAX_PIXELS) cache = { key, decoded };
  return decoded;
}

/** Whether to decode keeping the source profile, for this output. */
const keepFor = (format: CanvasFormat, colour: EncodeOptions['colour']) => colour !== 'srgb' && CAN_EMBED_ICC[format];

/** GIF colours for a compression quality: 256 at 90% and above, down to 16 at 0%. */
const gifColours = (q: number) => (q >= 0.9 ? 256 : 2 ** Math.round(4 + 4 * Math.max(0, q)));

/** A copy of a decoded image scaled to at most `side` on the long side (cached with the decode). */
let proxy: { decoded: Decoded; side: number; image: ImageData } | null = null;

async function proxyOf(d: Decoded, side: number, keep: boolean): Promise<ImageData> {
  if (proxy?.decoded === d && proxy.side === side) return proxy.image;
  const { width, height } = d.image;
  const s = side / Math.max(width, height);
  const w = Math.max(1, Math.round(width * s));
  const h = Math.max(1, Math.round(height * s));
  // Two-step canvas scaling is close to Lanczos at this size and much faster on large photos.
  const src = offscreen(width, height);
  src.getContext('2d')?.putImageData(d.image, 0, 0);
  const mid = w * 2 < width ? offscreen(w * 2, h * 2) : null;
  const midCtx = mid?.getContext('2d');
  if (mid && midCtx) {
    midCtx.imageSmoothingQuality = 'high';
    midCtx.drawImage(src, 0, 0, mid.width, mid.height);
  }
  const dst = offscreen(w, h);
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid ?? src, 0, 0, w, h);
  src.width = 0;
  src.height = 0;
  const image = ctx.getImageData(0, 0, w, h);
  proxy = keep ? { decoded: d, side, image } : null;
  return image;
}

/**
 * Compression that keeps an animation: 'keep' of an animated GIF/WebP/APNG,
 * 'auto' (animated WebP or GIF, the smaller), 'webp', 'png' or 'gif'. Returns
 * null when the output cannot be animated (JPEG, AVIF), which then uses the
 * first frame.
 */
async function compressAnimation(blob: Blob, options: CompressOptions, onProgress?: ProgressFn): Promise<CompressResult | null> {
  const candidates: CompressFormat[] =
    options.format === 'auto' ? (options.targetBytes ? ['webp'] : ['webp', 'gif']) : options.format === 'keep' ? [] : [options.format];
  const first = candidates[0];
  if (!first || !candidates.every((f) => FORMAT_ANIMATES[f])) return null;
  const anim = await animationFor(blob, first, 'keep');
  if (!anim) return null;
  const maxSide = options.maxSide;
  const a = await animationFrames(
    anim.bytes,
    anim.info,
    async (img) => {
      if (!maxSide || Math.max(img.width, img.height) <= maxSide) return img;
      const s = maxSide / Math.max(img.width, img.height);
      return resizeLanczos(img, Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)));
    },
    onProgress,
  );
  const encodeAt = (format: CompressFormat, q: number) =>
    encodeAnimation(a, anim.info.plays, { format, quality: q, colours: gifColours(q) }, onProgress);
  type Attempt = { blob: Blob; format: CompressFormat; quality?: number; reachedTarget?: boolean };
  let best: Attempt | null = null;
  for (const format of candidates) {
    let r: Attempt;
    if (format === 'png') {
      r = { blob: await encodeAt('png', 1), format };
    } else if (!options.targetBytes) {
      const q = options.quality ?? 0.75;
      r = { blob: await encodeAt(format, q), format, quality: format === 'gif' ? undefined : q };
    } else {
      // Highest quality (WebP) or most colours (GIF) that fits; five tries at most.
      const target = options.targetBytes;
      const steps = format === 'gif' ? [0.9, 0.75, 0.5, 0.25, 0] : [0.9, 0.75, 0.6, 0.4, 0.2];
      let fit: { blob: Blob; q: number } | null = null;
      let smallest: { blob: Blob; q: number } | null = null;
      for (const q of steps) {
        const out = await encodeAt(format, q);
        if (!smallest || out.size < smallest.blob.size) smallest = { blob: out, q };
        if (out.size <= target) {
          fit = { blob: out, q };
          break;
        }
      }
      const pick = fit ?? smallest;
      if (!pick) throw new Error('Compression failed.');
      r = { blob: pick.blob, format, quality: format === 'gif' ? undefined : pick.q, reachedTarget: !!fit };
    }
    if (!best || r.blob.size < best.blob.size) best = r;
  }
  if (!best) return null;
  return {
    ...best,
    width: a.width,
    height: a.height,
    hadTransparency: anim.probe.alpha,
    flattened: false,
    ...animatedInfo(a.frames.length),
  };
}

function sourceInfo(d: Decoded, exifCopied = false): SourceInfo {
  return {
    colour: d.colour,
    profile: d.profile,
    animated: d.probe.animated,
    frames: d.probe.frames,
    animationKept: false,
    animationKeepable: ['gif', 'webp', 'png'].includes(d.probe.format),
    exifCopied,
  };
}

async function resizeTo(img: ImageData, spec: ResizeSpec): Promise<ImageData> {
  const width = Math.max(1, Math.round(spec.width));
  const height = Math.max(1, Math.round(spec.height));
  checkPixelLimit(width, height);
  const fit = spec.fit ?? 'stretch';
  if (fit === 'stretch') return resizeLanczos(img, width, height);
  const scale =
    fit === 'cover' ? Math.max(width / img.width, height / img.height) : Math.min(width / img.width, height / img.height);
  if (fit === 'cover') {
    // Crop the source to the box's aspect ratio, centred, then resample.
    const cw = Math.min(img.width, Math.round(width / scale));
    const ch = Math.min(img.height, Math.round(height / scale));
    const cropped = crop(img, { x: (img.width - cw) / 2, y: (img.height - ch) / 2, width: cw, height: ch });
    return resizeLanczos(cropped, width, height);
  }
  const w = Math.max(1, Math.min(width, Math.round(img.width * scale)));
  const h = Math.max(1, Math.min(height, Math.round(img.height * scale)));
  const fitted = await resizeLanczos(img, w, h);
  if (w === width && h === height) return fitted;
  return pad(fitted, width, height, spec.padColor ? parseColor(spec.padColor) : undefined);
}

/**
 * Composites transparent pixels onto the background when the format has no
 * alpha. `shared` images (cached or reused) are copied first, never changed.
 */
function prepare(img: ImageData, format: CanvasFormat, background: string | undefined, shared: boolean) {
  if (HAS_ALPHA[format] || !hasTransparency(img)) return { img, flattened: false };
  const target = shared ? new ImageData(new Uint8ClampedArray(img.data), img.width, img.height) : img;
  return { img: flatten(target, parseColor(background ?? '#ffffff')), flattened: true };
}

type Extras = { icc?: Uint8Array; exif?: Uint8Array };

/** Encodes pixels that are already flattened as needed (see `prepare`). */
async function encodeBytes(img: ImageData, options: EncodeOptions, extras: Extras = {}, onProgress?: ProgressFn): Promise<Uint8Array> {
  const quality = options.quality ?? 0.8;
  let bytes: Uint8Array;
  switch (options.format) {
    case 'jpeg':
      bytes = await encodeJpeg(img, quality);
      if (extras.exif) bytes = withJpegExif(bytes, extras.exif);
      break;
    case 'png':
      // Small images (icons, thumbnails) get oxipng by default: it is quick at that size.
      if ((options.effort ?? (img.width * img.height <= 512 * 512 ? 'smallest' : 'fast')) === 'smallest') {
        onProgress?.(0.5, 'Optimising the PNG with oxipng');
        bytes = await encodePng(img);
      } else {
        bytes = await encodePngFast(img, onProgress && throttle((f) => onProgress(f, 'Writing the PNG')));
      }
      break;
    case 'gif': {
      const writer = new GifWriter(img.width, img.height, {
        plays: 1,
        transparent: hasTransparency(img),
        dither: 'fs',
        colours: options.colours,
      });
      writer.add(img.data, 0);
      bytes = writer.finish();
      break;
    }
    case 'webp':
      bytes = await encodeWebp(img, quality, options.lossless);
      break;
    case 'avif':
      bytes = await encodeAvif(img, quality, options.lossless);
      break;
    case 'bmp':
      bytes = encodeBmp(img);
      break;
    case 'ico': {
      const side = Math.min(256, Math.max(img.width, img.height));
      const square = await resizeTo(img, { width: side, height: side, fit: 'contain' });
      bytes = encodeIco(await encodePng(square), side, side);
      break;
    }
  }
  if (extras.icc && CAN_EMBED_ICC[options.format]) bytes = embedIcc(bytes, options.format, extras.icc);
  return bytes;
}

async function encode(
  input: ImageData,
  options: EncodeOptions,
  extras: Extras = {},
  shared = false,
  onProgress?: ProgressFn,
): Promise<{ blob: Blob; flattened: boolean }> {
  const { img, flattened } = prepare(input, options.format, options.background, shared);
  return { blob: toBlob(await encodeBytes(img, options, extras, onProgress), options.format), flattened };
}

/** Limits progress messages to whole percents (each one crosses the worker boundary). */
function throttle(fn: (fraction: number) => void): (fraction: number) => void {
  let last = -1;
  return (f) => {
    const pct = Math.floor(f * 100);
    if (pct === last) return;
    last = pct;
    fn(f);
  };
}

// -- Animation ---------------------------------------------------------------

type AnimFrames = { frames: { data: Uint8ClampedArray<ArrayBuffer>; delay: number }[]; width: number; height: number };

/**
 * The source's animation when the output can keep it: GIF, WebP and APNG
 * sources written as GIF, WebP or PNG. Reads only the header for stills.
 */
async function animationFor(
  blob: Blob,
  format: CanvasFormat,
  mode: EncodeOptions['animation'],
): Promise<{ bytes: Uint8Array; info: AnimationInfo; probe: ImageProbe } | null> {
  if (mode === 'first-frame' || !FORMAT_ANIMATES[format]) return null;
  const probe = probeImage(new Uint8Array(await blob.slice(0, 1 << 20).arrayBuffer()));
  if (!probe.animated || !['gif', 'webp', 'png'].includes(probe.format)) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = readAnimation(bytes, probe.format);
  return info ? { bytes, info, probe } : null;
}

/** Decodes every frame and applies `change` to each (rotate, crop, resize...). */
async function animationFrames(
  bytes: Uint8Array,
  info: AnimationInfo,
  change: (img: ImageData) => Promise<ImageData>,
  onProgress?: ProgressFn,
): Promise<AnimFrames> {
  checkPixelLimit(info.width, info.height);
  const out: AnimFrames = { frames: [], width: 0, height: 0 };
  const n = info.delays.length;
  let total = 0;
  await decodeAnimation(bytes, info, async (f, i) => {
    const img = await change(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height));
    total += img.width * img.height;
    if (total > MAX_ANIMATION_PIXELS) {
      throw new Error(
        `This animation is too large to process in the browser: ${n} frames of ${img.width}×${img.height}. Up to ${MAX_ANIMATION_PIXELS / 1e6} megapixels across all frames can be kept; make it smaller or keep only the first frame.`,
      );
    }
    out.frames.push({ data: img.data, delay: info.delays[i] ?? 0 });
    out.width = img.width;
    out.height = img.height;
    onProgress?.((0.5 * (i + 1)) / n, `Decoding frame ${i + 1} of ${n}`);
  });
  return out;
}

/** Writes frames as an animated GIF, WebP or PNG. */
async function encodeAnimation(
  a: AnimFrames,
  plays: number,
  options: Pick<EncodeOptions, 'format' | 'quality' | 'lossless' | 'colours'>,
  onProgress?: ProgressFn,
): Promise<Blob> {
  const n = a.frames.length;
  const step = (done: number) => onProgress?.(0.5 + (0.5 * done) / n, `Encoding frame ${Math.min(n, done + 1)} of ${n}`);
  let bytes: Uint8Array;
  if (options.format === 'gif') {
    const transparent = a.frames.some((f) => {
      for (let k = 3; k < f.data.length; k += 4) if ((f.data[k] ?? 255) < 128) return true;
      return false;
    });
    const writer = new GifWriter(a.width, a.height, { plays, transparent, dither: 'ordered', colours: options.colours });
    a.frames.forEach((f, i) => {
      step(i);
      writer.add(f.data, f.delay);
    });
    bytes = writer.finish();
  } else if (options.format === 'webp') {
    const quality = options.quality ?? 0.8;
    bytes = await encodeAnimatedWebp(
      a.frames,
      a.width,
      a.height,
      plays,
      (f) => encodeWebp(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), quality, options.lossless),
      (f) => step(Math.round(f * n)),
    );
  } else {
    bytes = await encodeApng(a.frames, a.width, a.height, plays, (f) => step(Math.round(f * n)));
  }
  return toBlob(bytes, options.format);
}

function animatedInfo(frames: number): SourceInfo {
  return { colour: 'srgb', exifCopied: false, animated: true, frames, animationKept: true, animationKeepable: true };
}

/** An APP1 Exif segment after SOI (and JFIF), when it fits in one segment. */
function withJpegExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const len = 2 + 6 + tiff.length;
  if (len > 0xffff) return jpeg;
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + (((jpeg[4] ?? 0) << 8) | (jpeg[5] ?? 0));
  const out = new Uint8Array(jpeg.length + 2 + len);
  out.set(jpeg.subarray(0, at));
  out.set([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], at);
  out.set(tiff, at + 10);
  out.set(jpeg.subarray(at), at + 2 + len);
  return out;
}

/** EXIF to copy into a JPEG output, per `options.exif`. */
async function exifFor(blob: Blob, options: EncodeOptions): Promise<Uint8Array | undefined> {
  if (options.format !== 'jpeg' || !options.exif || options.exif === 'drop') return undefined;
  const tiff = sourceExif(new Uint8Array(await blob.arrayBuffer()));
  return (tiff && exifForCopy(tiff, { keepGps: options.exif === 'keep' })) ?? undefined;
}

async function transform(img: ImageData, o: Omit<ProcessOptions, 'output'>): Promise<ImageData> {
  let out = img;
  if (o.rotate) out = rotate(out, o.rotate);
  if (o.flipHorizontal || o.flipVertical) out = flip(out, !!o.flipHorizontal, !!o.flipVertical);
  if (o.crop) out = crop(out, o.crop);
  if (o.resize) out = await resizeTo(out, o.resize);
  return out;
}

async function compressPixels(
  img: ImageData,
  format: CompressFormat,
  options: CompressOptions,
  icc: Uint8Array | undefined,
  shared: boolean,
): Promise<{ blob: Blob; format: CompressFormat; quality?: number; reachedTarget?: boolean; flattened: boolean }> {
  // Flatten once (not per attempt) when the format has no alpha.
  const { img: ready, flattened } = prepare(img, format, options.background, shared);
  const effort = options.effort ?? (img.width * img.height <= 4e6 ? 'smallest' : 'fast');
  const run = async (q: number) =>
    toBlob(await encodeBytes(ready, { format, quality: q, effort, colours: gifColours(q) }, { icc }), format);
  if (format === 'png') return { blob: await run(1), format, flattened };
  const target = options.targetBytes;
  if (!target) {
    const quality = options.quality ?? 0.75;
    return { blob: await run(quality), format, quality, flattened };
  }
  // Highest quality whose output fits: binary search over 1–95.
  let lo = 1;
  let hi = 95;
  let best: { blob: Blob; quality: number } | null = null;
  let smallest: { blob: Blob; quality: number } | null = null;
  for (let i = 0; i < 7 && lo <= hi; i += 1) {
    const q = Math.round((lo + hi) / 2);
    const blob = await run(q / 100);
    if (!smallest || blob.size < smallest.blob.size) smallest = { blob, quality: q / 100 };
    if (blob.size <= target) {
      best = { blob, quality: q / 100 };
      lo = q + 1;
    } else {
      hi = q - 1;
    }
  }
  if (!best && lo <= 1) {
    const blob = await run(0.01);
    if (blob.size <= target) best = { blob, quality: 0.01 };
    else if (!smallest || blob.size < smallest.blob.size) smallest = { blob, quality: 0.01 };
  }
  const pick = best ?? smallest;
  if (!pick) throw new Error('Compression failed.');
  return { blob: pick.blob, format, quality: pick.quality, reachedTarget: !!best, flattened };
}

const api = {
  /** Every output format is available in every browser (WebAssembly encoders). */
  async supportedFormats(): Promise<CanvasFormat[]> {
    return ['jpeg', 'png', 'webp', 'avif', 'bmp', 'ico'];
  },

  /** Format, displayed size, orientation, animation and alpha from the header bytes. */
  async probe(blob: Blob): Promise<ImageProbe> {
    return probeImage(new Uint8Array(await blob.arrayBuffer()));
  },

  /** Pixel size after EXIF/HEIF orientation. */
  async dimensions(blob: Blob): Promise<{ width: number; height: number }> {
    const p = probeImage(new Uint8Array(await blob.arrayBuffer()));
    if (p.width && p.height) return { width: p.width, height: p.height };
    const { image } = await decode(blob);
    return { width: image.width, height: image.height };
  },

  async convert(blob: Blob, options: EncodeOptions, onProgress?: ProgressFn): Promise<Blob> {
    return (await api.process(blob, { output: options }, onProgress)).blob;
  },

  async process(blob: Blob, options: ProcessOptions, onProgress?: ProgressFn): Promise<ProcessResult> {
    const anim = await animationFor(blob, options.output.format, options.output.animation);
    if (anim) {
      const a = await animationFrames(anim.bytes, anim.info, (img) => transform(img, options), onProgress);
      const result = await encodeAnimation(a, anim.info.plays, options.output, onProgress);
      return {
        blob: result,
        width: a.width,
        height: a.height,
        hadTransparency: anim.probe.alpha,
        flattened: false,
        ...animatedInfo(a.frames.length),
      };
    }
    const d = await decode(blob, { keepProfile: keepFor(options.output.format, options.output.colour) });
    const hadTransparency = hasTransparency(d.image);
    const out = await transform(d.image, options);
    const exif = await exifFor(blob, options.output);
    const { blob: result, flattened } = await encode(out, options.output, { icc: d.icc, exif }, false, onProgress);
    return {
      blob: result,
      width: out.width,
      height: out.height,
      hadTransparency,
      flattened,
      ...sourceInfo(d, !!exif),
    };
  },

  /** Several sizes and formats from one decode (favicons, icon sets). Always sRGB. */
  async renditions(blob: Blob, specs: RenditionSpec[]): Promise<{ blob: Blob; width: number; height: number }[]> {
    const { image } = await decode(blob);
    const out: { blob: Blob; width: number; height: number }[] = [];
    for (const s of specs) {
      let img = await resizeTo(image, { width: s.width, height: s.height, fit: s.fit, padColor: s.padColor });
      if (s.background) {
        const copy = img === image ? new ImageData(new Uint8ClampedArray(img.data), img.width, img.height) : img;
        img = flatten(copy, parseColor(s.background));
      }
      out.push({ blob: (await encode(img, s.output, {}, img === image)).blob, width: img.width, height: img.height });
    }
    return out;
  },

  /** Encodes raw sRGB RGBA pixels (from an SVG rendered on the main thread, for example). */
  async encodePixels(image: ImageData, options: EncodeOptions): Promise<Blob> {
    return (await encode(image, options)).blob;
  },

  /**
   * Re-encodes at a quality or towards a target size. `cache` keeps the
   * decoded image for repeated calls on the same file. `proxySide` (live
   * previews) works on a copy scaled to at most that many pixels on the long
   * side: the result looks like the real one at screen size and comes back in
   * a fraction of the time, but its bytes are not the real output's
   * (`proxy: true`; width and height are still the real output's).
   */
  async compress(
    blob: Blob,
    input: CompressOptions,
    { cache: useCache = false, proxySide }: { cache?: boolean; proxySide?: number } = {},
    onProgress?: ProgressFn,
  ): Promise<CompressResult> {
    let options = input;
    const head = probeImage(new Uint8Array(await blob.slice(0, 1 << 20).arrayBuffer()));
    if (options.format === 'keep') {
      const source = head.format;
      const format: CompressFormat =
        source === 'jpeg' || source === 'heic'
          ? 'jpeg'
          : source === 'webp' || source === 'avif'
            ? source
            : source === 'gif' && head.animated
              ? 'gif'
              : 'png';
      options = { ...options, format };
    }
    if (head.animated && !proxySide) {
      const animated = await compressAnimation(blob, options, onProgress);
      if (animated) return animated;
    }
    const keepProfile = options.colour !== 'srgb' && options.format !== 'avif';
    const d = await decode(blob, { keepProfile, useCache });
    let image = d.image;
    let size = { width: image.width, height: image.height };
    if (options.maxSide && Math.max(image.width, image.height) > options.maxSide) {
      const s = options.maxSide / Math.max(image.width, image.height);
      size = { width: Math.max(1, Math.round(image.width * s)), height: Math.max(1, Math.round(image.height * s)) };
    }
    if (proxySide && Math.max(size.width, size.height) > proxySide) {
      image = await proxyOf(d, proxySide, useCache);
    } else if (size.width !== image.width || size.height !== image.height) {
      image = await resizeLanczos(image, size.width, size.height);
    }
    const shared = image === d.image || image === proxy?.image;
    const hadTransparency = hasTransparency(image);
    const info = { ...sourceInfo(d), ...size, hadTransparency, proxy: image.width !== size.width };

    if (options.format !== 'auto' && options.format !== 'keep') {
      return { ...(await compressPixels(image, options.format, options, d.icc, shared)), ...info };
    }
    if (options.targetBytes) return { ...(await compressPixels(image, 'webp', options, d.icc, shared)), ...info };
    // Lossless sources (screenshots, graphics) often stay smallest as PNG.
    const lossless = ['png', 'gif', 'bmp'].includes(d.probe.format);
    const candidates: CompressFormat[] = hadTransparency ? ['webp', 'png'] : lossless ? ['jpeg', 'webp', 'png'] : ['jpeg', 'webp'];
    let best: Awaited<ReturnType<typeof compressPixels>> | null = null;
    for (const f of candidates) {
      const r = await compressPixels(image, f, options, d.icc, shared);
      if (!best || r.blob.size < best.blob.size) best = r;
    }
    if (!best) throw new Error('Compression failed.');
    return { ...best, ...info };
  },

  /** Drops the cached decode and proxy (call when a preview session ends). */
  async release(): Promise<void> {
    cache = null;
    proxy = null;
  },

  /**
   * A small rendering for on-screen previews (HEIC and other formats the
   * page cannot show). Returns the full displayed size too.
   */
  async preview(blob: Blob, maxSide: number): Promise<{ blob: Blob; width: number; height: number; transparent: boolean }> {
    const { image } = await decode(blob, { useCache: true });
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    const transparent = hasTransparency(image);
    // Canvas scaling is plenty for a preview and much faster than Lanczos.
    const src = offscreen(image.width, image.height);
    src.getContext('2d')?.putImageData(image, 0, 0);
    const dst = offscreen(w, h);
    const ctx = dst.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available in this browser.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    src.width = 0;
    src.height = 0;
    const out = await dst.convertToBlob(transparent ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 });
    return { blob: out, width: image.width, height: image.height, transparent };
  },

  async readMetadata(blob: Blob) {
    return readMetadata(new Uint8Array(await blob.arrayBuffer()));
  },

  async stripMetadata(blob: Blob, options: { keepIcc?: boolean } = {}) {
    const input = new Uint8Array(await blob.arrayBuffer());
    const { bytes, removed, keptOrientation } = stripMetadata(input, options);
    // Windows often gives HEIC files no MIME type; name it from the bytes.
    const format = probeImage(input).format;
    const type = blob.type || (format === 'heic' ? 'image/heic' : format === 'avif' ? 'image/avif' : `image/${format}`);
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), removed, keptOrientation };
  },

};

export type ImageWorkerApi = typeof api;

expose(api);
