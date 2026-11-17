// Image files → bytes the OCR worker (MuPDF) can place on a page. JPEG, PNG,
// GIF, BMP and TIFF go through as they are (a JPEG keeps its original
// compression); anything else, and JPEGs that are stored rotated (EXIF
// orientation), is decoded by the browser and re-encoded upright.
import { extensionOf } from '@/lib/files';

const PASS_THROUGH: Record<string, string> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  gif: 'gif',
  bmp: 'bmp',
  tif: 'tiff',
  tiff: 'tiff',
};

/** The EXIF orientation of a JPEG (1 = upright), or 1 when there is none. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    const len = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (marker === 0xda) break;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif') {
      const tiff = at + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (o: number) => (little ? (bytes[o] ?? 0) | ((bytes[o + 1] ?? 0) << 8) : ((bytes[o] ?? 0) << 8) | (bytes[o + 1] ?? 0));
      const u32 = (o: number) => (little ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let i = 0; i < count; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) break;
        if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
      }
      return 1;
    }
    at += 2 + len;
  }
  return 1;
}

export async function imageForOcr(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = PASS_THROUGH[extensionOf(file.name)] ?? (file.type.startsWith('image/') ? PASS_THROUGH[file.type.slice(6)] : undefined);
  if (kind && !(kind === 'jpeg' && jpegOrientation(bytes) !== 1)) return bytes;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image format cannot be read in this browser. Convert it to PNG or JPEG first.');
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare the image.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const photo = kind === 'jpeg' || /^(webp|avif|jpe?g)$/.test(extensionOf(file.name));
    const blob = await canvas.convertToBlob(photo ? { type: 'image/jpeg', quality: 0.92 } : { type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
