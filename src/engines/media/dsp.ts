/**
 * Streaming audio speed changers for the change-speed tool. Both take planar
 * float32 chunks of any length and return whatever output is ready.
 *
 * - TimeStretcher: WSOLA (waveform-similarity overlap-add). Changes duration
 *   but keeps the pitch. Best on speech and most music between 0.5× and 2×;
 *   at the extremes it can sound slightly echoey or choppy.
 * - TapeResampler: plays the samples faster or slower, like a tape: the pitch
 *   rises or falls with the speed. Linear interpolation.
 */

export interface SpeedProcessor {
  push(chunk: Float32Array[]): Float32Array[];
  /** Call once after the last chunk; returns the remaining output. */
  flush(): Float32Array[];
}

class Planar {
  data: Float32Array[];
  /** Absolute index of data[c][0]. */
  base = 0;
  length = 0;

  constructor(channels: number) {
    this.data = Array.from({ length: channels }, () => new Float32Array(1 << 16));
  }

  get end(): number {
    return this.base + this.length;
  }

  append(chunk: Float32Array[]): void {
    const n = chunk[0]?.length ?? 0;
    if (this.length + n > (this.data[0]?.length ?? 0)) {
      let cap = this.data[0]?.length ?? 1 << 16;
      while (cap < this.length + n) cap *= 2;
      this.data = this.data.map((d) => {
        const g = new Float32Array(cap);
        g.set(d.subarray(0, this.length));
        return g;
      });
    }
    for (let c = 0; c < this.data.length; c++) this.data[c]!.set(chunk[c] ?? chunk[0]!, this.length);
    this.length += n;
  }

  appendSilence(n: number): void {
    this.append(this.data.map(() => new Float32Array(n)));
  }

  /** Drops everything before absolute index `abs`. */
  discardBefore(abs: number): void {
    const k = Math.min(Math.max(0, abs - this.base), this.length);
    if (k < 1 << 15) return;
    for (const d of this.data) d.copyWithin(0, k, this.length);
    this.base += k;
    this.length -= k;
  }

  at(c: number, abs: number): number {
    const i = abs - this.base;
    return i >= 0 && i < this.length ? this.data[c]![i]! : 0;
  }
}

export class TimeStretcher implements SpeedProcessor {
  readonly #channels: number;
  readonly #factor: number;
  readonly #n: number;
  readonly #hs: number;
  readonly #ha: number;
  readonly #tol: number;
  readonly #window: Float32Array;
  readonly #in: Planar;
  /** Mono mix of #in, kept in step with it, for the similarity search. */
  readonly #mono: Planar;
  readonly #acc: Float32Array[];
  #k = 0;
  #prev = 0;
  #inputFrames = 0;
  #emitted = 0;
  #skip: number;

  constructor(channels: number, sampleRate: number, factor: number) {
    this.#channels = channels;
    this.#factor = factor;
    this.#n = Math.max(256, Math.round((sampleRate * 0.03) / 2) * 2);
    this.#hs = this.#n / 2;
    this.#ha = this.#hs * factor;
    this.#tol = Math.round(sampleRate * 0.006);
    this.#window = new Float32Array(this.#n);
    for (let i = 0; i < this.#n; i++) this.#window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.#n);
    this.#in = new Planar(channels);
    this.#mono = new Planar(1);
    this.#acc = Array.from({ length: channels }, () => new Float32Array(this.#n));
    // Lead-in of silence so the first real sample sits under a full window.
    this.#in.appendSilence(this.#hs + this.#tol);
    this.#mono.appendSilence(this.#hs + this.#tol);
    // Output sample y holds input sample y·factor + hs·(1 − factor) (the synthesis window is centred hs
    // later than the analysis one), so the lead-in ends at this output position.
    this.#skip = Math.max(0, Math.round((this.#hs + this.#tol - this.#hs * (1 - factor)) / factor));
    this.#prev = 0;
  }

  /** Similarity of the natural continuation at `a` with the candidate at `b`, on a mono mix. */
  #corr(a: number, b: number, step: number): number {
    const m = this.#mono.data[0]!;
    const len = this.#mono.length;
    const ia = a - this.#mono.base;
    const ib = b - this.#mono.base;
    let s = 0;
    let ea = 0;
    let eb = 0;
    for (let i = 0; i < this.#n; i += step) {
      const x = ia + i >= 0 && ia + i < len ? m[ia + i]! : 0;
      const y = ib + i >= 0 && ib + i < len ? m[ib + i]! : 0;
      s += x * y;
      ea += x * x;
      eb += y * y;
    }
    return s / Math.sqrt(ea * eb + 1e-9);
  }

