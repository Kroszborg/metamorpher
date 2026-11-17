/**
 * Reads a text file the way an editor would: UTF-8 (with or without BOM),
 * UTF-16 with a BOM, and Windows-1252 for old files that are not valid UTF-8.
 */
export async function decodeText(blob: Blob): Promise<{ text: string; encoding: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start)), encoding: 'UTF-8' };
  } catch {
    // UTF-16 without a BOM: many zero bytes in alternate positions.
    let zeros = 0;
    const sample = Math.min(bytes.length, 4096);
    for (let i = 1; i < sample; i += 2) if (bytes[i] === 0) zeros += 1;
    if (zeros > sample / 4) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16' };
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

/** True when the bytes look like a binary file rather than text (NUL bytes, many control characters). */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 8192);
  if (sample.length === 0) return false;
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) control += 1;
  }
  return control / sample.length > 0.1;
}
