/**
 * A random-access write target that ends as a Blob without holding the whole
 * file in one ArrayBuffer.
 *
 * Writes are appended to a small buffer that is moved into a Blob part every
 * FLUSH_BYTES; the browser keeps large blob data out of the JS heap (Chrome
 * pages it to disk). Writes behind the flushed region (the few header fields
 * muxers patch at the end, such as an MP4 `moov` or a Matroska segment size)
 * are kept as patches and spliced in when the file is finished, using
 * Blob.slice, which references data instead of copying it.
 */
const FLUSH_BYTES = 32 * 1024 * 1024;

type Patch = { pos: number; data: Uint8Array };

export class BlobSink {
  #parts: Blob[] = [];
  #flushed = 0;
  #buf = new Uint8Array(1024 * 1024);
  #len = 0;
  #patches: Patch[] = [];

  /** Bytes written so far (the current end of the file). */
  get size(): number {
    return this.#flushed + this.#len;
  }

  write(position: number, data: Uint8Array): void {
    let pos = position;
    let bytes = data;
    if (pos < this.#flushed) {
      const cut = Math.min(pos + bytes.length, this.#flushed) - pos;
      this.#patches.push({ pos, data: bytes.slice(0, cut) });
      if (cut === bytes.length) return;
      bytes = bytes.subarray(cut);
      pos = this.#flushed;
    }
    const offset = pos - this.#flushed;
    const end = offset + bytes.length;
    if (end > this.#buf.length) {
      let cap = this.#buf.length;
      while (cap < end) cap *= 2;
      const grown = new Uint8Array(cap);
      grown.set(this.#buf.subarray(0, this.#len));
      this.#buf = grown;
    }
    this.#buf.set(bytes, offset);
    this.#len = Math.max(this.#len, end);
    if (this.#len >= FLUSH_BYTES) this.#flush();
  }

  #flush(): void {
    if (this.#len === 0) return;
    this.#parts.push(new Blob([this.#buf.slice(0, this.#len)]));
    this.#flushed += this.#len;
    this.#len = 0;
    this.#buf = new Uint8Array(Math.min(this.#buf.length, FLUSH_BYTES * 2));
  }

  /** Flushes everything, applies the patches and returns the file. */
  finish(type: string): Blob {
    this.#flush();
    const base = new Blob(this.#parts);
    const patches = mergePatches(this.#patches);
    this.#parts = [];
    this.#patches = [];
    if (patches.length === 0) return new Blob([base], { type });
    const pieces: BlobPart[] = [];
    let cursor = 0;
    for (const p of patches) {
      if (p.pos > cursor) pieces.push(base.slice(cursor, p.pos));
      pieces.push(p.data as Uint8Array<ArrayBuffer>);
      cursor = p.pos + p.data.length;
    }
    if (cursor < base.size) pieces.push(base.slice(cursor));
    return new Blob(pieces, { type });
  }

  /** A WritableStream for Mediabunny's StreamTarget. */
  writable(): WritableStream<{ type: 'write'; data: Uint8Array; position: number }> {
    return new WritableStream({
      write: (chunk) => this.write(chunk.position, chunk.data),
    });
  }
}

/** Sorts patches and folds overlapping ones together, later writes winning. */
function mergePatches(patches: Patch[]): Patch[] {
  const ordered = patches.map((p, i) => ({ ...p, i })).sort((a, b) => a.pos - b.pos || a.i - b.i);
  const out: (Patch & { i: number })[] = [];
  for (const p of ordered) {
    const last = out[out.length - 1];
    if (last && p.pos < last.pos + last.data.length) {
      const start = last.pos;
      const end = Math.max(last.pos + last.data.length, p.pos + p.data.length);
      const merged = new Uint8Array(end - start);
      // Apply in write order so the newest bytes win.
      const [first, second] = last.i <= p.i ? [last, p] : [p, last];
      merged.set(first.data, first.pos - start);
      merged.set(second.data, second.pos - start);
      out[out.length - 1] = { pos: start, data: merged, i: Math.max(last.i, p.i) };
    } else {
      out.push(p);
    }
  }
  return out;
}
