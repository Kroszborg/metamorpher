/**
 * Colour modes. 'invert' and 'sepia' stay vector: a white backdrop goes under
 * the page and a full-page rectangle with a blend mode goes over it, so text
 * stays text. 'contrast' places a rendered, contrast-boosted image of each
 * page over the original content: the look is raster, but the original text
 * underneath remains searchable and selectable.
 */
import {
  BlendMode,
  drawObject,
  fill,
  type PDFDocument,
  rectangle,
  setFillingRgbColor,
} from '@cantoo/pdf-lib';
import { cm, drawOver, drawUnder, frameOf, graphicsState, mediaBoxOf } from '../document';
import { parsePageRange } from '../text-format';
import type { InvertSpec } from '../types';

const SEPIA: [number, number, number] = [0.98, 0.92, 0.79];

export async function invertColors(doc: PDFDocument, spec: InvertSpec, only?: number): Promise<number> {
  const pages = doc.getPages();
  const range = parsePageRange(spec.pages, pages.length);
  if ('error' in range) throw new Error(`Pages: ${range.error}`);
  let count = 0;
  for (const index of range.pages) {
    if (only !== undefined && index !== only) continue;
    const page = pages[index]!;
    const box = mediaBoxOf(page);
    const cover = rectangle(box.x, box.y, box.width, box.height);

    if (spec.mode === 'contrast') {
      const image = spec.images?.[index];
      if (!image) continue;
      const embedded = await doc.embedPng(new Uint8Array(await image.arrayBuffer()));
      const frame = frameOf(page);
      const key = page.node.newXObject('MmImg', embedded.ref);
      drawOver(page, [cm(frame.matrix), cm([frame.width, 0, 0, frame.height, 0, 0]), drawObject(key)]);
    } else {
      // An opaque white backdrop, so the blend has something to act on where the page is blank.
      drawUnder(page, [setFillingRgbColor(1, 1, 1), cover, fill()]);
      const [r, g, b] = spec.mode === 'invert' ? [1, 1, 1] : SEPIA;
      const blendMode = spec.mode === 'invert' ? BlendMode.Difference : BlendMode.Multiply;
      drawOver(page, [...graphicsState(page, { blendMode }), setFillingRgbColor(r, g, b), cover, fill()]);
    }
    count += 1;
  }
  return count;
}
