/** File-name, MIME and download helpers shared by tools, engines and the workbench. */

const MIME: Record<string, string> = {
  // images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  tga: 'image/x-tga',
  svg: 'image/svg+xml',
  // video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ts: 'video/mp2t',
  // audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  // documents
  pdf: 'application/pdf',
  zip: 'application/zip',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Lower-case extension without the dot, or '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** "photo.png" + "jpg" → "photo.jpg". */
export function replaceExtension(name: string, ext: string): string {
  return `${baseName(name)}.${ext}`;
}

/** The MIME type for an extension; falls back to application/octet-stream. */
export function mimeFor(ext: string): string {
  return MIME[ext.toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream';
}

/**
 * Whether a file matches an `<input accept>` style list (extensions, exact
 * MIME types or wildcards like "image/*"). An empty list accepts everything.
 */
export function matchesAccept(file: { name: string; type: string }, accept: readonly string[]): boolean {
  if (accept.length === 0) return true;
  const ext = `.${extensionOf(file.name)}`;
  const type = file.type.toLowerCase();
  return accept.some((rule) => {
    const r = rule.trim().toLowerCase();
    if (r.startsWith('.')) return r === ext;
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
    return r === type;
  });
}

let counter = 0;
/** A process-unique id for a file in a list (never derived from the file name). */
export function newId(prefix = 'f'): string {
  counter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${counter.toString(36)}-${random}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Makes names unique within a list: "a.png", "a.png" → "a.png", "a (2).png". */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const ext = extensionOf(name);
    return ext ? `${baseName(name)} (${n}).${ext}` : `${name} (${n})`;
  });
}

/** Saves a blob through a temporary link; the object URL is revoked once the click has been handled. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
