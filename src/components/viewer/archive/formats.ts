/**
 * Archive readers that never load the whole archive to list it: ZIP from its
 * central directory (ZIP64 too) with entries read on demand, TAR from its
 * headers, and GZip (and .tar.gz) by streaming decompression. Decompression
 * is fflate (MIT); ZipCrypto passwords are handled here, WinZip AES is not.
 */

export type Entry = {
  path: string;
  dir: boolean;
  size: number;
  /** Stored size; equals `size` for TAR. */
  packed: number;
  modified: Date | null;
  encrypted: 'none' | 'zipcrypto' | 'aes';
  /** Method name for people ("Deflate", "Store"). */
  method: string;
  /** Internal: where and how to read it. */
  ref: { kind: 'zip'; local: number; method: number; flags: number; crc: number; time: number } | { kind: 'tar'; offset: number } | { kind: 'mem'; data: Uint8Array };
};

export type Listing = { format: string; entries: Entry[]; comment?: string; note?: string };

export class PasswordNeeded extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? 'That password is not right.' : 'This entry is protected with a password.');
  }
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;

async function bytes(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function decodeName(raw: Uint8Array, utf8: boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: !utf8 }).decode(raw);
  } catch {
    // Old archives use the DOS code page; Latin-1 keeps ASCII and avoids replacement characters.
    return new TextDecoder('windows-1252').decode(raw);
  }
}

