// Burns the editor's items into the PDF as page content: vector shapes and
// ink, images, and real text. Text comes laid out by the layout engine (one
// page per text box: HarfBuzz shaping for every script the Noto fonts cover,
// fonts subsetted) and is placed as a form, so it stays real, selectable
// text. New content streams only; nothing is rasterised.
import {
  appendBezierCurve,
  beginText,
  BlendMode,
  closePath,
  drawObject,
  endText,
  fill,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  type PDFDocument,
  type PDFImage,
  type PDFName,
  type PDFOperator,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setFontAndSize,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  stroke,
} from '@cantoo/pdf-lib';
import { expose } from 'comlink';
import { cm, drawOver, graphicsState, openPdf, savePdf } from '@/engines/pdf-stamp/document';
import { parseColor } from '@/engines/pdf-stamp/draw-text';
import { placementMatrix } from '@/engines/pdf-stamp/geometry';
import { embedImage } from '@/engines/pdf-stamp/images';
import { Type0Font } from '@/engines/pdf-stamp/truetype';
import { LINE_HEIGHT, wrapLines } from './layout';
import type { EditItem, Family } from './types';
import type { PDFEmbeddedPage } from '@cantoo/pdf-lib';

const FONT_FILES: Record<Family, Record<'r' | 'b' | 'i' | 'bi', string>> = {
  sans: { r: 'noto-sans-400', b: 'noto-sans-700', i: 'noto-sans-400i', bi: 'noto-sans-700i' },
  serif: { r: 'caladea-400', b: 'caladea-700', i: 'caladea-400i', bi: 'caladea-700i' },
  mono: { r: 'noto-sans-mono-400', b: 'noto-sans-mono-700', i: 'noto-sans-mono-400', bi: 'noto-sans-mono-700' },
};
const fontBytes = new Map<string, Promise<Uint8Array>>();
function loadFont(file: string): Promise<Uint8Array> {
  let p = fontBytes.get(file);
  if (!p) {
    p = fetch(new URL(`/vendor/fonts/${file}.ttf`, self.location.origin))
      .then((r) => {
        if (!r.ok) throw new Error(`A font could not be loaded (${r.status}).`);
        return r.arrayBuffer();
      })
      .then((b) => new Uint8Array(b));
    p.catch(() => fontBytes.delete(file));
    fontBytes.set(file, p);
  }
  return p;
}

function rgb(hex: string | null | undefined): [number, number, number] | null {
  return hex ? parseColor(hex) : null;
}

/** An ellipse inside [x0, x1] × [y0, y1] as four Bézier curves. */
function ellipseOps(x0: number, y0: number, x1: number, y1: number): PDFOperator[] {
  const k = 0.5522847498;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  return [
    moveTo(cx + rx, cy),
    appendBezierCurve(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry),
    appendBezierCurve(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy),
    appendBezierCurve(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry),
    appendBezierCurve(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy),
    closePath(),
  ];
}

