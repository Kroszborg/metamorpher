/**
 * Largest image the engine decodes: 100 megapixels (400 MB of RGBA).
 *
 * Measured in Chrome (peak private memory of the tab's renderer, which holds
 * the image worker): a 12 MP JPEG → JPEG used 529 MB and a 48 MP one 1.9 GB,
 * about 38 bytes per pixel (decoded bitmap, canvas read-back, the RGBA copy
 * and MozJPEG's WebAssembly heap with the whole-image coefficients); 48 MP →
 * PNG used 1.1 GB. At 100 MP that is about 4 GB, which is where a browser tab
 * and the 32-bit WebAssembly encoders (4 GB address space each) stop being
 * reliable on ordinary machines, so the limit stays here. Larger images need
 * tiled processing.
 */
export const MAX_PIXELS = 100_000_000;

/**
 * Animations keep every frame in memory between decoding and encoding: at
 * most this many pixels across all frames (800 MB of RGBA), e.g. 400 frames
 * of 1000×500.
 */
export const MAX_ANIMATION_PIXELS = 200_000_000;

/** Marker the convert tool uses to fall back to ffmpeg; see `isDecodeError`. */
export const DECODE_FAILED = 'IMAGE_DECODE_FAILED';
