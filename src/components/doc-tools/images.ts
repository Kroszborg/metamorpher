/**
 * Images for documents: files the user added next to a document (looked up
 * by name) and embedded data: URLs, turned into formats the layout engine
 * reads (PNG, JPEG, GIF). Remote URLs are never fetched.
 */

export type Resources = ReadonlyMap<string, Blob>;

const DIRECT = new Set(['image/png', 'image/jpeg', 'image/gif']);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|tiff?)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

/** Files by lower-case name, for `<img src="diagram.png">` and `![](images/diagram.png)`. */
export function resourceMap(files: readonly File[]): Map<string, Blob> {
  const map = new Map<string, Blob>();
  for (const f of files) map.set(f.name.toLowerCase(), f);
  return map;
}

export function isRemote(src: string): boolean {
  return /^(https?:)?\/\//i.test(src.trim());
}

/** The added file a relative reference points at (by its last path segment). */
export function findResource(src: string, resources: Resources): Blob | undefined {
  if (resources.size === 0) return undefined;
  let path = src.trim().replace(/[?#].*$/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep it as written
  }
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  return name ? resources.get(name) : undefined;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

function sniffType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).toLowerCase();
  if (head.includes('<svg') || head.includes('<?xml')) return 'image/svg+xml';
  return '';
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded image keeps its pixels; the URL is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * A data: URL the layout engine can read, or null when the image cannot be
 * decoded. PNG, JPEG and GIF pass through; WebP, AVIF, BMP and SVG are drawn
 * to a canvas (SVG at twice its size, so it stays sharp in print).
 */
export async function imageDataUrl(blob: Blob, maxSide = 4096): Promise<string | null> {
  const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const type = sniffType(head) || blob.type;
  if (DIRECT.has(type)) return readAsDataUrl(type === blob.type ? blob : new Blob([blob], { type }));
  try {
    const svg = type === 'image/svg+xml';
    const img = await loadImage(svg ? new Blob([blob], { type: 'image/svg+xml' }) : blob);
    let w = img.naturalWidth || 300;
    let h = img.naturalHeight || 150;
    if (svg) {
      w *= 2;
      h *= 2;
    }
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Bytes of a data: URL (decoding it locally; nothing is fetched). */
export async function dataUrlBlob(src: string): Promise<Blob | null> {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(src.trim());
  if (!m) return null;
  try {
    if (m[2]) {
      const bin = atob((m[3] as string).replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: m[1] || '' });
    }
    return new Blob([decodeURIComponent(m[3] as string)], { type: m[1] || '' });
  } catch {
    return null;
  }
}
