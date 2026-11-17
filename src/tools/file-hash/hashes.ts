// Incremental SHA-256, SHA-1 and MD5 (FIPS 180-4, RFC 1321). WebCrypto's
// digest() needs the whole input at once and has no MD5, so these take the file
// chunk by chunk and keep only 64 bytes of state each.

export interface Hasher {
  update(data: Uint8Array): void;
  /** Hex digest. The hasher cannot be updated afterwards. */
  digest(): string;
}

const hex = (words: Int32Array | number[], littleEndian: boolean) => {
  let s = '';
  for (const w of words) {
    const v = w >>> 0;
    if (littleEndian) {
      for (let i = 0; i < 4; i += 1) s += ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    } else {
      s += v.toString(16).padStart(8, '0');
    }
  }
  return s;
};

/** Shared 64-byte block buffering and Merkle–Damgård padding. */
abstract class BlockHasher implements Hasher {
  private _buffer = new Uint8Array(64);
  private _bufferView = new DataView(this._buffer.buffer);
  private _buffered = 0;
  private _length = 0;
  protected abstract readonly littleEndian: boolean;
  protected abstract block(data: DataView, offset: number): void;
  protected abstract words(): Int32Array;

  update(data: Uint8Array): void {
    let i = 0;
    this._length += data.length;
    if (this._buffered > 0) {
      const take = Math.min(64 - this._buffered, data.length);
      this._buffer.set(data.subarray(0, take), this._buffered);
      this._buffered += take;
      i = take;
      if (this._buffered < 64) return;
      this.block(this._bufferView, 0);
      this._buffered = 0;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (; i + 64 <= data.length; i += 64) this.block(view, i);
    if (i < data.length) {
      this._buffer.set(data.subarray(i), 0);
      this._buffered = data.length - i;
    }
  }

  digest(): string {
    const bytes = this._length;
    const tail = new Uint8Array(this._buffered < 56 ? 64 : 128);
    tail.set(this._buffer.subarray(0, this._buffered));
    tail[this._buffered] = 0x80;
    // Message length in bits as a 64-bit integer (exact up to 2^53 bytes).
    const lo = (bytes % 0x20000000) * 8;
    const hi = Math.floor(bytes / 0x20000000);
    const view = new DataView(tail.buffer);
    const end = tail.length - 8;
    if (this.littleEndian) {
      view.setUint32(end, lo, true);
      view.setUint32(end + 4, hi, true);
    } else {
      view.setUint32(end, hi, false);
      view.setUint32(end + 4, lo, false);
    }
    for (let i = 0; i < tail.length; i += 64) this.block(view, i);
    return hex(this.words(), this.littleEndian);
  }
}

const K256 = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 extends BlockHasher {
  protected readonly littleEndian = false;
  private _h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private _w = new Int32Array(64);

  protected words(): Int32Array {
    return this._h;
  }

  protected block(d: DataView, o: number): void {
    const w = this._w;
    const h = this._h;
    for (let i = 0; i < 16; i += 1) w[i] = d.getInt32(o + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let dd = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i]! + w[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (dd + t1) | 0;
      dd = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + dd) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + hh) | 0;
  }
}

export class Sha1 extends BlockHasher {
  protected readonly littleEndian = false;
  private _h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private _w = new Int32Array(80);

  protected words(): Int32Array {
    return this._h;
  }

  protected block(d: DataView, o: number): void {
    const w = this._w;
    const h = this._h;
    for (let i = 0; i < 16; i += 1) w[i] = d.getInt32(o + i * 4, false);
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let dd = h[3]!;
    let e = h[4]!;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & dd);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ dd;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & dd) | (c & dd);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ dd;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) | 0;
      e = dd;
      dd = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + dd) | 0;
    h[4] = (h[4]! + e) | 0;
  }
}

const S_MD5 = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K_MD5 = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);

export class Md5 extends BlockHasher {
  protected readonly littleEndian = true;
  private _h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private _m = new Int32Array(16);

  protected words(): Int32Array {
    return this._h;
  }

  protected block(d: DataView, o: number): void {
    const m = this._m;
    const h = this._h;
    for (let i = 0; i < 16; i += 1) m[i] = d.getInt32(o + i * 4, true);
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let dd = h[3]!;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & b) | (~dd & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ dd;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~dd);
        g = (7 * i) & 15;
      }
      const x = (a + f + K_MD5[i]! + m[g]!) | 0;
      const s = S_MD5[i]!;
      a = dd;
      dd = c;
      c = b;
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + dd) | 0;
  }
}

export type Algorithm = 'sha256' | 'sha1' | 'md5';
export const ALGORITHMS: { id: Algorithm; label: string; create: () => Hasher }[] = [
  { id: 'sha256', label: 'SHA-256', create: () => new Sha256() },
  { id: 'sha1', label: 'SHA-1', create: () => new Sha1() },
  { id: 'md5', label: 'MD5', create: () => new Md5() },
];
