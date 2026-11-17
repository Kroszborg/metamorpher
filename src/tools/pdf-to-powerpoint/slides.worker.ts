// PDF pages for editable slides: each page drawn without its visible text
// (the background picture), and the visible text as positioned lines with
// their font, size, style and colour. MuPDF.js from /vendor/mupdf.
import { expose, transfer } from 'comlink';
import type * as M from 'mupdf';
import { type Doc, type Mupdf, openPdf } from '@/engines/mupdf/ops/common';

let lib: Promise<Mupdf> | null = null;
function load(): Promise<Mupdf> {
  lib ??= (
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/mupdf/mupdf.js', self.location.origin).href) as Promise<typeof M>
  ).then((m) => {
    m.setLog({ warning: () => undefined, error: (msg) => console.warn(`MuPDF: ${msg}`) });
    return m;
  });
  return lib;
}

export type TextRun = { text: string; size: number; font: string; bold: boolean; italic: boolean; color: string };
/** One line of text in page points (top-left origin); `rot` in degrees clockwise. */
export type TextLine = { x: number; y: number; w: number; h: number; rot: number; runs: TextRun[] };
export type EditablePage = { width: number; height: number; image: Uint8Array<ArrayBuffer>; lines: TextLine[]; hiddenLines: number };

let doc: Doc | null = null;

function hex(color: M.Color): string {
  const c = color.length === 1 ? [color[0], color[0], color[0]] : color.length === 4 ? [(1 - (color[0] ?? 0)) * (1 - (color[3] ?? 0)), (1 - (color[1] ?? 0)) * (1 - (color[3] ?? 0)), (1 - (color[2] ?? 0)) * (1 - (color[3] ?? 0))] : color;
  return c.map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
}

const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;

/** A device that passes everything to `target` except text, and records where visible glyphs were drawn. */
function textless(m: Mupdf, target: M.Device, visible: Set<string>): M.Device {
  const note = (text: M.Text, ctm: M.Matrix) => {
    text.walk({
      showGlyph(_font, trm) {
        const x = trm[4] * ctm[0] + trm[5] * ctm[2] + ctm[4];
        const y = trm[4] * ctm[1] + trm[5] * ctm[3] + ctm[5];
        visible.add(key(x, y));
      },
    });
  };
  return new m.Device({
    fillPath: (p, eo, ctm, cs, color, alpha) => target.fillPath(p, eo, ctm, cs, color as M.Color, alpha),
    strokePath: (p, st, ctm, cs, color, alpha) => target.strokePath(p, st, ctm, cs, color as M.Color, alpha),
    clipPath: (p, eo, ctm) => target.clipPath(p, eo, ctm),
    clipStrokePath: (p, st, ctm) => target.clipStrokePath(p, st, ctm),
    fillText: (text, ctm) => note(text, ctm),
    strokeText: (text, _st, ctm) => note(text, ctm),
    // Text used as a clip keeps its effect on what it clips (rare): an empty clip would hide too much, so it is skipped.
    clipText: (text, ctm) => target.clipText(text, ctm),
    clipStrokeText: (text, st, ctm) => target.clipStrokeText(text, st, ctm),
    ignoreText: () => undefined,
    fillShade: (shade, ctm, alpha) => target.fillShade(shade, ctm, alpha),
    fillImage: (image, ctm, alpha) => target.fillImage(image, ctm, alpha),
    fillImageMask: (image, ctm, cs, color, alpha) => target.fillImageMask(image, ctm, cs, color as M.Color, alpha),
    clipImageMask: (image, ctm) => target.clipImageMask(image, ctm),
    popClip: () => target.popClip(),
    beginMask: (area, lum, cs, color) => target.beginMask(area, lum, cs, color as M.Color),
    endMask: () => target.endMask(),
    beginGroup: (area, cs, isolated, knockout, blend, alpha) => target.beginGroup(area, cs, isolated, knockout, blend, alpha),
    endGroup: () => target.endGroup(),
    beginTile: (area, view, xs, ys, ctm, id, docId) => target.beginTile(area, view, xs, ys, ctm, id, docId),
    endTile: () => target.endTile(),
    beginLayer: (name) => target.beginLayer(name),
    endLayer: () => target.endLayer(),
  });
}

