/** Image embedding for the stamping worker (runs where OffscreenCanvas exists). */
import type { PDFDocument, PDFImage } from '@cantoo/pdf-lib';

function sniff(bytes: Uint8Array): 'png' | 'jpeg' | 'other' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return 'other';
}

/** The EXIF orientation (1–8) of a JPEG, or 1 when it has none. */
function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 < view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1;
    offset += 2 + size;
  }
  return 1;
}

/** Decodes any browser-readable image (EXIF rotation applied) to PNG bytes. */
export async function toPng(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('The image could not be decoded.');
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available in this browser.');
    ctx.drawImage(bitmap, 0, 0);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await out.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** Embeds PNG as-is, JPEG as-is (unless EXIF-rotated), anything else via PNG. */
export async function embedImage(doc: PDFDocument, blob: Blob): Promise<PDFImage> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const kind = sniff(bytes);
  if (kind === 'png') return doc.embedPng(bytes);
  if (kind === 'jpeg' && jpegOrientation(bytes) <= 1) return doc.embedJpg(bytes);
  return doc.embedPng(await toPng(blob));
}
