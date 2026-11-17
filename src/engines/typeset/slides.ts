// Worker-only: draws a presentation (the model from src/components/doc-tools/pptx.ts)
// into a PDF. Shapes, lines and pictures go straight to MuPDF's device;
// every text box is laid out on its own by MuPDF's HTML engine (fonts,
// HarfBuzz shaping, bidi, line breaking), measured, and placed in its box
// with the box's anchor, insets, rotation and shrink-to-fit.
import type * as M from 'mupdf';
import { FontSet, installFontSet } from './fonts';
import { wrapSymbolRuns } from './html';
import { type Clusters, collectClusters, fixToUnicode, needsClusters } from './tounicode';
import type { PathCmd, ProgressFn, SlideBox, SlideColor, SlideFill, SlideItem, SlideLine, SlidesRequest, SlideText } from './types';

type Mupdf = typeof M;

const encoder = new TextEncoder();
const SLIDE_CSS = '@page{margin:0}html,body{margin:0;padding:0;color:#000;white-space:pre-wrap}div{margin:0}';
const NOWRAP_CSS = '@page{margin:0}html,body{margin:0;padding:0;color:#000;white-space:pre}div{margin:0}';
const TALL = 20000;

type Laid = { doc: M.Document; page: M.Page; height: number; width: number };

class SlideDrawer {
  #images = new Map<number, M.Image | M.Document | null>();
  broken = 0;
  clusters: Clusters | undefined;

  constructor(
    private m: Mupdf,
    private req: SlidesRequest,
    private fonts: FontSet,
  ) {}

  // Geometry ------------------------------------------------------------------
  boxMatrix(b: SlideBox, flip = true): M.Matrix {
    const { Matrix } = this.m;
    let mat = Matrix.translate(-b.w / 2, -b.h / 2);
    if (flip && (b.flipH || b.flipV)) mat = Matrix.concat(mat, Matrix.scale(b.flipH ? -1 : 1, b.flipV ? -1 : 1));
    if (b.rot) mat = Matrix.concat(mat, Matrix.rotate(b.rot));
    return Matrix.concat(mat, Matrix.translate(b.x + b.w / 2, b.y + b.h / 2));
  }

  path(cmds: PathCmd[]): M.Path {
    const p = new this.m.Path();
    for (const c of cmds) {
      if (c[0] === 'M') p.moveTo(c[1], c[2]);
      else if (c[0] === 'L') p.lineTo(c[1], c[2]);
      else if (c[0] === 'C') p.curveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
      else p.closePath();
    }
    return p;
  }

  rectPath(x: number, y: number, w: number, h: number): M.Path {
    const p = new this.m.Path();
    p.rect(x, y, x + w, y + h);
    return p;
  }