function dosDate(time: number, date: number): Date | null {
  if (!date) return null;
  const d = new Date((date >> 9) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isNaN(d.getTime()) ? null : d;
}

const METHODS: Record<number, string> = { 0: 'Store', 8: 'Deflate', 9: 'Deflate64', 12: 'BZip2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 98: 'PPMd', 99: 'AES' };

// ── ZIP ────────────────────────────────────────────────────────────────────

export async function listZip(file: Blob): Promise<Listing> {
  const tailLen = Math.min(file.size, 65557 + 20);
  const tail = await bytes(file, file.size - tailLen, file.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This ZIP has no central directory: it is damaged or cut short.');
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  const commentLen = u16(tail, eocd + 20);
  const comment = commentLen ? decodeName(tail.subarray(eocd + 22, eocd + 22 + commentLen), true) : undefined;
  // ZIP64 locator right before the EOCD.
  if (eocd >= 20 && u32(tail, eocd - 20) === 0x07064b50) {
    const z64 = u64(tail, eocd - 20 + 8);
    const rec = await bytes(file, z64, z64 + 56);
    if (u32(rec, 0) === 0x06064b50) {
      count = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOffset = u64(rec, 48);
    }
  }
  if (cdOffset + cdSize > file.size) throw new Error('This ZIP is cut short: its directory points past the end of the file.');
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const entries: Entry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
    const flags = u16(cd, p + 8);
    let method = u16(cd, p + 10);
    const time = u16(cd, p + 12);
    const date = u16(cd, p + 14);
    const crc = u32(cd, p + 16);
    let packed = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLength = u16(cd, p + 32);
    let local = u32(cd, p + 42);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    let encrypted: Entry['encrypted'] = flags & 1 ? 'zipcrypto' : 'none';
    let modified = dosDate(time, date);
    // Extra fields: ZIP64 sizes, AES, Unix time.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      const d = e + 4;
      if (id === 0x0001) {
        let q = d;
        if (size === 0xffffffff) {
          size = u64(cd, q);
          q += 8;
        }
        if (packed === 0xffffffff) {
          packed = u64(cd, q);
          q += 8;
        }
        if (local === 0xffffffff) local = u64(cd, q);
      } else if (id === 0x9901) {
        encrypted = 'aes';
        method = u16(cd, d + 5);
      } else if (id === 0x5455 && len >= 5 && cd[d]! & 1) {
        modified = new Date(u32(cd, d + 1) * 1000);
      }
      e = d + len;
    }
    entries.push({
      path: name,
      dir: name.endsWith('/'),
      size,
      packed,
      modified,
      encrypted,
      method: METHODS[method] ?? `Method ${method}`,
      ref: { kind: 'zip', local, method, flags, crc, time },
    });
    p = end + commentLength;
  }
  return { format: 'ZIP', entries, comment };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crcByte = (crc: number, b: number) => (CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8)) >>> 0;

/** Traditional PKWARE (ZipCrypto) decryption. Throws PasswordNeeded(true) on a wrong password. */
function zipCrypto(data: Uint8Array, password: string, check: number): Uint8Array {
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const update = (c: number) => {
    k0 = crcByte(k0, c);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crcByte(k2, k1 >>> 24);
  };
  for (const c of new TextEncoder().encode(password)) update(c);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xffff;
    const c = (data[i]! ^ ((t * (t ^ 1)) >>> 8)) & 0xff;
    out[i] = c;
    update(c);
  }
  if (out[11] !== check) throw new PasswordNeeded(true);
  return out.subarray(12);
}

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The bytes of one entry. `password` for ZipCrypto entries. */
export async function readEntry(file: Blob, entry: Entry, password?: string): Promise<Uint8Array> {
  const ref = entry.ref;
  if (ref.kind === 'mem') return ref.data;
  if (ref.kind === 'tar') return bytes(file, ref.offset, ref.offset + entry.size);
  if (entry.encrypted === 'aes') throw new Error('This entry uses WinZip AES encryption, which cannot be opened here yet. ZipCrypto-protected entries can.');
  const head = await bytes(file, ref.local, ref.local + 30);
  if (u32(head, 0) !== 0x04034b50) throw new Error('This entry is damaged: its local header is missing.');
  const start = ref.local + 30 + u16(head, 26) + u16(head, 28);
  let data = await bytes(file, start, start + entry.packed);
  if (entry.encrypted === 'zipcrypto') {
    if (!password) throw new PasswordNeeded(false);
    // With a data descriptor the check byte is the time's high byte, otherwise the CRC's.
    const check = ref.flags & 8 ? (ref.time >> 8) & 0xff : ref.crc >>> 24;
    data = zipCrypto(data, password, check);
  }
  let out: Uint8Array;
  if (ref.method === 0) out = data;
  else if (ref.method === 8) {
    const { inflate } = await import('fflate');
    out = await new Promise<Uint8Array>((resolve, reject) =>
      inflate(data, { size: entry.size }, (err, res) => (err ? reject(new Error(`This entry is damaged (${err.message}).`)) : resolve(res))),
    );
  } else throw new Error(`This entry is compressed with ${entry.method}, which cannot be read here (Store and Deflate can).`);
  if (crc32(out) !== ref.crc) {
    // A wrong ZipCrypto password passes the one-byte check 1 time in 256; the checksum catches it.
    if (entry.encrypted === 'zipcrypto') throw new PasswordNeeded(true);
    throw new Error('This entry is damaged: its checksum does not match.');
  }
  return out;
}

// ── TAR ────────────────────────────────────────────────────────────────────

const octal = (b: Uint8Array, o: number, n: number) => {
  const s = new TextDecoder().decode(b.subarray(o, o + n)).replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
};
const str = (b: Uint8Array, o: number, n: number) => new TextDecoder().decode(b.subarray(o, o + n)).replace(/\0.*$/s, '');