class Fonts {
  readonly #doc: PDFDocument;
  readonly #fonts = new Map<string, Type0Font>();
  readonly #keys = new Map<PDFPage, Map<string, PDFName>>();
  constructor(doc: PDFDocument) {
    this.#doc = doc;
  }
  async get(family: Family, bold: boolean, italic: boolean): Promise<{ font: Type0Font; file: string }> {
    const file = FONT_FILES[family][bold ? (italic ? 'bi' : 'b') : italic ? 'i' : 'r'];
    let font = this.#fonts.get(file);
    if (!font) {
      font = new Type0Font(this.#doc.context, await loadFont(file), file.replace(/[^A-Za-z0-9]/g, ''));
      this.#fonts.set(file, font);
    }
    return { font, file };
  }
  key(page: PDFPage, file: string, font: Type0Font): PDFName {
    let map = this.#keys.get(page);
    if (!map) {
      map = new Map();
      this.#keys.set(page, map);
    }
    let key = map.get(file);
    if (!key) {
      key = page.node.newFontDictionary('MmEd', font.ref);
      map.set(file, key);
    }
    return key;
  }
  finalize() {
    for (const f of this.#fonts.values()) f.finalize();
  }
}

async function itemOps(
  doc: PDFDocument,
  page: PDFPage,
  item: EditItem,
  fonts: Fonts,
  images: Map<Blob, PDFImage>,
  boxes: PDFEmbeddedPage[],
): Promise<PDFOperator[]> {
  const p = item.placement;
  const w = p.width;
  const h = p.height;
  const ops: PDFOperator[] = [cm(placementMatrix(p, page.getRotation().angle))];
  const sw = Math.max(0.1, item.strokeWidth ?? 2);
  const strokeRgb = rgb(item.color ?? '#000000') ?? [0, 0, 0];
  const fillRgb = rgb(item.fill);
  const lineStyle = () => [setLineWidth(sw), setStrokingRgbColor(...strokeRgb), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)];

  switch (item.kind) {
    case 'image': {
      if (!item.image) return [];
      let image = images.get(item.image);
      if (!image) {
        image = await embedImage(doc, item.image);
        images.set(item.image, image);
      }
      const key = page.node.newXObject('MmEdImg', image.ref);
      ops.push(cm([w, 0, 0, h, 0, 0]), drawObject(key));
      return ops;
    }
    case 'whiteout':
      ops.push(setFillingRgbColor(...(fillRgb ?? [1, 1, 1])), moveTo(0, 0), lineTo(w, 0), lineTo(w, h), lineTo(0, h), closePath(), fill());
      return ops;
    case 'highlight':
      ops.push(
        ...graphicsState(page, { opacity: 0.45, blendMode: BlendMode.Multiply }),
        setFillingRgbColor(...(fillRgb ?? [1, 0.9, 0.2])),
        moveTo(0, 0),
        lineTo(w, 0),
        lineTo(w, h),
        lineTo(0, h),
        closePath(),
        fill(),
      );
      return ops;
    case 'rect':
    case 'ellipse': {
      const i = sw / 2;
      const shape =
        item.kind === 'rect'
          ? [moveTo(i, i), lineTo(w - i, i), lineTo(w - i, h - i), lineTo(i, h - i), closePath()]
          : ellipseOps(i, i, w - i, h - i);
      ops.push(...lineStyle(), ...(fillRgb ? [setFillingRgbColor(...fillRgb)] : []), ...shape, fillRgb ? fillAndStroke() : stroke());
      return ops;
    }
    case 'line':
    case 'arrow': {
      const [x0, y0, x1, y1] = item.direction === 'up' ? [0, 0, w, h] : [0, h, w, 0];
      ops.push(...lineStyle());
      if (item.kind === 'arrow') {
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const ux = (x1 - x0) / len;
        const uy = (y1 - y0) / len;
        const head = Math.min(len * 0.45, Math.max(8, sw * 4));
        const bx = x1 - ux * head;
        const by = y1 - uy * head;
        const half = head * 0.45;
        ops.push(moveTo(x0, y0), lineTo(bx, by), stroke());
        ops.push(setFillingRgbColor(...strokeRgb), moveTo(x1, y1), lineTo(bx - uy * half, by + ux * half), lineTo(bx + uy * half, by - ux * half), closePath(), fill());
      } else {
        ops.push(moveTo(x0, y0), lineTo(x1, y1), stroke());
      }
      return ops;
    }
    case 'ink': {
      ops.push(...lineStyle());
      for (const s of item.strokes ?? []) {
        const pts = s.map(([u, v]) => [u * w, (1 - v) * h] as const);
        const first = pts[0];
        if (!first) continue;
        ops.push(moveTo(first[0], first[1]));
        if (pts.length === 1) ops.push(lineTo(first[0] + 0.01, first[1]));
        for (const [x, y] of pts.slice(1)) ops.push(lineTo(x, y));
        ops.push(stroke());
      }
      return ops;
    }
    case 'text': {
      const text = (item.text ?? '').replace(/\t/g, '    ');
      if (!text.trim()) return [];
      const laid = item.textPage !== undefined ? boxes[item.textPage] : undefined;
      if (laid) {
        // The laid-out box is a page of exactly w × h: a form drawn in the item's box.
        const key = page.node.newXObject('MmEdTxt', laid.ref);
        ops.push(drawObject(key));
        return ops;
      }
      const size = item.size ?? 14;
      const { font, file } = await fonts.get(item.family ?? 'sans', !!item.bold, !!item.italic);
      const missing = font.missing(text.replace(/\s/g, ''));
      if (missing.length) {
        throw new Error(
          `The text uses characters these fonts cannot draw (${missing.slice(0, 5).join(' ')}). Latin, Greek and Cyrillic work; other scripts come later.`,
        );
      }
      const key = fonts.key(page, file, font);
      const lines = wrapLines(text, w - 4, (s) => font.widthOfTextAtSize(s, size));
      const [r, g, b] = rgb(item.color ?? '#000000') ?? [0, 0, 0];
      ops.push(beginText(), setFontAndSize(key, size), setFillingRgbColor(r, g, b));
      const ascent = font.ascentAtSize(size);
      lines.forEach((line, n) => {
        const lw = font.widthOfTextAtSize(line, size);
        const x = item.align === 'center' ? (w - lw) / 2 : item.align === 'right' ? w - 2 - lw : 2;
        const y = h - 2 - ascent - n * size * LINE_HEIGHT;
        ops.push(setTextMatrix(1, 0, 0, 1, x, y), showText(font.encode(line)));
      });
      ops.push(endText());
      return ops;
    }
    default:
      return [];
  }
}

const api = {
  /** Writes every item onto its page, in order (later items on top). */
  async apply(file: Blob, items: EditItem[], textBoxes?: Uint8Array): Promise<{ blob: Blob; written: number }> {
    const doc = await openPdf(file);
    const pages = doc.getPages();
    const fonts = new Fonts(doc);
    const images = new Map<Blob, PDFImage>();
    const used = [...new Set(items.map((i) => i.textPage).filter((n): n is number => n !== undefined))];
    const boxes: PDFEmbeddedPage[] = [];
    if (textBoxes && used.length) {
      const embedded = await doc.embedPdf(textBoxes, used);
      used.forEach((n, k) => {
        boxes[n] = embedded[k] as PDFEmbeddedPage;
      });
    }
    let written = 0;
    for (const item of items) {
      const page = pages[item.page];
      if (!page || !(item.placement.width > 0 && item.placement.height > 0)) continue;
      const ops = await itemOps(doc, page, item, fonts, images, boxes);
      if (ops.length <= 1) continue;
      drawOver(page, [pushGraphicsState(), ...ops, popGraphicsState()]);
      written += 1;
    }
    fonts.finalize();
    return { blob: await savePdf(doc), written };
  },
};

export type EditWorkerApi = typeof api;

expose(api);
