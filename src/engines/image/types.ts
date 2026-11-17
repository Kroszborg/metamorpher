/**
 * Formats the image engine writes. JPEG, WebP and AVIF use WebAssembly
 * encoders (MozJPEG, libwebp, libavif), PNG a fast TypeScript writer or
 * oxipng, GIF gifenc, and BMP and ICO the engine's own encoders, so every
 * format works in every browser and nothing depends on the canvas. GIF, WebP
 * and PNG (APNG) keep animation. (The name is historical: the first version
 * encoded with the canvas.)
 */
export type CanvasFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'bmp' | 'ico';
export type OutputFormat = CanvasFormat;

export type EncodeOptions = {
  format: CanvasFormat;
  /** Lossy quality for JPEG, WebP and AVIF, 0–1. Default 0.8. */
  quality?: number;
  /** Fill colour behind transparent pixels for formats without alpha (JPEG, BMP). Default white. */
  background?: string;
  /** WebP/AVIF only: encode losslessly (quality is ignored). */
  lossless?: boolean;
  /**
   * keep (default): a non-sRGB RGB profile (Display P3, Adobe RGB) stays with
   * the pixels when the output can carry it (JPEG, PNG, WebP); AVIF, BMP and
   * ICO are converted to sRGB. srgb: always convert to sRGB.
   */
  colour?: 'keep' | 'srgb';
  /**
   * JPEG output only: copy the source's EXIF (orientation reset, thumbnail
   * dropped). 'keep-no-gps' empties the GPS block. Default: no metadata.
   */
  exif?: 'drop' | 'keep' | 'keep-no-gps';
  /**
   * Animated GIF, WebP and APNG sources: 'keep' (default) writes every frame
   * with its timing when the output is GIF, WebP or PNG; other outputs, or
   * 'first-frame', use the first frame only.
   */
  animation?: 'keep' | 'first-frame';
  /** GIF only: colours per frame, 2–256. Default 256. */
  colours?: number;
  /**
   * PNG only. fast: a quick lossless writer (seconds even for 50
   * megapixels). smallest: oxipng, a few percent smaller and much slower on
   * photos (it can take minutes above 20 megapixels). Default: smallest up
   * to 512×512 pixels, fast above.
   */
  effort?: 'fast' | 'smallest';
};

/** Reports how far an engine call is (0–1), with an optional note ("Frame 3 of 40"). */
export type ProgressFn = (fraction: number, note?: string) => void;

/** How colour was handled; see `decode.ts`. */
export type ColourHandling = 'srgb' | 'kept' | 'converted';

/** What happened to the source on the way, for the UI. */
export type SourceInfo = {
  colour: ColourHandling;
  /** The source's non-sRGB profile ("Display P3"), if any. */
  profile?: string;
  /** The source was animated (GIF, WebP, APNG, AVIF/HEIF sequence). */
  animated: boolean;
  /** Frames in the animated source, when known. */
  frames?: number;
  /** Every frame was kept (the output is animated); false means only the first frame was used. */
  animationKept?: boolean;
  /** The source's animation could be kept by choosing GIF, WebP or PNG (GIF/WebP/APNG sources; not AVIF or HEIF sequences). */
  animationKeepable?: boolean;
  /** EXIF was copied into the output. */
  exifCopied: boolean;
};

export type CropRect = { x: number; y: number; width: number; height: number };

export type ResizeSpec = {
  width: number;
  height: number;
  /**
   * stretch: exactly width×height. cover: fill the box, cropping the overflow
   * (centred). contain: fit inside the box and pad (transparent, or
   * `padColor`) to exactly width×height.
   */
  fit?: 'stretch' | 'cover' | 'contain';
  padColor?: string;
};

/**
 * One pass over an image, in this order: decode (EXIF/HEIF orientation
 * applied) → rotate → flip → crop → resize → encode.
 */
export type ProcessOptions = {
  /** Clockwise quarter turns, in degrees. */
  rotate?: 0 | 90 | 180 | 270;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  /** In pixels of the rotated/flipped image. */
  crop?: CropRect;
  resize?: ResizeSpec;
  output: EncodeOptions;
};

export type ProcessResult = {
  blob: Blob;
  width: number;
  height: number;
  /** The decoded image had transparent pixels. */
  hadTransparency: boolean;
  /** Transparent pixels were composited onto the background (format without alpha). */
  flattened: boolean;
} & SourceInfo;

/** GIF only as the result of 'keep' or 'auto' for an animated GIF. */
export type CompressFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif';

export type CompressOptions = {
  /**
   * 'auto' tries JPEG and WebP (PNG and WebP for transparent images) and keeps
   * the smaller. 'keep' writes the source's format: JPEG, WebP and AVIF stay,
   * HEIC becomes JPEG and everything else PNG. Animated GIF, WebP and APNG
   * stay animated with 'keep' (GIF stays GIF), 'auto' (animated WebP or GIF,
   * whichever is smaller), 'webp' and 'png'.
   */
  format: CompressFormat | 'auto' | 'keep';
  /** 0–1. Ignored for PNG and when `targetBytes` is set. For GIF it sets the colours per frame. */
  quality?: number;
  /** Search for the highest quality whose output is at most this many bytes (lossy formats). */
  targetBytes?: number;
  background?: string;
  colour?: 'keep' | 'srgb';
  /** Scale down so the longer side is at most this many pixels (Lanczos3). */
  maxSide?: number;
  /** PNG: see `EncodeOptions.effort`. Default: smallest up to 4 megapixels, fast above. */
  effort?: 'fast' | 'smallest';
};

export type CompressResult = {
  blob: Blob;
  format: CompressFormat;
  /** Quality used (lossy formats). */
  quality?: number;
  width: number;
  height: number;
  /** With `targetBytes`: false when even the lowest quality was larger. */
  reachedTarget?: boolean;
  hadTransparency: boolean;
  flattened: boolean;
  /** A preview made from a scaled-down copy (see `compress`): its bytes are not the real output's. */
  proxy?: boolean;
} & SourceInfo;

/** One output of `renditions`: the same source at another size and format. */
export type RenditionSpec = {
  width: number;
  height: number;
  fit: 'contain' | 'cover' | 'stretch';
  output: EncodeOptions;
  /** Fill for the padding of 'contain' (transparent when omitted). */
  padColor?: string;
  /** Composite the whole result onto this colour (an opaque icon). */
  background?: string;
};