const api = {
  async open(file: Blob, password?: string): Promise<number> {
    const m = await load();
    doc?.destroy();
    doc = openPdf(m, new Uint8Array(await file.arrayBuffer()), password);
    return doc.countPages();
  },

  async page(index: number, dpi: number): Promise<EditablePage> {
    const m = await load();
    if (!doc) throw new Error('No document is open.');
    const page = doc.loadPage(index);
    try {
      const bounds = page.getBounds();
      const [x0, y0, x1, y1] = bounds;
      const scale = dpi / 72;
      const matrix = m.Matrix.scale(scale, scale);
      const pix = new m.Pixmap(m.ColorSpace.DeviceRGB, m.Rect.transform(bounds, matrix), false);
      pix.clear(255);
      const draw = new m.DrawDevice(matrix, pix);
      const visible = new Set<string>();
      const dev = textless(m, draw, visible);
      try {
        page.run(dev, m.Matrix.identity);
      } finally {
        dev.close();
        draw.close();
        dev.destroy();
        draw.destroy();
      }
      const image = new Uint8Array(pix.asJPEG(85, false));
      pix.destroy();

      // The visible text, line by line.
      const lines: TextLine[] = [];
      let hiddenLines = 0;
      type Building = { runs: TextRun[]; quads: M.Quad[]; dir: M.Point; shown: number; chars: number };
      let line: Building | null = null;
      const stext = page.toStructuredText('preserve-whitespace');
      try {
        stext.walk({
          beginLine(_bbox, _wmode, dir) {
            line = { runs: [], quads: [], dir, shown: 0, chars: 0 };
          },
          onChar(c, origin, font, size, quad, color) {
            if (!line) return;
            const name = font.getName().replace(/^[A-Z]{6}\+/, '');
            const bold = font.isBold() || /bold|black|heavy|semibold|demi/i.test(name);
            const italic = font.isItalic() || /italic|oblique/i.test(name);
            const col = hex(color);
            const sz = Math.round(size * 10) / 10;
            const last = line.runs[line.runs.length - 1];
            if (last && last.font === name && last.size === sz && last.bold === bold && last.italic === italic && last.color === col) last.text += c;
            else if (last && c === ' ') last.text += c;
            else line.runs.push({ text: c, size: sz, font: name, bold, italic, color: col });
            if (c.trim()) {
              line.chars += 1;
              line.quads.push(quad);
              if (visible.has(key(origin[0], origin[1]))) line.shown += 1;
            }
          },
          endLine() {
            const l = line as Building | null;
            line = null;
            if (!l || l.chars === 0) return;
            // Lines drawn invisibly (OCR layers) stay in the picture only.
            if (l.shown < l.chars * 0.5) {
              hiddenLines += 1;
              return;
            }
            const rot = (Math.atan2(l.dir[1], l.dir[0]) * 180) / Math.PI;
            const xs = l.quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
            const ys = l.quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
            let bx0 = Math.min(...xs);
            let by0 = Math.min(...ys);
            let bx1 = Math.max(...xs);
            let by1 = Math.max(...ys);
            if (Math.abs(rot) > 1) {
              // Turned text: the box before turning, about the same centre.
              const cx = (bx0 + bx1) / 2;
              const cy = (by0 + by1) / 2;
              const along = Math.hypot((l.quads[l.quads.length - 1] as M.Quad)[2] - (l.quads[0] as M.Quad)[0], (l.quads[l.quads.length - 1] as M.Quad)[3] - (l.quads[0] as M.Quad)[1]);
              const across = Math.max(...l.runs.map((r) => r.size)) * 1.2;
              bx0 = cx - along / 2;
              bx1 = cx + along / 2;
              by0 = cy - across / 2;
              by1 = cy + across / 2;
            }
            const runs = l.runs.map((r) => ({ ...r, text: r.text })).filter((r) => r.text !== '');
            const first = runs[0];
            if (first) first.text = first.text.replace(/^\s+/, '');
            lines.push({ x: bx0 - x0, y: by0 - y0, w: bx1 - bx0, h: by1 - by0, rot: Math.abs(rot) > 1 ? rot : 0, runs });
          },
        });
      } finally {
        stext.destroy();
      }
      return transfer({ width: x1 - x0, height: y1 - y0, image, lines, hiddenLines }, [image.buffer]);
    } finally {
      page.destroy();
    }
  },

  close(): void {
    doc?.destroy();
    doc = null;
  },
};

export type SlidesWorkerApi = typeof api;
expose(api);
