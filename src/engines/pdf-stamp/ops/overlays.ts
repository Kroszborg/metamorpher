/** Places images and text at user-space placements (sign-pdf; later the PDF editor). */
import { drawObject, type PDFDocument, type PDFImage, type PDFOperator } from '@cantoo/pdf-lib';
import { cm, drawOver } from '../document';
import { textOps } from '../draw-text';
import { cleanText, FontBook } from '../fonts';
import { placementMatrix } from '../geometry';
import { embedImage } from '../images';
import { TEXT_BASELINE, TEXT_LINE, type OverlayItem } from '../types';

export async function placeOverlays(doc: PDFDocument, items: OverlayItem[]): Promise<number> {
  const pages = doc.getPages();
  const fonts = new FontBook(doc);
  const images = new Map<Blob, PDFImage>();

  for (const item of items) {
    const page = pages[item.page];
    if (!page) throw new Error(`Page ${item.page + 1} does not exist in this PDF.`);
    const p = item.placement;
    if (!(p.width > 0 && p.height > 0)) continue;
    const ops: PDFOperator[] = [];
    const m = placementMatrix(p, page.getRotation().angle);
    if (item.content.type === 'image') {
      let image = images.get(item.content.image);
      if (!image) {
        image = await embedImage(doc, item.content.image);
        images.set(item.content.image, image);
      }
      const key = page.node.newXObject('MmImg', image.ref);
      ops.push(cm(m), cm([p.width, 0, 0, p.height, 0, 0]), drawObject(key));
    } else {
      const text = cleanText(item.content.text);
      if (!text) continue;
      const font = await fonts.fontFor(text, item.content.font);
      const size = p.height / TEXT_LINE;
      ops.push(cm(m), ...textOps(fonts.keyOn(page, font), font, text, size, 0, size * TEXT_BASELINE, item.content.color));
    }
    drawOver(page, ops);
  }
  fonts.finalize();
  return items.length;
}
