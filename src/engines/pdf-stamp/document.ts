/** Opening, saving and per-page drawing helpers for the stamping worker. */
import {
  BlendMode,
  concatTransformationMatrix,
  PDFArray,
  type PDFContentStream,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  setGraphicsState,
} from '@cantoo/pdf-lib';
import { ENCRYPTED_MESSAGE } from './messages';
import { type Box, intersectBoxes, type Matrix, normalizeBox, type PageFrame, pageFrame } from './geometry';


export class EncryptedPdfError extends Error {
  constructor() {
    super(ENCRYPTED_MESSAGE);
    this.name = 'EncryptedPdfError';
  }
}

/** Loads a PDF for editing. Never touches metadata on its own; throws readable errors. */
export async function openPdf(blob: Blob, name = 'This file'): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false, ignoreEncryption: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt|password/i.test(message)) throw new EncryptedPdfError();
    throw new Error(`${name} could not be read as a PDF (${message}).`);
  }
  if (doc.isEncrypted) throw new EncryptedPdfError();
  return doc;
}

export async function savePdf(doc: PDFDocument): Promise<Blob> {
  const bytes = await doc.save({ updateFieldAppearances: false });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

function readBox(page: PDFPage, which: 'MediaBox' | 'CropBox'): Box | null {
  const raw = page.node.getInheritableAttribute(PDFName.of(which));
  const arr = raw ? page.doc.context.lookup(raw) : undefined;
  if (!(arr instanceof PDFArray) || arr.size() < 4) return null;
  const n = [0, 1, 2, 3].map((i) => {
    const v = arr.lookup(i);
    return v instanceof PDFNumber ? v.asNumber() : 0;
  });
  return normalizeBox(n[0]!, n[1]!, n[2]!, n[3]!);
}

/** The visible box (crop ∩ media) and rotation of a page, as viewers display it. */
export function frameOf(page: PDFPage): PageFrame {
  const media = readBox(page, 'MediaBox') ?? { x: 0, y: 0, width: 612, height: 792 };
  const crop = readBox(page, 'CropBox');
  const box = crop ? intersectBoxes(crop, media) : media;
  return pageFrame(box, page.getRotation().angle);
}

/** Everything a page draws onto: the media box (covers the crop box too). */
export function mediaBoxOf(page: PDFPage): Box {
  return readBox(page, 'MediaBox') ?? { x: 0, y: 0, width: 612, height: 792 };
}

export const cm = (m: Matrix) => concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]);

/** Draws on top of the existing content. The existing content is wrapped in q/Q first. */
export function drawOver(page: PDFPage, ops: PDFOperator[]): void {
  page.node.normalize();
  page.pushOperators(pushGraphicsState(), ...ops, popGraphicsState());
}

/** Draws underneath the existing content (a new first content stream). */
export function drawUnder(page: PDFPage, ops: PDFOperator[]): void {
  page.node.normalize();
  const context = page.doc.context;
  const stream: PDFContentStream = context.contentStream([pushGraphicsState(), ...ops, popGraphicsState()]);
  const ref: PDFRef = context.register(stream);
  const contents = page.node.Contents();
  if (contents instanceof PDFArray) contents.insert(0, ref);
  else if (contents instanceof PDFStream) {
    const existing = page.node.get(PDFName.of('Contents'));
    page.node.set(PDFName.of('Contents'), context.obj([ref, existing ?? contents]));
  } else page.node.set(PDFName.of('Contents'), context.obj([ref]));
}

/** An ExtGState with opacity and blend mode, registered on the page; returns the operator that sets it. */
export function graphicsState(
  page: PDFPage,
  { opacity = 1, blendMode = BlendMode.Normal }: { opacity?: number; blendMode?: BlendMode },
): PDFOperator[] {
  if (opacity >= 1 && blendMode === BlendMode.Normal) return [];
  const dict = page.doc.context.obj({
    Type: 'ExtGState',
    ca: opacity,
    CA: opacity,
    BM: blendMode,
  });
  const key = page.node.newExtGState('MmGS', dict);
  return [setGraphicsState(key)];
}
