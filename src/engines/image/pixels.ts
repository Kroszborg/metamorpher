/** Exact pixel operations on RGBA ImageData: quarter turns, flips, crops, flattening. */

export type Rgb = [number, number, number];

/**
 * A worker canvas. Reading pixels in the image worker needs OffscreenCanvas
 * (Safari 16.4+, every current Chrome, Edge and Firefox); without it the
 * error says so instead of "Can't find variable: OffscreenCanvas".
 */
export function offscreen(width: number, height: number): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error(
      'This browser cannot process images in the background (it has no OffscreenCanvas). Use Safari 16.4 or later, or a current Chrome, Edge or Firefox.',
    );
  }
  return new OffscreenCanvas(width, height);
}

function make(width: number, height: number): ImageData {
  return new ImageData(width, height);
}

const u32 = (img: ImageData) => new Uint32Array(img.data.buffer, img.data.byteOffset, img.width * img.height);

/** Rotates clockwise by 90, 180 or 270 degrees. */
export function rotate(img: ImageData, degrees: number): ImageData {
  const turn = (((degrees % 360) + 360) % 360) / 90;
  if (turn === 0) return img;
  const { width: w, height: h } = img;
  const src = u32(img);
  if (turn === 2) {
    const out = make(w, h);
    const dst = u32(out);
    for (let i = 0, n = w * h; i < n; i += 1) dst[n - 1 - i] = src[i] ?? 0;
    return out;
  }
  const out = make(h, w);
  const dst = u32(out);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = src[y * w + x] ?? 0;
      // 90° CW: (x, y) → (h-1-y, x). 270° CW: (x, y) → (y, w-1-x).
      if (turn === 1) dst[x * h + (h - 1 - y)] = v;
      else dst[(w - 1 - x) * h + y] = v;
    }
  }
  return out;
}

export function flip(img: ImageData, horizontal: boolean, vertical: boolean): ImageData {
  if (!horizontal && !vertical) return img;
  const { width: w, height: h } = img;
  const src = u32(img);
  const out = make(w, h);
  const dst = u32(out);
  for (let y = 0; y < h; y += 1) {
    const sy = vertical ? h - 1 - y : y;
    for (let x = 0; x < w; x += 1) {
      dst[y * w + x] = src[sy * w + (horizontal ? w - 1 - x : x)] ?? 0;
    }
  }
  return out;
}

export type Rect = { x: number; y: number; width: number; height: number };

/** Clamps a rectangle to the image and rounds it to whole pixels (at least 1×1). */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.min(width - 1, Math.max(0, Math.round(r.x)));
  const y = Math.min(height - 1, Math.max(0, Math.round(r.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(r.width))),
    height: Math.max(1, Math.min(height - y, Math.round(r.height))),
  };
}

export function crop(img: ImageData, rect: Rect): ImageData {
  const r = clampRect(rect, img.width, img.height);
  if (r.x === 0 && r.y === 0 && r.width === img.width && r.height === img.height) return img;
  const src = u32(img);
  const out = make(r.width, r.height);
  const dst = u32(out);
  for (let y = 0; y < r.height; y += 1) {
    const start = (r.y + y) * img.width + r.x;
    dst.set(src.subarray(start, start + r.width), y * r.width);
  }
  return out;
}

export function hasTransparency(img: ImageData): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 255) < 255) return true;
  return false;
}

/** Composites every pixel over a solid colour (in place) and makes it opaque. */
export function flatten(img: ImageData, [r, g, b]: Rgb): ImageData {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] ?? 255;
    if (a === 255) continue;
    const k = a / 255;
    d[i] = (d[i] ?? 0) * k + r * (1 - k);
    d[i + 1] = (d[i + 1] ?? 0) * k + g * (1 - k);
    d[i + 2] = (d[i + 2] ?? 0) * k + b * (1 - k);
    d[i + 3] = 255;
  }
  return img;
}

/** Places an image centred on a larger canvas (transparent or filled). */
export function pad(img: ImageData, width: number, height: number, fill?: Rgb): ImageData {
  const out = make(width, height);
  const dst = u32(out);
  if (fill) {
    const px = new Uint8ClampedArray([fill[0], fill[1], fill[2], 255]);
    dst.fill(new Uint32Array(px.buffer)[0] ?? 0);
  }
  const ox = Math.floor((width - img.width) / 2);
  const oy = Math.floor((height - img.height) / 2);
  const src = u32(img);
  for (let y = 0; y < img.height; y += 1) {
    dst.set(src.subarray(y * img.width, (y + 1) * img.width), (oy + y) * width + ox);
  }
  if (fill) flatten(out, fill);
  return out;
}

/** "#rgb", "#rrggbb" or any CSS colour the 2D canvas understands → RGB. */
export function parseColor(css: string): Rgb {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const ctx = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (!ctx) return [255, 255, 255];
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 255, d[1] ?? 255, d[2] ?? 255];
}
