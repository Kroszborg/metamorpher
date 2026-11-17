/**
 * Colour described by CICP code points (an nclx 'colr' box in HEIC/AVIF)
 * instead of an embedded ICC profile. Phones and encoders often tag Display
 * P3 or BT.2020 photos this way; without the profile the pixels would be read
 * as sRGB and look dull. This builds the matching ICC profile (matrix/TRC,
 * version 2.1) so the rest of the engine handles them like any tagged image.
 *
 * Transfer: sRGB (13) and the BT.709 family (1, 6, 14, 15) use the sRGB curve,
 * as Chrome does when it shows these files; 4 is gamma 2.2 and 8 linear. PQ
 * and HLG (HDR) are not handled here (no profile is made).
 */

export type Nclx = { primaries: number; transfer: number; matrix: number; fullRange: boolean };

type Xy = [number, number];
const D65: Xy = [0.3127, 0.329];
const PRIMARIES: Record<number, { name: string; rgb: [Xy, Xy, Xy] }> = {
  12: { name: 'Display P3', rgb: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]] },
  9: { name: 'Rec. ITU-R BT.2020', rgb: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]] },
};

type Mat = [number, number, number, number, number, number, number, number, number];

const mul = (a: Mat, b: Mat): Mat => {
  const o = new Array<number>(9).fill(0) as Mat;
  for (let r = 0; r < 3; r += 1)
    for (let c = 0; c < 3; c += 1) {
      let s = 0;
      for (let k = 0; k < 3; k += 1) s += (a[r * 3 + k] ?? 0) * (b[k * 3 + c] ?? 0);
      o[r * 3 + c] = s;
    }
  return o;
};
const apply = (m: Mat, v: [number, number, number]): [number, number, number] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
function inverse(m: Mat): Mat {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(
    (x) => x / det,
  ) as Mat;
}
const xyz = ([x, y]: Xy): [number, number, number] => [x / y, 1, (1 - x - y) / y];

/** RGB → XYZ (D50, Bradford-adapted from D65) for the primaries. */
function rgbToXyzD50(rgb: [Xy, Xy, Xy]): Mat {
  const [r, g, b] = rgb.map(xyz) as [[number, number, number], [number, number, number], [number, number, number]];
  const P: Mat = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  const s = apply(inverse(P), xyz(D65));
  const M65: Mat = [P[0] * s[0], P[1] * s[1], P[2] * s[2], P[3] * s[0], P[4] * s[1], P[5] * s[2], P[6] * s[0], P[7] * s[1], P[8] * s[2]];
  const brad: Mat = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  const src = apply(brad, xyz(D65));
  const dst = apply(brad, [0.9642, 1, 0.8249]);
  const scale: Mat = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  return mul(mul(mul(inverse(brad), scale), brad), M65);
}

function curve(transfer: number): ((v: number) => number) | null {
  if ([1, 6, 13, 14, 15].includes(transfer)) return (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  if (transfer === 4) return (v) => v ** 2.2;
  if (transfer === 8) return (v) => v;
  return null;
}

/** Whether the code points describe something other than sRGB that a profile can express. */
export function nclxIsWide(n: Nclx): boolean {
  return n.primaries in PRIMARIES && curve(n.transfer) !== null;
}

/** A display ICC profile for the nclx code points, or undefined (sRGB, unknown, or HDR transfer). */
export function iccFromNclx(n: Nclx): Uint8Array | undefined {
  const prim = PRIMARIES[n.primaries];
  const trc = curve(n.transfer);
  if (!prim || !trc) return undefined;
  const m = rgbToXyzD50(prim.rgb);
  const name = `${prim.name} (from the file's colour tags)`;

  const tags: [string, Uint8Array][] = [];
  const text = (s: string) => {
    // textDescriptionType: ASCII part, empty Unicode and ScriptCode parts.
    const a = new Uint8Array(12 + s.length + 1 + 8 + 3 + 67);
    a.set([0x64, 0x65, 0x73, 0x63]);
    new DataView(a.buffer).setUint32(8, s.length + 1);
    for (let i = 0; i < s.length; i += 1) a[12 + i] = s.charCodeAt(i) & 0x7f;
    return a;
  };
  const xyzTag = (v: [number, number, number]) => {
    const a = new Uint8Array(20);
    a.set([0x58, 0x59, 0x5a, 0x20]);
    const view = new DataView(a.buffer);
    v.forEach((x, i) => view.setInt32(8 + i * 4, Math.round(x * 65536)));
    return a;
  };
  const N = 1024;
  const curv = new Uint8Array(12 + N * 2);
  curv.set([0x63, 0x75, 0x72, 0x76]);
  const cv = new DataView(curv.buffer);
  cv.setUint32(8, N);
  for (let i = 0; i < N; i += 1) cv.setUint16(12 + i * 2, Math.round(Math.min(1, Math.max(0, trc(i / (N - 1)))) * 65535));
  const copyright = new Uint8Array(8 + 13);
  copyright.set([0x74, 0x65, 0x78, 0x74]);
  for (const [i, ch] of [...'No copyright'].entries()) copyright[8 + i] = ch.charCodeAt(0);

  tags.push(['desc', text(name)]);
  tags.push(['cprt', copyright]);
  tags.push(['wtpt', xyzTag([0.9642, 1, 0.8249])]);
  tags.push(['rXYZ', xyzTag([m[0], m[3], m[6]])]);
  tags.push(['gXYZ', xyzTag([m[1], m[4], m[7]])]);
  tags.push(['bXYZ', xyzTag([m[2], m[5], m[8]])]);
  tags.push(['rTRC', curv]);

  // Layout: header, tag table, tag data (4-byte aligned); gTRC and bTRC share rTRC's data.
  const count = tags.length + 2;
  let offset = 128 + 4 + count * 12;
  const entries: { sig: string; off: number; len: number }[] = [];
  for (const [sig, data] of tags) {
    entries.push({ sig, off: offset, len: data.length });
    offset += (data.length + 3) & ~3;
  }
  const trcEntry = entries.find((e) => e.sig === 'rTRC');
  if (trcEntry) entries.push({ ...trcEntry, sig: 'gTRC' }, { ...trcEntry, sig: 'bTRC' });
  const out = new Uint8Array(offset);
  const v = new DataView(out.buffer);
  const sig = (o: number, s: string) => {
    for (let i = 0; i < 4; i += 1) out[o + i] = s.charCodeAt(i);
  };
  v.setUint32(0, offset);
  v.setUint32(8, 0x02100000); // version 2.1
  sig(12, 'mntr');
  sig(16, 'RGB ');
  sig(20, 'XYZ ');
  v.setUint16(24, 2024);
  v.setUint16(26, 1);
  v.setUint16(28, 1);
  sig(36, 'acsp');
  v.setInt32(68, Math.round(0.9642 * 65536));
  v.setInt32(72, 65536);
  v.setInt32(76, Math.round(0.8249 * 65536));
  v.setUint32(128, count);
  entries.forEach((e, i) => {
    sig(132 + i * 12, e.sig);
    v.setUint32(136 + i * 12, e.off);
    v.setUint32(140 + i * 12, e.len);
  });
  tags.forEach(([, data], i) => out.set(data, entries[i]?.off ?? 0));
  return out;
}
