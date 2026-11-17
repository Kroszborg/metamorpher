/**
 * SVG rasterising on the main thread (workers cannot decode SVG). The SVG is
 * parsed, stripped of everything that could reach the network, sized, and
 * drawn through an <img> (where browsers also block external loads and never
 * run scripts) onto a canvas.
 */

export type SvgInfo = {
  /** Intrinsic size in CSS pixels. */
  width: number;
  height: number;
  /** The size came from neither width/height nor viewBox (browser default 300 × 150). */
  guessed: boolean;
};

export type Prepared = SvgInfo & {
  doc: Document;
  root: SVGSVGElement;
  /** External references (links, images, fonts, stylesheets) that were removed. */
  removed: number;
  /** HTML islands (foreignObject) that were removed; they would block reading the canvas. */
  html: number;
};

const UNIT: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, rem: 16 };

function length(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([0-9.]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$/i.exec(v);
  if (!m?.[1]) return null;
  const k = UNIT[(m[2] ?? '').toLowerCase()];
  const n = Number(m[1]) * (k ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** References that stay inside the file: fragments and data: URIs. */
const isLocal = (url: string) => /^\s*(#|data:)/i.test(url);

/** Removes url(...) and @import that point outside the file, from CSS text. Returns [css, count]. */
function localCss(css: string): [string, number] {
  let n = 0;
  const out = css
    .replace(/@import\s+(url\()?\s*['"]?[^'")\s;]+['"]?\s*\)?[^;]*;?/gi, () => {
      n += 1;
      return '';
    })
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (all: string, _q: string, url: string) => {
      if (isLocal(url)) return all;
      n += 1;
      return 'none';
    });
  return [out, n];
}

/** Parses an SVG and removes scripts, event handlers and every external reference. */
export function prepareSvg(text: string): Prepared {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root.localName !== 'svg') {
    throw new Error('This file is not a valid SVG image.');
  }
  const svg = root as unknown as SVGSVGElement;
  let removed = 0;
  let html = 0;
  for (const el of Array.from(doc.querySelectorAll('script, foreignObject'))) {
    el.remove();
    if (el.localName !== 'script') html += 1;
  }
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'xlink:href' || name === 'src') && !isLocal(attr.value)) {
        el.removeAttributeNode(attr);
        removed += 1;
      } else if (name === 'style' || /url\(/i.test(attr.value)) {
        const [css, n] = localCss(attr.value);
        if (n) {
          el.setAttribute(attr.name, css);
          removed += n;
        }
      }
    }
    if (el.localName === 'style') {
      const [css, n] = localCss(el.textContent ?? '');
      if (n) {
        el.textContent = css;
        removed += n;
      }
    }
  }

  let width = length(svg.getAttribute('width'));
  let height = length(svg.getAttribute('height'));
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const vbw = vb.length === 4 && (vb[2] ?? 0) > 0 ? (vb[2] as number) : null;
  const vbh = vb.length === 4 && (vb[3] ?? 0) > 0 ? (vb[3] as number) : null;
  let guessed = false;
  if (!width && !height) {
    if (vbw && vbh) {
      width = vbw;
      height = vbh;
    } else {
      width = 300;
      height = 150;
      guessed = true;
    }
  } else if (!width) {
    width = vbw && vbh && height ? (height * vbw) / vbh : (height ?? 150) * 2;
  } else if (!height) {
    height = vbw && vbh ? (width * vbh) / vbw : width / 2;
  }
  // Without a viewBox the drawing would not scale with the new size.
  if (!vbw || !vbh) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  return { doc, root: svg, width: width ?? 300, height: height ?? 150, guessed, removed, html };
}

/** Renders a prepared SVG at exactly `width`×`height` pixels. */
export async function rasterise(
  p: Prepared,
  width: number,
  height: number,
  background: string | null,
  signal: AbortSignal,
): Promise<ImageData> {
  p.root.setAttribute('width', String(width));
  p.root.setAttribute('height', String(height));
  const markup = new XMLSerializer().serializeToString(p.doc);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = new Image(width, height);
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('This browser could not draw this SVG.');
    }
    if (signal.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas is not available in this browser.');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    canvas.width = 0;
    canvas.height = 0;
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
