/**
 * Random access to a file's bytes in 64 KB pages, read on demand with
 * `Blob.slice` and kept in a small LRU cache, so files of any size open
 * instantly and use a few megabytes of memory.
 */
const PAGE = 64 * 1024;
const KEEP = 64;

export class ByteSource {
  readonly size: number;
  #file: Blob;
  #pages = new Map<number, Uint8Array>();
  #loading = new Map<number, Promise<Uint8Array>>();
  #onLoad: () => void;

  constructor(file: Blob, onLoad: () => void) {
    this.#file = file;
    this.size = file.size;
    this.#onLoad = onLoad;
  }

  #load(page: number): Promise<Uint8Array> {
    const have = this.#pages.get(page);
    if (have) return Promise.resolve(have);
    let p = this.#loading.get(page);
    if (!p) {
      const start = page * PAGE;
      p = this.#file
        .slice(start, Math.min(this.size, start + PAGE))
        .arrayBuffer()
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          this.#loading.delete(page);
          this.#pages.set(page, bytes);
          if (this.#pages.size > KEEP) this.#pages.delete(this.#pages.keys().next().value as number);
          return bytes;
        });
      this.#loading.set(page, p);
      p.then(() => this.#onLoad(), () => this.#loading.delete(page));
    }
    return p;
  }

  /** The byte at `offset` when its page is cached, else -1 (and the page starts loading). */
  peek(offset: number): number {
    if (offset < 0 || offset >= this.size) return -1;
    const page = Math.floor(offset / PAGE);
    const bytes = this.#pages.get(page);
    if (!bytes) {
      void this.#load(page);
      return -1;
    }
    // Refresh LRU order now and then is not needed for correctness; keep it cheap.
    return bytes[offset - page * PAGE]!;
  }

  /** Up to `length` bytes from `offset` (fewer at the end of the file). */
  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.size, offset + length);
    if (end <= offset) return new Uint8Array(0);
    if (end - offset > 4 * PAGE) return new Uint8Array(await this.#file.slice(offset, end).arrayBuffer());
    const out = new Uint8Array(end - offset);
    for (let p = Math.floor(offset / PAGE); p * PAGE < end; p++) {
      const bytes = await this.#load(p);
      const from = Math.max(offset, p * PAGE);
      const to = Math.min(end, p * PAGE + bytes.length);
      out.set(bytes.subarray(from - p * PAGE, to - p * PAGE), from - offset);
    }
    return out;
  }

  /**
   * First match of `pattern` (null entries match any byte) at or after `from`
   * (or before it, backwards), wrapping around the end. `fold` matches ASCII
   * letters in either case. Reads 4 MB at a time and yields between chunks.
   */
  async find(
    pattern: (number | null)[],
    from: number,
    opts: { backwards?: boolean; fold?: boolean; signal?: AbortSignal; onProgress?: (fraction: number) => void },
  ): Promise<number> {
    const n = pattern.length;
    if (!n || n > this.size) return -1;
    const fold = (b: number) => (opts.fold && b >= 0x41 && b <= 0x5a ? b + 32 : b);
    const pat = pattern.map((b) => (b === null ? null : fold(b)));
    const CHUNK = 4 * 1024 * 1024;
    const total = this.size;
    const matchAt = (buf: Uint8Array, i: number) => {
      for (let k = 0; k < n; k++) {
        const p = pat[k];
        if (p !== null && p !== undefined && fold(buf[i + k]!) !== p) return false;
      }
      return true;
    };
    let scanned = 0;
    if (!opts.backwards) {
      // Scan [from, size) then [0, from).
      const ranges: [number, number][] = [
        [from, total],
        [0, Math.min(total, from + n - 1)],
      ];
      for (const [a, b] of ranges) {
        for (let start = a; start < b; start += CHUNK) {
          if (opts.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
          const buf = await this.read(start, Math.min(CHUNK + n - 1, total - start));
          const last = Math.min(buf.length - n, b - start - 1);
          for (let i = 0; i <= last; i++) if (matchAt(buf, i)) return start + i;
          scanned += CHUNK;
          opts.onProgress?.(Math.min(1, scanned / total));
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      return -1;
    }
    // Backwards: scan (from-1 … 0], then (size-1 … from].
    const ranges: [number, number][] = [
      [0, from],
      [from, total],
    ];
    for (const [a, b] of ranges) {
      for (let end = b; end > a; end -= CHUNK) {
        if (opts.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
        const start = Math.max(a, end - CHUNK);
        const buf = await this.read(start, Math.min(end - start + n - 1, total - start));
        for (let i = Math.min(end - start - 1, buf.length - n); i >= 0; i--) if (matchAt(buf, i)) return start + i;
        scanned += CHUNK;
        opts.onProgress?.(Math.min(1, scanned / total));
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return -1;
  }
}

/** "DE AD ?? EF" or "deadbeef" → bytes (null = any). Null when it is not a hex pattern. */
export function parseHexPattern(text: string): (number | null)[] | null {
  const clean = text.replace(/0x/gi, '').replace(/[\s,:-]+/g, '');
  if (!clean || clean.length % 2 || !/^([0-9a-f]{2}|\?\?)+$/i.test(clean)) return null;
  const out: (number | null)[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.slice(i, i + 2);
    out.push(pair === '??' ? null : parseInt(pair, 16));
  }
  return out;
}

/** "0x1F00", "1f00h", "7936" → a byte offset; null when not a number. */
export function parseOffset(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/_/g, '');
  if (!t) return null;
  let v: number;
  if (/^0x[0-9a-f]+$/.test(t)) v = parseInt(t.slice(2), 16);
  else if (/^[0-9a-f]+h$/.test(t)) v = parseInt(t.slice(0, -1), 16);
  else if (/^\d+$/.test(t)) v = parseInt(t, 10);
  else if (/^[0-9a-f]+$/.test(t)) v = parseInt(t, 16);
  else return null;
  return Number.isFinite(v) ? v : null;
}
