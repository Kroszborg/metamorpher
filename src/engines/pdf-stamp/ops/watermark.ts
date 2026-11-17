/** Text or image watermarks: one per page at a grid position, or tiled; over or under the content. */
import {
  drawObject,
  type PDFDocument,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
} from '@cantoo/pdf-lib';
import { cm, drawOver, drawUnder, frameOf, graphicsState } from '../document';
import { textOps } from '../draw-text';
import { cleanText, FontBook, type TextFont } from '../fonts';
import { concat, type Matrix, rotationCcw, translation } from '../geometry';
import { embedImage } from '../images';
import { parsePageRange } from '../text-format';
import type { WatermarkSpec } from '../types';

type Mark =
  | { kind: 'text'; text: string; font: TextFont; width: number; height: number; descent: number }
  | { kind: 'image'; image: PDFImage; aspect: number };

export async function watermark(doc: PDFDocument, spec: WatermarkSpec, only?: number): Promise<number> {
  const pages = doc.getPages();
  const range = parsePageRange(spec.pages, pages.length);
  if ('error' in range) throw new Error(`Pages: ${range.error}`);
  const fonts = new FontBook(doc);

  let mark: Mark;
  if (spec.kind === 'text') {
    const text = cleanText(spec.text.replace(/\s*\n\s*/g, ' ')).trim();
    if (!text) throw new Error('Enter the watermark text.');
    const font = await fonts.fontFor(text, spec.style.font, spec.style.bold);
    const size = spec.style.size;
    const descent = font.descentAtSize(size);
    mark = {
      kind: 'text',
      text,
      font,
      width: font.widthOfTextAtSize(text, size),
      height: font.ascentAtSize(size) - descent,
      descent,
    };
  } else {
    if (!spec.image) throw new Error('Choose an image for the watermark.');
    const image = await embedImage(doc, spec.image);
    mark = { kind: 'image', image, aspect: image.height / image.width };
  }

  let count = 0;
  for (const index of range.pages) {
    if (only !== undefined && index !== only) continue;
    const page = pages[index]!;
    const frame = frameOf(page);
    const w = mark.kind === 'text' ? mark.width : frame.width * spec.imageScale;
    const h = mark.kind === 'text' ? mark.height : w * mark.aspect;
    const rad = (spec.rotation * Math.PI) / 180;
    // Bounding box of the rotated mark, used to keep it inside the margins.
    const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));

    const centres: [number, number][] = [];
    if (spec.tile) {
      const stepX = bw + spec.gap;
      const stepY = bh + spec.gap;
      const nx = Math.ceil(frame.width / stepX / 2) + 1;
      const ny = Math.ceil(frame.height / stepY / 2) + 1;
      for (let j = -ny; j <= ny; j += 1) {
        const shift = (Math.abs(j) % 2) * (stepX / 2);
        for (let i = -nx; i <= nx; i += 1) {
          centres.push([frame.width / 2 + i * stepX + shift, frame.height / 2 + j * stepY]);
        }
      }
    } else {
      const m = spec.margin;
      const col = spec.position[1];
      const row = spec.position[0];
      const cx = col === 'l' ? m + bw / 2 : col === 'r' ? frame.width - m - bw / 2 : frame.width / 2;
      const cy = row === 't' ? frame.height - m - bh / 2 : row === 'b' ? m + bh / 2 : frame.height / 2;
      centres.push([cx, cy]);
    }

    const ops: PDFOperator[] = [cm(frame.matrix), ...graphicsState(page, { opacity: spec.opacity })];
    const draw = markOps(page, fonts, mark, spec, w, h);
    for (const [cx, cy] of centres) {
      const local: Matrix = concat(concat(translation(-w / 2, -h / 2), rotationCcw(spec.rotation)), translation(cx, cy));
      ops.push(...wrap(local, draw));
    }
    if (spec.layer === 'under') drawUnder(page, ops);
    else drawOver(page, ops);
    count += 1;
  }
  fonts.finalize();
  return count;
}

function markOps(page: PDFPage, fonts: FontBook, mark: Mark, spec: WatermarkSpec, w: number, h: number): PDFOperator[] {
  if (mark.kind === 'text') {
    const key = fonts.keyOn(page, mark.font);
    return textOps(key, mark.font, mark.text, spec.style.size, 0, -mark.descent, spec.style.color);
  }
  const key = page.node.newXObject('MmImg', mark.image.ref);
  return [cm([w, 0, 0, h, 0, 0]), drawObject(key)];
}

function wrap(m: Matrix, ops: PDFOperator[]): PDFOperator[] {
  return [pushGraphicsState(), cm(m), ...ops, popGraphicsState()];
}
