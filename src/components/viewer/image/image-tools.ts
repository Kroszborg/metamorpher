/** Pure helpers for the image viewer: histograms, colour formats, GPS. */

export type Histogram = { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; max: number; pixels: number; alpha: boolean };

export function histogram(data: Uint8ClampedArray): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  let alpha = false;
  let pixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 255) alpha = true;
    if (a === 0) continue;
    const R = data[i]!;
    const G = data[i + 1]!;
    const B = data[i + 2]!;
    r[R]!++;
    g[G]!++;
    b[B]!++;
    l[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]!++;
    pixels++;
  }
  // Scale to the 99.5th percentile bin so one spike does not flatten the rest.
  const all = [...r, ...g, ...b].sort((x, y) => x - y);
  const max = Math.max(1, all[Math.floor(all.length * 0.995)] ?? 1);
  return { r, g, b, l, max, pixels, alpha };
}

/** An SVG path (area) for one channel in a 256 × 100 box. */
export function areaPath(bins: Uint32Array, max: number): string {
  let d = 'M0,100';
  for (let i = 0; i < 256; i++) d += ` L${i},${(100 - Math.min(1, bins[i]! / max) * 100).toFixed(1)}`;
  return `${d} L255,100 Z`;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function colourFormats(r: number, g: number, b: number, a: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    h *= 60;
  }
  const alpha = a < 255 ? hex2(a) : '';
  return {
    hex: `#${hex2(r)}${hex2(g)}${hex2(b)}${alpha}`.toUpperCase(),
    rgb: a < 255 ? `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})` : `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
  };
}

export function dms(value: number, pos: string, neg: string): string {
  const v = Math.abs(value);
  const d = Math.floor(v);
  const mFloat = (v - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${d}° ${m}′ ${s.toFixed(2)}″ ${value >= 0 ? pos : neg}`;
}