  // Fills ---------------------------------------------------------------------
  fill(dev: M.Device, cmds: PathCmd[] | null, b: SlideBox, ctm: M.Matrix, fill: SlideFill): void {
    const { m } = this;
    const shape = cmds ? this.path(cmds) : this.rectPath(0, 0, b.w, b.h);
    try {
      if (fill.kind === 'solid') {
        if (fill.color.alpha > 0) dev.fillPath(shape, false, ctm, m.ColorSpace.DeviceRGB, fill.color.rgb, fill.color.alpha);
        return;
      }
      if (fill.kind === 'image') {
        dev.clipPath(shape, false, ctm);
        const [rl, rt, rr, rb] = fill.rect ?? [0, 0, 0, 0];
        this.drawImage(dev, fill.image, m.Matrix.concat([b.w * (1 - rl - rr), 0, 0, b.h * (1 - rt - rb), b.w * rl, b.h * rt], ctm), fill.alpha);
        dev.popClip();
        return;
      }
      dev.clipPath(shape, false, ctm);
      const stops = fill.stops;
      const at = (t: number): SlideColor => {
        if (t <= (stops[0] as { pos: number }).pos) return (stops[0] as { color: SlideColor }).color;
        for (let i = 1; i < stops.length; i++) {
          const s0 = stops[i - 1] as { pos: number; color: SlideColor };
          const s1 = stops[i] as { pos: number; color: SlideColor };
          if (t <= s1.pos) {
            const f = s1.pos > s0.pos ? (t - s0.pos) / (s1.pos - s0.pos) : 0;
            return { rgb: s0.color.rgb.map((v, k) => v + ((s1.color.rgb[k] as number) - v) * f) as [number, number, number], alpha: s0.color.alpha + (s1.color.alpha - s0.color.alpha) * f };
          }
        }
        return (stops[stops.length - 1] as { color: SlideColor }).color;
      };
      const N = 64;
      if (fill.radial) {
        // Concentric ellipses from the outside in; position 0 is the centre.
        const r = Math.hypot(b.w, b.h) / 2;
        for (let i = N; i >= 1; i--) {
          const f = i / N;
          const c = at(f);
          const p = new m.Path();
          const rx = (r * f * b.w) / Math.max(b.w, b.h);
          const ry = (r * f * b.h) / Math.max(b.w, b.h);
          const k = 0.5522847498;
          const cx = b.w / 2;
          const cy = b.h / 2;
          p.moveTo(cx + rx, cy);
          p.curveTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
          p.curveTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
          p.curveTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
          p.curveTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
          p.closePath();
          dev.fillPath(p, false, ctm, m.ColorSpace.DeviceRGB, c.rgb, c.alpha);
          p.destroy();
        }
      } else {
        const a = (fill.angle * Math.PI) / 180;
        const d = [Math.cos(a), Math.sin(a)];
        const n = [-Math.sin(a), Math.cos(a)];
        const cx = b.w / 2;
        const cy = b.h / 2;
        const ext = Math.abs(d[0] as number) * b.w / 2 + Math.abs(d[1] as number) * b.h / 2;
        const L = Math.hypot(b.w, b.h);
        for (let i = 0; i < N; i++) {
          const t0 = -ext + (2 * ext * i) / N;
          const t1 = -ext + (2 * ext * (i + 1)) / N + (i < N - 1 ? 0.5 : 0);
          const c = at((i + 0.5) / N);
          const p = new m.Path();
          const pt = (t: number, s: number) => [cx + (d[0] as number) * t + (n[0] as number) * s, cy + (d[1] as number) * t + (n[1] as number) * s] as const;
          p.moveTo(...pt(i === 0 ? t0 - 1 : t0, L));
          p.lineTo(...pt(i === N - 1 ? t1 + 1 : t1, L));
          p.lineTo(...pt(i === N - 1 ? t1 + 1 : t1, -L));
          p.lineTo(...pt(i === 0 ? t0 - 1 : t0, -L));
          p.closePath();
          dev.fillPath(p, false, ctm, m.ColorSpace.DeviceRGB, c.rgb, c.alpha);
          p.destroy();
        }
      }
      dev.popClip();
    } finally {
      shape.destroy();
    }
  }

  stroke(dev: M.Device, cmds: PathCmd[], ctm: M.Matrix, line: SlideLine): void {
    const { m } = this;
    if (line.color.alpha <= 0 || line.width <= 0) return;
    const p = this.path(cmds);
    const stroke = new m.StrokeState({ lineCap: 'Butt', lineJoin: 'Miter', lineWidth: line.width, miterLimit: 10, dashes: line.dash, dashPhase: 0 });
    dev.strokePath(p, stroke, ctm, m.ColorSpace.DeviceRGB, line.color.rgb, line.color.alpha);
    p.destroy();
    stroke.destroy();
    // Arrow heads on open paths.
    if ((line.head || line.tail) && cmds.length >= 2) {
      const pts: [number, number][] = [];
      for (const c of cmds) {
        if (c[0] === 'M' || c[0] === 'L') pts.push([c[1], c[2]]);
        else if (c[0] === 'C') pts.push([c[3], c[4]], [c[5], c[6]]);
      }
      const ends: [('arrow' | 'oval') | undefined, [number, number] | undefined, [number, number] | undefined][] = [
        [line.head, pts[0], pts[1]],
        [line.tail, pts[pts.length - 1], pts[pts.length - 2]],
      ];
      for (const [kind, tip, from] of ends) {
        if (!kind || !tip || !from) continue;
        // Head size in the shape's space: scale back from the matrix.
        const scale = Math.hypot(ctm[0], ctm[1]) || 1;
        const size = Math.max(3, line.width * 3) / scale;
        const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
        const head = new m.Path();
        if (kind === 'arrow') {
          head.moveTo(tip[0], tip[1]);
          head.lineTo(tip[0] - size * Math.cos(ang - 0.45), tip[1] - size * Math.sin(ang - 0.45));
          head.lineTo(tip[0] - size * Math.cos(ang + 0.45), tip[1] - size * Math.sin(ang + 0.45));
          head.closePath();
        } else {
          const r = size / 2;
          head.rect(tip[0] - r, tip[1] - r, tip[0] + r, tip[1] + r);
        }
        dev.fillPath(head, false, ctm, m.ColorSpace.DeviceRGB, line.color.rgb, line.color.alpha);
        head.destroy();
      }
    }
  }

