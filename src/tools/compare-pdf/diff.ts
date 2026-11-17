// Word-level diff for long documents: common prefix/suffix, patience anchors
// (words that occur once on both sides, in increasing order), and Myers' O(ND)
// diff for the small gaps between anchors. Pure, no imports.

export type DiffOp = { kind: 'equal' | 'del' | 'ins'; a0: number; a1: number; b0: number; b1: number };

/** Myers diff of a[a0..a1) and b[b0..b1); gives up (one replace) past `maxD` edits. */
function myers(a: Int32Array, a0: number, a1: number, b: Int32Array, b0: number, b1: number, out: DiffOp[], maxD = 2000): void {
  const n = a1 - a0;
  const m = b1 - b0;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[off + k - 1] ?? 0) < (v[off + k + 1] ?? 0)) ? (v[off + k + 1] ?? 0) : (v[off + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x += 1;
        y += 1;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) {
    if (n) out.push({ kind: 'del', a0, a1, b0, b1: b0 });
    if (m) out.push({ kind: 'ins', a0: a1, a1, b0, b1 });
    return;
  }
  // Backtrack.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const vd = trace[d] ?? v;
    const k = x - y;
    const down = k === -d || (k !== d && (vd[off + k - 1] ?? 0) < (vd[off + k + 1] ?? 0));
    const pk = down ? k + 1 : k - 1;
    const px = vd[off + pk] ?? 0;
    const py = px - pk;
    const sx = down ? px : px + 1;
    const sy = down ? py + 1 : py;
    if (x > sx) ops.push({ kind: 'equal', a0: a0 + sx, a1: a0 + x, b0: b0 + sy, b1: b0 + y });
    if (down) ops.push({ kind: 'ins', a0: a0 + px, a1: a0 + px, b0: b0 + py, b1: b0 + py + 1 });
    else ops.push({ kind: 'del', a0: a0 + px, a1: a0 + px + 1, b0: b0 + py, b1: b0 + py });
    x = px;
    y = py;
  }
  if (x > 0) ops.push({ kind: 'equal', a0, a1: a0 + x, b0, b1: b0 + y });
  out.push(...ops.reverse());
}

/** Longest increasing subsequence of `seq` (indices into seq). */
function lis(seq: number[]): number[] {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i += 1) {
    const v = seq[i] ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((seq[tails[mid] ?? 0] ?? 0) < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] ?? -1;
    tails[lo] = i;
  }
  const out: number[] = [];
  for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = prev[i] ?? -1) out.push(i);
  return out.reverse();
}

function diffRange(a: Int32Array, a0: number, a1: number, b: Int32Array, b0: number, b1: number, out: DiffOp[], depth: number): void {
  // Common prefix and suffix.
  let s = 0;
  while (a0 + s < a1 && b0 + s < b1 && a[a0 + s] === b[b0 + s]) s += 1;
  if (s) out.push({ kind: 'equal', a0, a1: a0 + s, b0, b1: b0 + s });
  a0 += s;
  b0 += s;
  let e = 0;
  while (a1 - e > a0 && b1 - e > b0 && a[a1 - e - 1] === b[b1 - e - 1]) e += 1;
  const tail: DiffOp | null = e ? { kind: 'equal', a0: a1 - e, a1, b0: b1 - e, b1 } : null;
  a1 -= e;
  b1 -= e;
  if (a0 === a1 || b0 === b1) {
    if (a1 > a0) out.push({ kind: 'del', a0, a1, b0, b1: b0 });
    if (b1 > b0) out.push({ kind: 'ins', a0: a1, a1, b0, b1 });
  } else if ((a1 - a0) * (b1 - b0) <= 4_000_000 || depth > 40) {
    myers(a, a0, a1, b, b0, b1, out);
  } else {
    // Patience anchors: tokens occurring exactly once in each range.
    const countA = new Map<number, number>();
    const posB = new Map<number, number>();
    const countB = new Map<number, number>();
    for (let i = a0; i < a1; i += 1) countA.set(a[i] ?? 0, (countA.get(a[i] ?? 0) ?? 0) + 1);
    for (let j = b0; j < b1; j += 1) {
      const t = b[j] ?? 0;
      countB.set(t, (countB.get(t) ?? 0) + 1);
      posB.set(t, j);
    }
    const pairsA: number[] = [];
    const pairsB: number[] = [];
    for (let i = a0; i < a1; i += 1) {
      const t = a[i] ?? 0;
      if (countA.get(t) === 1 && countB.get(t) === 1) {
        pairsA.push(i);
        pairsB.push(posB.get(t) ?? 0);
      }
    }
    const chain = lis(pairsB);
    if (chain.length === 0) {
      myers(a, a0, a1, b, b0, b1, out);
    } else {
      let pa = a0;
      let pb = b0;
      for (const c of chain) {
        const ia = pairsA[c] ?? 0;
        const ib = pairsB[c] ?? 0;
        diffRange(a, pa, ia, b, pb, ib, out, depth + 1);
        out.push({ kind: 'equal', a0: ia, a1: ia + 1, b0: ib, b1: ib + 1 });
        pa = ia + 1;
        pb = ib + 1;
      }
      diffRange(a, pa, a1, b, pb, b1, out, depth + 1);
    }
  }
  if (tail) out.push(tail);
}

/** Merges neighbouring ops of the same kind. */
function compact(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    if (op.a0 === op.a1 && op.b0 === op.b1) continue;
    const last = out[out.length - 1];
    if (last && last.kind === op.kind && last.a1 === op.a0 && last.b1 === op.b0) {
      last.a1 = op.a1;
      last.b1 = op.b1;
    } else out.push({ ...op });
  }
  return out;
}

/** Word diff of two token lists (any strings; compared exactly). */
export function diffWords(a: readonly string[], b: readonly string[]): DiffOp[] {
  const ids = new Map<string, number>();
  const intern = (list: readonly string[]) => Int32Array.from(list, (w) => {
    let id = ids.get(w);
    if (id === undefined) {
      id = ids.size;
      ids.set(w, id);
    }
    return id;
  });
  const ia = intern(a);
  const ib = intern(b);
  const out: DiffOp[] = [];
  diffRange(ia, 0, ia.length, ib, 0, ib.length, out, 0);
  return compact(out);
}
