/**
 * Text files in parts: small files are read whole; large ones in parts of
 * about 4 MB that start and end at line breaks, so a 2 GB log opens at once
 * and uses a few megabytes.
 */

export const WHOLE_LIMIT = 12 * 1024 * 1024;
export const PART_BYTES = 4 * 1024 * 1024;

export const ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1252', label: 'Windows-1252 (Western)' },
  { value: 'iso-8859-2', label: 'ISO-8859-2 (Central European)' },
  { value: 'windows-1251', label: 'Windows-1251 (Cyrillic)' },
  { value: 'koi8-r', label: 'KOI8-R' },
  { value: 'iso-8859-7', label: 'ISO-8859-7 (Greek)' },
  { value: 'windows-1254', label: 'Windows-1254 (Turkish)' },
  { value: 'iso-8859-8', label: 'ISO-8859-8 (Hebrew)' },
  { value: 'windows-1256', label: 'Windows-1256 (Arabic)' },
  { value: 'shift_jis', label: 'Shift JIS (Japanese)' },
  { value: 'euc-jp', label: 'EUC-JP (Japanese)' },
  { value: 'gbk', label: 'GBK (Simplified Chinese)' },
  { value: 'gb18030', label: 'GB18030 (Chinese)' },
  { value: 'big5', label: 'Big5 (Traditional Chinese)' },
  { value: 'euc-kr', label: 'EUC-KR (Korean)' },
  { value: 'windows-874', label: 'Windows-874 (Thai)' },
] as const;

export type Encoding = (typeof ENCODINGS)[number]['value'];

/** The decoder label for a sniffed encoding name. */
export function encodingFromSniff(name: string | undefined): Encoding {
  switch (name) {
    case 'UTF-16LE':
      return 'utf-16le';
    case 'UTF-16BE':
      return 'utf-16be';
    case 'Windows-1252':
      return 'windows-1252';
    default:
      return 'utf-8';
  }
}

export function partCount(size: number): number {
  return size <= WHOLE_LIMIT ? 1 : Math.ceil(size / PART_BYTES);
}

const wide = (e: Encoding) => e === 'utf-16le' || e === 'utf-16be';

/** Byte offset where part `k` starts: just after the first line break at or after k × PART_BYTES. */
async function boundary(file: Blob, k: number, enc: Encoding): Promise<number> {
  if (k <= 0) return 0;
  const at = k * PART_BYTES;
  if (at >= file.size) return file.size;
  const look = new Uint8Array(await file.slice(at, Math.min(file.size, at + 256 * 1024)).arrayBuffer());
  if (wide(enc)) {
    const even = at % 2 === 0 ? 0 : 1;
    for (let i = even; i + 1 < look.length; i += 2) {
      const unit = enc === 'utf-16le' ? look[i]! | (look[i + 1]! << 8) : (look[i]! << 8) | look[i + 1]!;
      if (unit === 0x0a) return at + i + 2;
    }
    return at + even;
  }
  for (let i = 0; i < look.length; i++) if (look[i] === 0x0a) return at + i + 1;
  // No line break nearby: cut at a character boundary.
  let i = 0;
  while (i < 4 && (look[i]! & 0xc0) === 0x80) i++;
  return at + i;
}

export type Part = { text: string; start: number; end: number; firstLine: number | null };

/** Decodes part `k` (or the whole file when it is small). */
export async function readPart(file: Blob, k: number, enc: Encoding): Promise<Part> {
  const parts = partCount(file.size);
  const start = parts === 1 ? 0 : await boundary(file, k, enc);
  const end = parts === 1 ? file.size : await boundary(file, k + 1, enc);
  let bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  // Skip a byte-order mark at the start of the file.
  if (start === 0) {
    if (enc === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
    else if (enc === 'utf-16le' && bytes[0] === 0xff && bytes[1] === 0xfe) bytes = bytes.subarray(2);
    else if (enc === 'utf-16be' && bytes[0] === 0xfe && bytes[1] === 0xff) bytes = bytes.subarray(2);
  }
  const text = new TextDecoder(enc).decode(bytes);
  return { text, start, end, firstLine: k === 0 ? 1 : null };
}