  // Pictures ------------------------------------------------------------------
  image(index: number): M.Image | M.Document | null {
    if (this.#images.has(index)) return this.#images.get(index) ?? null;
    const bytes = this.req.images[index];
    let img: M.Image | M.Document | null = null;
    if (bytes) {
      const head = new TextDecoder().decode(bytes.subarray(0, 200)).trimStart();
      try {
        if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) img = this.m.Document.openDocument(bytes, 'image/svg+xml');
        else img = new this.m.Image(bytes);
      } catch {
        img = null;
      }
    }
    if (!img) this.broken += 1;
    this.#images.set(index, img);
    return img;
  }

  /** Draws picture `index` into the unit square mapped by `ctm`. */
  drawImage(dev: M.Device, index: number, ctm: M.Matrix, alpha: number): boolean {
    const img = this.image(index);
    if (!img) return false;
    if (img instanceof this.m.Image) {
      dev.fillImage(img, ctm, alpha);
      return true;
    }
    const page = img.loadPage(0);
    const [x0, y0, x1, y1] = page.getBounds();
    const scale = this.m.Matrix.concat(this.m.Matrix.concat(this.m.Matrix.translate(-x0, -y0), this.m.Matrix.scale(1 / Math.max(1e-6, x1 - x0), 1 / Math.max(1e-6, y1 - y0))), ctm);
    page.run(dev, scale);
    page.destroy();
    return true;
  }