  #run(final: boolean): Float32Array[] {
    const out: Float32Array[][] = [];
    for (;;) {
      const nominal = Math.round(this.#k * this.#ha);
      const natural = this.#prev + this.#hs;
      const need = Math.max(nominal + this.#tol, natural) + this.#n;
      if (need > this.#in.end) {
        if (!final) break;
        if (nominal >= this.#in.end) break;
      }
      let best = nominal;
      if (this.#k > 0) {
        const lo = Math.max(this.#in.base, nominal - this.#tol);
        const hi = nominal + this.#tol;
        let bestScore = -Infinity;
        for (let p = lo; p <= hi; p += 3) {
          const score = this.#corr(natural, p, 6);
          if (score > bestScore) {
            bestScore = score;
            best = p;
          }
        }
        const coarse = best;
        for (let p = coarse - 2; p <= coarse + 2; p++) {
          if (p < this.#in.base) continue;
          const score = this.#corr(natural, p, 2);
          if (score > bestScore) {
            bestScore = score;
            best = p;
          }
        }
      }
      for (let c = 0; c < this.#channels; c++) {
        const acc = this.#acc[c]!;
        for (let i = 0; i < this.#n; i++) acc[i]! += this.#window[i]! * this.#in.at(c, best + i);
      }
      // The first hop of the accumulator is complete.
      out.push(this.#acc.map((acc) => acc.slice(0, this.#hs)));
      for (const acc of this.#acc) {
        acc.copyWithin(0, this.#hs);
        acc.fill(0, this.#n - this.#hs);
      }
      this.#prev = best;
      this.#k += 1;
      const keep = Math.min(best, Math.round(this.#k * this.#ha) - this.#tol) - 1;
      this.#in.discardBefore(keep);
      this.#mono.discardBefore(keep);
    }
    return this.#emit(out, final);
  }

  #emit(blocks: Float32Array[][], final: boolean): Float32Array[] {
    const total = Math.round(this.#inputFrames / this.#factor);
    const parts: Float32Array[][] = [];
    for (const b of blocks) parts.push(b);
    if (final) parts.push(this.#acc.map((a) => a.slice(0, this.#n - this.#hs)));
    const joined = concatPlanar(parts, this.#channels);
    // Drop the lead-in, and never emit past the expected length.
    let start = 0;
    if (this.#skip > 0) {
      start = Math.min(this.#skip, joined[0]!.length);
      this.#skip -= start;
    }
    let end = joined[0]!.length;
    end = Math.min(end, start + Math.max(0, total - this.#emitted));
    let result = joined.map((ch) => ch.subarray(start, end));
    if (final && this.#emitted + (end - start) < total) {
      const pad = total - this.#emitted - (end - start);
      result = result.map((ch) => {
        const g = new Float32Array(ch.length + pad);
        g.set(ch);
        return g;
      });
    }
    this.#emitted += result[0]!.length;
    return result;
  }

  push(chunk: Float32Array[]): Float32Array[] {
    const n = chunk[0]?.length ?? 0;
    this.#inputFrames += n;
    this.#in.append(chunk);
    const mono = new Float32Array(n);
    for (const ch of chunk) for (let i = 0; i < n; i++) mono[i]! += ch[i]!;
    this.#mono.append([mono]);
    return this.#run(false);
  }

  flush(): Float32Array[] {
    this.#in.appendSilence(this.#n + this.#tol * 2);
    this.#mono.appendSilence(this.#n + this.#tol * 2);
    return this.#run(true);
  }
}

export class TapeResampler implements SpeedProcessor {
  readonly #factor: number;
  readonly #in: Planar;
  readonly #channels: number;
  #j = 0;
  #inputFrames = 0;

  constructor(channels: number, factor: number) {
    this.#channels = channels;
    this.#factor = factor;
    this.#in = new Planar(channels);
  }

  #run(final: boolean): Float32Array[] {
    const available = final ? Math.round(this.#inputFrames / this.#factor) : Math.floor((this.#in.end - 2) / this.#factor);
    const count = Math.max(0, available - this.#j);
    const out = Array.from({ length: this.#channels }, () => new Float32Array(count));
    for (let i = 0; i < count; i++) {
      const x = (this.#j + i) * this.#factor;
      const x0 = Math.floor(x);
      const t = x - x0;
      for (let c = 0; c < this.#channels; c++) {
        out[c]![i] = this.#in.at(c, x0) * (1 - t) + this.#in.at(c, x0 + 1) * t;
      }
    }
    this.#j += count;
    this.#in.discardBefore(Math.floor(this.#j * this.#factor) - 2);
    return out;
  }

  push(chunk: Float32Array[]): Float32Array[] {
    this.#inputFrames += chunk[0]?.length ?? 0;
    this.#in.append(chunk);
    return this.#run(false);
  }

  flush(): Float32Array[] {
    return this.#run(true);
  }
}

function concatPlanar(parts: Float32Array[][], channels: number): Float32Array[] {
  const n = parts.reduce((s, p) => s + (p[0]?.length ?? 0), 0);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  let off = 0;
  for (const p of parts) {
    for (let c = 0; c < channels; c++) out[c]!.set(p[c]!, off);
    off += p[0]?.length ?? 0;
  }
  return out;
}