/** TAR entries from their headers (ustar, GNU long names, pax paths). `data` instead of a file for .tar.gz. */
export async function listTar(source: Blob | Uint8Array): Promise<Entry[]> {
  const size = source instanceof Uint8Array ? source.length : source.size;
  const read = async (a: number, b: number) => (source instanceof Uint8Array ? source.subarray(a, b) : bytes(source, a, b));
  const entries: Entry[] = [];
  let off = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (off + 512 <= size) {
    const h = await read(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const sum = h.reduce((s, x, i) => s + (i >= 148 && i < 156 ? 32 : x), 0);
    if (octal(h, 148, 8) !== sum) throw new Error(entries.length ? 'The archive is damaged after the first entries.' : 'This is not a valid TAR archive.');
    const len = octal(h, 124, 12);
    const type = String.fromCharCode(h[156]!);
    const data = off + 512;
    const next = data + Math.ceil(len / 512) * 512;
    if (type === 'L') {
      longName = str(await read(data, data + len), 0, len);
    } else if (type === 'x') {
      const pax = new TextDecoder().decode(await read(data, data + len));
      paxPath = /\d+ path=([^\n]*)\n/.exec(pax)?.[1] ?? null;
    } else if (type !== 'g') {
      const prefix = str(h, 345, 155);
      const name = paxPath ?? longName ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
      longName = null;
      paxPath = null;
      const dir = type === '5' || name.endsWith('/');
      if (type === '0' || type === '\0' || type === '5' || type === '7') {
        entries.push({
          path: dir && !name.endsWith('/') ? `${name}/` : name,
          dir,
          size: dir ? 0 : len,
          packed: dir ? 0 : len,
          modified: new Date(octal(h, 136, 12) * 1000),
          encrypted: 'none',
          method: 'Store',
          ref: source instanceof Uint8Array ? { kind: 'mem', data: source.subarray(data, data + len) } : { kind: 'tar', offset: data },
        });
      }
    }
    off = next;
  }
  return entries;
}

// ── GZip ───────────────────────────────────────────────────────────────────

/** Decompresses a .gz file by streaming; refuses outputs over `limit` bytes. */
export async function gunzipFile(file: Blob, limit: number, onProgress?: (f: number) => void): Promise<{ data: Uint8Array; name: string | null }> {
  const { Gunzip } = await import('fflate');
  const chunks: Uint8Array[] = [];
  let total = 0;
  let failed: Error | null = null;
  const g = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > limit) failed = new Error(`It unpacks to more than ${Math.round(limit / 1048576)} MB, too large to open here.`);
    else chunks.push(chunk);
  });
  const head = await bytes(file, 0, 1024);
  let name: string | null = null;
  if (head[3]! & 8) {
    let i = 10 + (head[3]! & 4 ? 2 + u16(head, 10) : 0);
    const s = i;
    while (i < head.length && head[i] !== 0) i++;
    name = new TextDecoder('latin1').decode(head.subarray(s, i)) || null;
  }
  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    read += value.length;
    try {
      g.push(value, false);
    } catch (err) {
      throw new Error(`This GZip file is damaged (${err instanceof Error ? err.message : 'bad data'}).`);
    }
    if (failed) {
      void reader.cancel();
      throw failed;
    }
    onProgress?.(read / file.size);
  }
  try {
    g.push(new Uint8Array(0), true);
  } catch (err) {
    throw new Error(`This GZip file is damaged or cut short (${err instanceof Error ? err.message : 'bad data'}).`);
  }
  if (failed) throw failed;
  const data = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    data.set(c, o);
    o += c.length;
  }
  return { data, name };
}

/** Lists any supported archive. */
export async function listArchive(file: File, ext: string, format: string, onProgress?: (f: number) => void): Promise<Listing> {
  if (format.startsWith('Gzip') || ext === 'gz' || ext === 'tgz') {
    const { data, name } = await gunzipFile(file, 1024 * 1024 * 1024, onProgress);
    // A tarball inside?
    if (data.length >= 512 && new TextDecoder().decode(data.subarray(257, 262)) === 'ustar') {
      return { format: 'TAR.GZ', entries: await listTar(data) };
    }
    const inner = name ?? file.name.replace(/\.(gz|tgz)$/i, '') ?? 'file';
    return {
      format: 'GZip',
      entries: [{ path: inner, dir: false, size: data.length, packed: file.size, modified: null, encrypted: 'none', method: 'Deflate', ref: { kind: 'mem', data } }],
    };
  }
  if (format.startsWith('TAR') || ext === 'tar') return { format: 'TAR', entries: await listTar(file) };
  return listZip(file);
}
