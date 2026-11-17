/**
 * WebAssembly codecs (Squoosh builds via @jsquash, and libheif via heic-to),
 * served from this origin under /vendor and imported at runtime inside the
 * image worker. Like the ffmpeg wrapper, they are not bundled: their
 * Emscripten/wasm-bindgen glue resolves the .wasm next to itself through
 * import.meta.url, and the AVIF/oxipng packages also reach for
 * multi-threaded builds that need SharedArrayBuffer. Only the single-thread
 * builds are copied and used here. Each codec loads on first use.
 *
 * Worker-only: uses `self.location`.
 */

type EmscriptenFactory<M> = (options: Record<string, unknown>) => Promise<M>;

type MozjpegOptions = {
  quality: number;
  baseline: boolean;
  arithmetic: boolean;
  progressive: boolean;
  optimize_coding: boolean;
  smoothing: number;
  color_space: number;
  quant_table: number;
  trellis_multipass: boolean;
  trellis_opt_zero: boolean;
  trellis_opt_table: boolean;
  trellis_loops: number;
  auto_subsample: boolean;
  chroma_subsample: number;
  separate_chroma_quality: boolean;
  chroma_quality: number;
};
type MozjpegModule = { encode(data: BufferSource, w: number, h: number, o: MozjpegOptions): Uint8Array };

type WebpOptions = Record<string, number>;
type WebpModule = { encode(data: BufferSource, w: number, h: number, o: WebpOptions): Uint8Array | null };

type AvifOptions = {
  quality: number;
  qualityAlpha: number;
  denoiseLevel: number;
  tileColsLog2: number;
  tileRowsLog2: number;
  speed: number;
  subsample: number;
  chromaDeltaQ: boolean;
  sharpness: number;
  tune: number;
  enableSharpYUV: boolean;
  bitDepth: number;
};
type AvifModule = { encode(data: BufferSource, w: number, h: number, o: AvifOptions): Uint8Array | null };

type OxipngModule = {
  default: (input?: string | URL) => Promise<unknown>;
  optimise_raw: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    level: number,
    interlace: boolean,
    optimiseAlpha: boolean,
  ) => Uint8Array;
};
type ResizeModule = {
  default: (input?: string | URL) => Promise<unknown>;
  resize: (
    input: Uint8Array,
    iw: number,
    ih: number,
    ow: number,
    oh: number,
    method: number,
    premultiply: boolean,
    linearRGB: boolean,
  ) => Uint8ClampedArray;
};
type HeicToModule = {
  heicTo: (args: { blob: Blob; type: 'bitmap'; options?: ImageBitmapOptions }) => Promise<ImageBitmap>;
};

/** Absolute URL of a vendored runtime file. */
export function vendorUrl(path: string): string {
  return new URL(`/vendor/${path}`, self.location.origin).href;
}

function importVendor<T>(path: string): Promise<T> {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ vendorUrl(path)) as Promise<T>;
}

/** Memoises a loader; a failed load is retried on the next call. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= load().catch((err: unknown) => {
      p = null;
      throw new Error(`Could not load the image codec: ${err instanceof Error ? err.message : String(err)}`);
    });
    return p;
  };
}

async function emscripten<M>(dir: string, file: string): Promise<M> {
  const mod = await importVendor<{ default: EmscriptenFactory<M> }>(`jsquash/${dir}/${file}.js`);
  return mod.default({ noInitialRun: true, locateFile: (name: string) => vendorUrl(`jsquash/${dir}/${name}`) });
}

/** WebAssembly SIMD (feature test from wasm-feature-detect). */
const hasSimd = () =>
  WebAssembly.validate(
    new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
  );

const mozjpeg = lazy(() => emscripten<MozjpegModule>('jpeg', 'mozjpeg_enc'));
const webp = lazy(() => (hasSimd() ? emscripten<WebpModule>('webp', 'webp_enc_simd') : emscripten<WebpModule>('webp', 'webp_enc')));
const avif = lazy(() => emscripten<AvifModule>('avif', 'avif_enc'));
const oxipng = lazy(async () => {
  const mod = await importVendor<OxipngModule>('jsquash/oxipng/squoosh_oxipng.js');
  await mod.default(vendorUrl('jsquash/oxipng/squoosh_oxipng_bg.wasm'));
  return mod;
});
const resizer = lazy(async () => {
  const mod = await importVendor<ResizeModule>('jsquash/resize/squoosh_resize.js');
  await mod.default(vendorUrl('jsquash/resize/squoosh_resize_bg.wasm'));
  return mod;
});
const heicTo = lazy(() => importVendor<HeicToModule>('heic-to/heic-to.js'));

