// gifenc 1.0.3 ships without type declarations; these cover the parts the media worker uses.
declare module 'gifenc' {
  export type GifPalette = number[][];
  export type GifColorFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: GifColorFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifColorFormat,
  ): Uint8Array;

  export type GifStream = {
    reset(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  };

  export type GifEncoderInstance = {
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: GifPalette;
        first?: boolean;
        transparent?: boolean;
        transparentIndex?: number;
        delay?: number;
        repeat?: number;
        dispose?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
    readonly stream: GifStream;
  };

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
}
