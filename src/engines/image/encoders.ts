/** Encoders for formats the canvas cannot write itself. Pure functions over pixels/bytes. */

/** 24-bit BMP. Transparent pixels are composited over white. */
export function encodeBmp(image: ImageData): Uint8Array {
  const { width, height, data } = image;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const out = new Uint8Array(54 + pixelBytes);
  const view = new DataView(out.buffer);
  // BITMAPFILEHEADER
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: rows stored bottom-up
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true); // 72 dpi
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y += 1) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const a = (data[i + 3] ?? 255) / 255;
      const o = row + x * 3;
      out[o] = Math.round((data[i + 2] ?? 0) * a + 255 * (1 - a));
      out[o + 1] = Math.round((data[i + 1] ?? 0) * a + 255 * (1 - a));
      out[o + 2] = Math.round((data[i] ?? 0) * a + 255 * (1 - a));
    }
  }
  return out;
}

/** A single-image ICO wrapping a PNG of at most 256×256. */
export function encodeIco(png: Uint8Array, width: number, height: number): Uint8Array {
  return encodeIcoMulti([{ png, width, height }]);
}

/**
 * A multi-size ICO. Every entry is stored as PNG (supported by Windows Vista
 * and later and by every browser); entries must be at most 256×256 and should
 * be listed from small to large.
 */
export function encodeIcoMulti(images: readonly { png: Uint8Array; width: number; height: number }[]): Uint8Array {
  const header = 6 + 16 * images.length;
  const out = new Uint8Array(header + images.reduce((n, i) => n + i.png.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach(({ png, width, height }, i) => {
    if (width > 256 || height > 256) throw new Error('ICO images can be at most 256×256 pixels.');
    const e = 6 + i * 16;
    out[e] = width >= 256 ? 0 : width;
    out[e + 1] = height >= 256 ? 0 : height;
    view.setUint16(e + 4, 1, true); // colour planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, png.length, true);
    view.setUint32(e + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}