  // Text ----------------------------------------------------------------------
  layout(html: string, width: number, wrap: boolean): Laid {
    const doc = this.m.Document.openDocument(
      encoder.encode(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${wrap ? SLIDE_CSS : NOWRAP_CSS}</style></head><body>${wrapSymbolRuns(html, this.fonts)}</body></html>`),
      'text/html',
    );
    doc.layout(Math.max(4, width), TALL, 12);
    const page = doc.loadPage(0);
    let height = 0;
    let right = 0;
    const st = page.toStructuredText('preserve-whitespace');
    st.walk({
      beginLine(bbox) {
        if (bbox[3] > height) height = bbox[3];
        if (bbox[2] > right) right = bbox[2];
      },
    });
    st.destroy();
    return { doc, page, height, width: right };
  }

  free(l: Laid): void {
    l.page.destroy();
    l.doc.destroy();
  }

  /** Lays out and draws a text box in box-local space (`ctm` maps the box, unflipped). */
  text(dev: M.Device, t: SlideText, w: number, h: number, ctm: M.Matrix): void {
    if (!t.html) return;
    const { Matrix } = this.m;
    // Turned text: lay out in the turned box.
    const turned = t.vert === 90 || t.vert === 270;
    const bw = turned ? h : w;
    const bh = turned ? w : h;
    const [l, top, r, bottom] = t.inset;
    const innerW = Math.max(4, bw - l - r);
    const innerH = Math.max(0, bh - top - bottom);
    let scale = typeof t.shrink === 'number' ? Math.min(1, Math.max(0.1, t.shrink)) : 1;
    let laid = this.layout(t.html, t.wrap ? innerW / scale : TALL, t.wrap);
    if (t.shrink !== false && laid.height * scale > innerH + 0.5 && innerH > 4) {
      // Shrink on overflow: PowerPoint stored its own scale; our substitute fonts can run a little longer, so
      // shrink further, at most to 70 % of that (text at scale s in width W = layout in W/s, drawn scaled).
      let lo = scale * 0.7;
      let hi = scale;
      let best: { s: number; l: Laid } | null = null;
      for (let i = 0; i < 6; i++) {
        const s = (lo + hi) / 2;
        const trial = this.layout(t.html, innerW / s, true);
        if (trial.height * s <= innerH + 0.5) {
          if (best) this.free(best.l);
          best = { s, l: trial };
          lo = s;
        } else {
          this.free(trial);
          hi = s;
        }
      }
      if (best) {
        this.free(laid);
        laid = best.l;
        scale = best.s;
      }
    }
    try {
      let dx = l;
      if (!t.wrap) {
        // No wrapping: the text keeps its natural width, placed by its alignment.
        const natural = laid.width;
        const again = this.layout(t.html, natural + 1, false);
        this.free(laid);
        laid = again;
        const align = /text-align:(center|right)/.exec(t.html)?.[1];
        if (align === 'center') dx = l + (innerW - natural * scale) / 2;
        else if (align === 'right') dx = l + innerW - natural * scale;
      }
      const used = laid.height * scale;
      const dy = t.anchor === 'ctr' ? top + (innerH - used) / 2 : t.anchor === 'b' ? top + innerH - used : top;
      let mat = Matrix.concat(Matrix.scale(scale, scale), Matrix.translate(dx, dy));
      if (turned) {
        // Box space of the turned layout → the real box.
        const turn = t.vert === 90 ? Matrix.concat(Matrix.rotate(90), Matrix.translate(w, 0)) : Matrix.concat(Matrix.rotate(270), Matrix.translate(0, h));
        mat = Matrix.concat(mat, turn);
      }
      laid.page.run(dev, Matrix.concat(mat, ctm));
      if (this.clusters && needsClusters(t.html)) collectClusters(this.m, laid.page, this.clusters);
    } finally {
      this.free(laid);
    }
  }

  // Items ---------------------------------------------------------------------
  item(dev: M.Device, it: SlideItem): void {
    const { m } = this;
    const b = it.box;
    if (!(b.w >= 0 && b.h >= 0)) return;
    const ctm = this.boxMatrix(b);
    switch (it.kind) {
      case 'shape': {
        if (it.fill && it.path) this.fill(dev, it.path, b, ctm, it.fill);
        if (it.line && it.path) this.stroke(dev, it.path, ctm, it.line);
        if (it.text) this.text(dev, it.text, b.w, b.h, this.boxMatrix(b, false));
        break;
      }
      case 'image': {
        if (it.clip) {
          const p = this.path(it.clip);
          dev.clipPath(p, false, ctm);
          p.destroy();
        }
        const [cl, ct, cr, cb] = it.crop ?? [0, 0, 0, 0];
        const fw = 1 - cl - cr;
        const fh = 1 - ct - cb;
        const iw = fw > 0.001 ? b.w / fw : b.w;
        const ih = fh > 0.001 ? b.h / fh : b.h;
        if (it.crop && !it.clip) {
          const p = this.rectPath(0, 0, b.w, b.h);
          dev.clipPath(p, false, ctm);
          p.destroy();
        }
        const ok = this.drawImage(dev, it.image, m.Matrix.concat([iw, 0, 0, ih, -cl * iw, -ct * ih], ctm), it.alpha ?? 1);
        if (it.clip || it.crop) dev.popClip();
        if (!ok) this.missing(dev, b, 'Picture could not be decoded');
        if (it.line) this.stroke(dev, it.clip ?? [['M', 0, 0], ['L', b.w, 0], ['L', b.w, b.h], ['L', 0, b.h], ['Z']], ctm, it.line);
        break;
      }
      case 'table':
        this.table(dev, it);
        break;
      case 'missing':
        this.missing(dev, b, it.label);
        break;
      default:
    }
  }

  missing(dev: M.Device, b: SlideBox, label: string): void {
    const { m } = this;
    const ctm = this.boxMatrix(b);
    const p = this.rectPath(0, 0, b.w, b.h);
    dev.fillPath(p, false, ctm, m.ColorSpace.DeviceRGB, [0.95, 0.95, 0.96], 1);
    const stroke = new m.StrokeState({ lineCap: 'Butt', lineJoin: 'Miter', lineWidth: 0.75, miterLimit: 10, dashes: [4, 3], dashPhase: 0 });
    dev.strokePath(p, stroke, ctm, m.ColorSpace.DeviceRGB, [0.6, 0.62, 0.66], 1);
    stroke.destroy();
    p.destroy();
    const size = Math.max(7, Math.min(14, b.h / 6, b.w / 20));
    const esc = label.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
    this.text(dev, { html: `<div style="text-align:center;font-family:sans-serif;font-size:${size}pt;color:#5f6368">${esc}</div>`, inset: [6, 4, 6, 4], anchor: 'ctr', wrap: true, vert: 0, shrink: true }, b.w, b.h, this.boxMatrix(b, false));
  }

  table(dev: M.Device, t: Extract<SlideItem, { kind: 'table' }>): void {
    const ctm = this.boxMatrix({ ...t.box, flipH: false, flipV: false });
    const cols = t.cols;
    const rows = [...t.rows];
    const x = [0];
    for (const c of cols) x.push((x[x.length - 1] as number) + c);
    const span = (arr: number[], from: number, n: number) => arr.slice(from, from + n).reduce((a, v) => a + v, 0);
    // Rows grow to fit their text (single-row cells first, then spanning cells add to their last row).
    const heights = t.cells.map((c) => {
      const w = span(cols, c.col, c.colSpan) - c.text.inset[0] - c.text.inset[2];
      const laid = this.layout(c.text.html, Math.max(4, w), true);
      const h = laid.height + c.text.inset[1] + c.text.inset[3];
      this.free(laid);
      return h;
    });
    t.cells.forEach((c, i) => {
      if (c.rowSpan === 1 && c.row < rows.length) rows[c.row] = Math.max(rows[c.row] as number, heights[i] as number);
    });
    t.cells.forEach((c, i) => {
      if (c.rowSpan > 1) {
        const have = span(rows, c.row, c.rowSpan);
        const need = heights[i] as number;
        const last = Math.min(rows.length - 1, c.row + c.rowSpan - 1);
        if (need > have) rows[last] = (rows[last] as number) + need - have;
      }
    });
    const y = [0];
    for (const r of rows) y.push((y[y.length - 1] as number) + r);
    for (const c of t.cells) {
      const cx = x[c.col] ?? 0;
      const cy = y[c.row] ?? 0;
      const w = span(cols, c.col, c.colSpan);
      const h = span(rows, c.row, c.rowSpan);
      const local = this.m.Matrix.concat(this.m.Matrix.translate(cx, cy), ctm);
      if (c.fill) this.fill(dev, null, { x: 0, y: 0, w, h, rot: 0, flipH: false, flipV: false }, local, c.fill);
      this.text(dev, c.text, w, h, local);
    }
    // Borders after all fills and text, so neighbours do not paint over them.
    for (const c of t.cells) {
      const cx = x[c.col] ?? 0;
      const cy = y[c.row] ?? 0;
      const w = span(cols, c.col, c.colSpan);
      const h = span(rows, c.row, c.rowSpan);
      const sides: PathCmd[][] = [
        [['M', cx, cy], ['L', cx, cy + h]],
        [['M', cx, cy], ['L', cx + w, cy]],
        [['M', cx + w, cy], ['L', cx + w, cy + h]],
        [['M', cx, cy + h], ['L', cx + w, cy + h]],
      ];
      c.borders.forEach((ln, i) => {
        if (ln) this.stroke(dev, sides[i] as PathCmd[], ctm, { ...ln, head: undefined, tail: undefined });
      });
    }
  }

  background(dev: M.Device, fill: SlideFill | undefined): void {
    const { width: w, height: h } = this.req;
    const box = { x: 0, y: 0, w, h, rot: 0, flipH: false, flipV: false };
    this.fill(dev, null, box, this.m.Matrix.identity, fill ?? { kind: 'solid', color: { rgb: [1, 1, 1], alpha: 1 } });
  }

  destroy(): void {
    for (const img of this.#images.values()) img?.destroy();
    this.#images.clear();
  }
}

/** Everything the slides say, for choosing fonts. */
function slideText(req: SlidesRequest): { text: string; names: string[] } {
  let html = '';
  const add = (t: SlideText | undefined) => {
    if (t) html += `${t.html}\n`;
  };
  for (const s of req.slides) {
    for (const it of s.items) {
      if (it.kind === 'shape') add(it.text);
      else if (it.kind === 'table') for (const c of it.cells) add(c.text);
      else if (it.kind === 'missing') html += `${it.label}\n`;
    }
  }
  const names = new Set<string>();
  for (const m of html.matchAll(/font-family:\s*'([^']+)'/g)) names.add((m[1] as string).toLowerCase());
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return { text, names: [...names] };
}

export async function renderSlides(m: Mupdf, req: SlidesRequest, progress?: ProgressFn) {
  const fonts = new FontSet(m);
  const { text, names } = slideText(req);
  progress?.(0.03, 1, 'Loading fonts');
  await fonts.prepare(`${req.title ?? ''}\n${text}`, { monospace: names.some((n) => /mono|courier|consolas/.test(n)), names });
  installFontSet(m, fonts);
  const drawer = new SlideDrawer(m, req, fonts);
  if (needsClusters(text)) drawer.clusters = new Map();
  const buf = new m.Buffer();
  try {
    const writer = new m.DocumentWriter(buf, 'pdf', '');
    const n = req.slides.length;
    for (let i = 0; i < n; i++) {
      const slide = req.slides[i] as SlidesRequest['slides'][number];
      const dev = writer.beginPage([0, 0, req.width, req.height]);
      drawer.background(dev, slide.background);
      for (const it of slide.items) {
        try {
          drawer.item(dev, it);
        } catch (err) {
          // One odd shape should not lose the slide.
          console.warn('slide item', err);
        }
      }
      writer.endPage();
      progress?.(0.05 + 0.85 * ((i + 1) / n), 1, `Slide ${i + 1} of ${n}`);
    }
    writer.close();
    writer.destroy();
    const pdf = new m.PDFDocument(buf);
    try {
      let bookmarks = 0;
      if (req.outline) {
        const it = pdf.outlineIterator();
        req.slides.forEach((s, i) => {
          const uri = pdf.formatLinkURI({ type: 'Fit', chapter: 0, page: i, x: 0, y: 0, width: 0, height: 0, zoom: 0 });
          it.insert({ title: `${s.number}. ${s.title ?? `Slide ${s.number}`}`.slice(0, 200), uri, open: false });
          bookmarks += 1;
        });
        it.destroy();
      }
      if (req.title) pdf.setMetaData('info:Title', req.title);
      if (req.author) pdf.setMetaData('info:Author', req.author);
      pdf.setMetaData('info:Producer', 'Metamorpher (MuPDF)');
      pdf.setMetaData('info:Creator', 'Metamorpher');
      if (req.lang) pdf.setLanguage(req.lang);
      progress?.(0.95, 1, 'Embedding fonts');
      pdf.subsetFonts();
      if (drawer.clusters) fixToUnicode(pdf, drawer.clusters);
      const out = pdf.saveToBuffer('garbage=compact,compress,compress-fonts').asUint8Array();
      return {
        blob: new Blob([new Uint8Array(out)], { type: 'application/pdf' }),
        pages: n,
        bookmarks,
        fonts: fonts.labels(),
        missing: [...fonts.missing].slice(0, 12).map((cp) => String.fromCodePoint(cp)),
        brokenImages: drawer.broken,
      };
    } finally {
      pdf.destroy();
    }
  } finally {
    drawer.destroy();
    buf.destroy();
    installFontSet(m, null);
    fonts.destroy();
  }
}
