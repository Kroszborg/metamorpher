/** Page numbers, Bates numbers and headers/footers: text in six slots around the visible page. */
import type { PDFDocument } from '@cantoo/pdf-lib';
import { cm, drawOver, frameOf } from '../document';
import { textOps } from '../draw-text';
import { cleanText, FontBook } from '../fonts';
import { fillTemplate, formatBates, formatNumber, parsePageRange } from '../text-format';
import { SLOT_IDS, type TextStampSpec } from '../types';

/** Stamps `doc` in place. Returns the number of pages stamped. `only` limits drawing to one page (previews). */
export async function stampText(doc: PDFDocument, spec: TextStampSpec, only?: number): Promise<number> {
  const pages = doc.getPages();
  const total = pages.length;
  const range = parsePageRange(spec.pages, total);
  if ('error' in range) throw new Error(`Pages: ${range.error}`);
  const skip = Math.max(0, Math.floor(spec.skipFirst));
  const selected = spec.bates ? pages.map((_, i) => i) : range.pages.filter((i) => i >= skip);
  const fonts = new FontBook(doc);
  const lastNumber = spec.startNumber + selected.length - 1;
  // One baseline per row whatever font a slot ends up with (the fallback font has taller metrics).
  const reference = await fonts.fontFor('A', spec.font, spec.bold);
  const ascent = reference.ascentAtSize(spec.size);
  const descent = reference.descentAtSize(spec.size);

  for (const [k, index] of selected.entries()) {
    if (only !== undefined && index !== only) continue;
    const page = pages[index]!;
    const n = spec.counting === 'stamped' ? spec.startNumber + k : spec.startNumber + index;
    const totalNumber = spec.counting === 'stamped' ? lastNumber : spec.startNumber + total - 1;
    const values = {
      page: formatNumber(n, spec.numberStyle),
      total: formatNumber(totalNumber, spec.numberStyle),
      date: spec.date,
      filename: spec.filename,
      bates: spec.bates ? formatBates(spec.bates.start + index, spec.bates) : '',
    };
    const frame = frameOf(page);
    const ops = [cm(frame.matrix)];
    for (const slot of SLOT_IDS) {
      const template = spec.slots[slot];
      if (!template?.trim()) continue;
      const text = cleanText(fillTemplate(template, values));
      if (!text) continue;
      const font = await fonts.fontFor(text, spec.font, spec.bold);
      const width = font.widthOfTextAtSize(text, spec.size);
      const col = slot[1];
      const x =
        col === 'l' ? spec.marginX : col === 'r' ? frame.width - spec.marginX - width : (frame.width - width) / 2;
      // Top slots hang from the margin by their ascent; bottom slots sit on it by their descent.
      const y = slot[0] === 't' ? frame.height - spec.marginY - ascent : spec.marginY - descent;
      ops.push(...textOps(fonts.keyOn(page, font), font, text, spec.size, x, y, spec.color));
    }
    if (ops.length > 1) drawOver(page, ops);
  }
  fonts.finalize();
  return selected.length;
}
