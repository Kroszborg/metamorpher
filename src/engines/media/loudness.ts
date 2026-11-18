/**
 * Loudness measurement after ITU-R BS.1770-4 / EBU R128: K-weighting (a high
 * shelf and a high-pass, coefficients derived for any sample rate the way
 * pyloudnorm does), 400 ms blocks with 75% overlap, an absolute gate at -70
 * LUFS and a relative gate 10 LU below. Also tracks the sample peak.
 * Streaming: push planar chunks of any length.
 */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function shelf(rate: number): Biquad {
  const G = 3.99984385397;
  const Q = 0.7071752369554193;
  const fc = 1681.974450955533;
  const K = Math.tan((Math.PI * fc) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.499666774155;
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function highPass(rate: number): Biquad {
  const Q = 0.5003270373253953;
  const fc = 38.13547087613982;
  const K = Math.tan((Math.PI * fc) / rate);
  const a0 = 1 + K / Q + K * K;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
}

/** BS.1770 channel weights by position (L, R, C, LFE, Ls, Rs); LFE is left out. */
function channelWeight(index: number, channels: number): number {
  if (channels >= 6) return [1, 1, 1, 0, 1.41, 1.41][index] ?? 1;
  return 1;
}

export class LoudnessMeter {
  private readonly filters: { f: Biquad; z: Float64Array }[][];
  private readonly step: number;
  private readonly blockSteps = 4;
  /** Weighted mean square of each 100 ms step, summed over channels. */
  private steps: number[] = [];
  private acc = 0;
  private inStep = 0;
  peak = 0;

  constructor(
    private readonly channels: number,
    rate: number,
  ) {
    const s = shelf(rate);
    const h = highPass(rate);
    this.filters = Array.from({ length: channels }, () => [
      { f: s, z: new Float64Array(2) },
      { f: h, z: new Float64Array(2) },
    ]);
    this.step = Math.round(rate / 10);
  }

  push(planes: Float32Array[]): void {
    const n = planes[0]?.length ?? 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < this.channels; c++) {
        const x0 = planes[c]?.[i] ?? 0;
        const a = Math.abs(x0);
        if (a > this.peak) this.peak = a;
        let x = x0;
        for (const st of this.filters[c]!) {
          // Transposed direct form II.
          const y = st.f.b0 * x + st.z[0]!;
          st.z[0] = st.f.b1 * x - st.f.a1 * y + st.z[1]!;
          st.z[1] = st.f.b2 * x - st.f.a2 * y;
          x = y;
        }
        sum += channelWeight(c, this.channels) * x * x;
      }
      this.acc += sum;
      if (++this.inStep === this.step) {
        this.steps.push(this.acc / this.step);
        this.acc = 0;
        this.inStep = 0;
      }
    }
  }

  /** Integrated loudness in LUFS, or null for silence / under 400 ms. */
  integrated(): number | null {
    const blocks: number[] = [];
    for (let i = 0; i + this.blockSteps <= this.steps.length; i++) {
      let s = 0;
      for (let k = 0; k < this.blockSteps; k++) s += this.steps[i + k]!;
      blocks.push(s / this.blockSteps);
    }
    const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
    const loud = blocks.filter((z) => z > 0 && lufs(z) > -70);
    if (!loud.length) return null;
    const mean = loud.reduce((a, b) => a + b, 0) / loud.length;
    const gate = lufs(mean) - 10;
    const kept = loud.filter((z) => lufs(z) > gate);
    return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
  }
}