const clampInt = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

/** MozJPEG, progressive with optimised Huffman tables (Squoosh defaults). */
export async function encodeJpeg(img: ImageData, quality: number): Promise<Uint8Array> {
  const m = await mozjpeg();
  return m.encode(img.data, img.width, img.height, {
    quality: clampInt(quality * 100, 0, 100),
    baseline: false,
    arithmetic: false,
    progressive: true,
    optimize_coding: true,
    smoothing: 0,
    color_space: 3,
    quant_table: 3,
    trellis_multipass: false,
    trellis_opt_zero: false,
    trellis_opt_table: false,
    trellis_loops: 1,
    auto_subsample: true,
    chroma_subsample: 2,
    separate_chroma_quality: false,
    chroma_quality: 75,
  });
}

/** libwebp. Lossless when asked; alpha is kept losslessly in lossy mode. */
export async function encodeWebp(img: ImageData, quality: number, lossless = false): Promise<Uint8Array> {
  if (img.width > 16383 || img.height > 16383) {
    throw new Error('WebP images can be at most 16383 pixels wide or high. Resize first or choose another format.');
  }
  const m = await webp();
  const out = m.encode(img.data, img.width, img.height, {
    quality: lossless ? 100 : clampInt(quality * 100, 0, 100),
    target_size: 0,
    target_PSNR: 0,
    method: 4,
    sns_strength: 50,
    filter_strength: 60,
    filter_sharpness: 0,
    filter_type: 1,
    partitions: 0,
    segments: 4,
    pass: 1,
    show_compressed: 0,
    preprocessing: 0,
    autofilter: 0,
    partition_limit: 0,
    alpha_compression: 1,
    alpha_filtering: 1,
    alpha_quality: 100,
    lossless: lossless ? 1 : 0,
    exact: 0,
    image_hint: 0,
    emulate_jpeg_size: 0,
    thread_level: 0,
    low_memory: 0,
    near_lossless: 100,
    use_delta_palette: 0,
    use_sharp_yuv: 0,
  });
  if (!out) throw new Error('The WebP encoder failed.');
  return out;
}

/** libavif (aom), single-threaded. Faster settings for large images keep encode time bounded. */
export async function encodeAvif(img: ImageData, quality: number, lossless = false): Promise<Uint8Array> {
  const m = await avif();
  const pixels = img.width * img.height;
  const speed = pixels > 16e6 ? 9 : pixels > 4e6 ? 8 : 6;
  const out = m.encode(img.data, img.width, img.height, {
    quality: lossless ? 100 : clampInt(quality * 100, 0, 100),
    qualityAlpha: lossless ? 100 : -1,
    denoiseLevel: 0,
    tileColsLog2: pixels > 4e6 ? 1 : 0,
    tileRowsLog2: pixels > 16e6 ? 1 : 0,
    speed,
    subsample: lossless ? 3 : 1,
    chromaDeltaQ: false,
    sharpness: 0,
    tune: 0,
    enableSharpYUV: false,
    bitDepth: 8,
  });
  if (!out) throw new Error('The AVIF encoder failed.');
  return out;
}

/** Lossless PNG straight from RGBA via oxipng (picks bit depth, palette and filters). */
export async function encodePng(img: ImageData): Promise<Uint8Array> {
  const m = await oxipng();
  const pixels = img.width * img.height;
  // Level 2 is oxipng's default; huge images use level 1 to keep time reasonable.
  return m.optimise_raw(img.data, img.width, img.height, pixels > 12e6 ? 1 : 2, false, true);
}

/** Lanczos3 resampling in linear light with premultiplied alpha. */
export async function resizeLanczos(img: ImageData, width: number, height: number): Promise<ImageData> {
  if (width === img.width && height === img.height) return img;
  const m = await resizer();
  const data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const out = m.resize(data, img.width, img.height, width, height, 3, true, true);
  const pixels = new Uint8ClampedArray(out.buffer as ArrayBuffer, out.byteOffset, out.byteLength);
  return new ImageData(pixels, width, height);
}

/** HEIC/HEIF primary image via libheif (heic-to). Rotation/mirroring from the file is applied. */
export async function decodeHeic(blob: Blob): Promise<ImageBitmap> {
  const { heicTo: decode } = await heicTo();
  try {
    return await decode({ blob, type: 'bitmap', options: { premultiplyAlpha: 'none' } });
  } catch (err) {
    throw new Error(`Could not decode this HEIC image${typeof err === 'string' && err ? `: ${err}` : '.'}`);
  }
}
