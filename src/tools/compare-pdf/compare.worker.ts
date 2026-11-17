// Compares two PDFs with MuPDF: words with their boxes from both files, a
// word diff over the whole documents, page pairing, page images and a pixel
// difference, and a copy of the new file with the changes highlighted.
import { expose, transfer } from 'comlink';
import type * as M from 'mupdf';
import { type Doc, type Mupdf, bufferToBytes, openPdf, quadBox, writeOptions } from '@/engines/mupdf/ops/common';
import { STEXT_OPTIONS } from '@/engines/mupdf/ops/text';
import { diffWords } from './diff';
import type { Box, Change, CompareOptions, CompareResult, PageMarks, Side, VisualDiff } from './types';

let lib: Promise<Mupdf> | null = null;
function load(): Promise<Mupdf> {
  lib ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/mupdf/mupdf.js', self.location.origin).href
  ) as Promise<typeof M>;
  return lib;
}

type Word = { text: string; page: number; box: Box };
type Loaded = { doc: Doc; words: Word[]; sizes: [number, number][] };
const docs: Partial<Record<Side, Loaded>> = {};

function closeAll() {
  for (const side of ['a', 'b'] as const) {
    docs[side]?.doc.destroy();
    delete docs[side];
  }
}

function extractWords(doc: Doc): { words: Word[]; sizes: [number, number][] } {
  const words: Word[] = [];
  const sizes: [number, number][] = [];
  for (let i = 0; i < doc.countPages(); i += 1) {
    const page = doc.loadPage(i);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      sizes.push([x1 - x0, y1 - y0]);
      let text = '';
      let box: Box | null = null;
      const flush = () => {
        if (text && box) words.push({ text, page: i, box });
        text = '';
        box = null;
      };
      const stext = page.toStructuredText(STEXT_OPTIONS);
      try {
        stext.walk({
          onChar(c, _o, _f, _s, quad) {
            if (/\s/.test(c)) {
              flush();
              return;
            }
            const q = quadBox(quad);
            text += c;
            box = box ? [Math.min(box[0], q[0]), Math.min(box[1], q[1]), Math.max(box[2], q[2]), Math.max(box[3], q[3])] : q;
          },
          endLine() {
            flush();
          },
        });
      } finally {
        stext.destroy();
      }
    } finally {
      page.destroy();
    }
  }
  return { words, sizes };
}

function current(side: Side): Loaded {
  const d = docs[side];
  if (!d) throw new Error('The files are no longer open. Compare again.');
  return d;
}

const snippet = (words: Word[], from: number, to: number) => {
  const s = words.slice(from, Math.min(to, from + 60)).map((w) => w.text).join(' ');
  return to - from > 60 ? `${s} …` : s;
};

/** Merges word boxes on the same line into one box per run. */
function lineBoxes(words: Word[]): { page: number; box: Box }[] {
  const out: { page: number; box: Box }[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    const h = w.box[3] - w.box[1];
    if (
      last &&
      last.page === w.page &&
      Math.abs((last.box[1] + last.box[3]) / 2 - (w.box[1] + w.box[3]) / 2) < h * 0.5 &&
      w.box[0] - last.box[2] < h * 2 &&
      w.box[0] >= last.box[0]
    ) {
      last.box = [last.box[0], Math.min(last.box[1], w.box[1]), Math.max(last.box[2], w.box[2]), Math.max(last.box[3], w.box[3])];
    } else out.push({ page: w.page, box: [...w.box] });
  }
  return out;
}

function renderPixmap(m: Mupdf, side: Side, index: number, scale: number): M.Pixmap {
  const page = current(side).doc.loadPage(index);
  try {
    return page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true);
  } finally {
    page.destroy();
  }
}

/** Renders a page at a pixel size by scaling each axis (pages of different sizes line up). */
function renderToSize(m: Mupdf, side: Side, index: number, width: number, height: number): Uint8Array {
  const page = current(side).doc.loadPage(index);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const pix = page.toPixmap(m.Matrix.scale(width / (x1 - x0), height / (y1 - y0)), m.ColorSpace.DeviceRGB, false, true);
    try {
      const w = pix.getWidth();
      const h = pix.getHeight();
      const stride = pix.getStride();
      const src = pix.getPixels();
      const out = new Uint8Array(width * height * 3).fill(255);
      for (let y = 0; y < Math.min(h, height); y += 1) {
        out.set(src.subarray(y * stride, y * stride + Math.min(w, width) * 3), y * width * 3);
      }
      return out;
    } finally {
      pix.destroy();
    }
  } finally {
    page.destroy();
  }
}

function pngOf(m: Mupdf, rgb: Uint8Array, width: number, height: number): Blob {
  const pix = new m.Pixmap(m.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  try {
    const dst = pix.getPixels();
    const stride = pix.getStride();
    for (let y = 0; y < height; y += 1) dst.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride);
    return new Blob([pix.asPNG().slice()], { type: 'image/png' });
  } finally {
    pix.destroy();
  }
}

const api = {
  async open(a: Blob, b: Blob, passwordA?: string, passwordB?: string): Promise<{ pagesA: number; pagesB: number }> {
    closeAll();
    const m = await load();
    for (const [side, file, pw] of [
      ['a', a, passwordA],
      ['b', b, passwordB],
    ] as const) {
      const doc = openPdf(m, new Uint8Array(await file.arrayBuffer()), pw);
      docs[side] = { doc, ...extractWords(doc) };
    }
    return { pagesA: current('a').sizes.length, pagesB: current('b').sizes.length };
  },

  compare(opts: CompareOptions = { ignoreCase: false, ignorePunctuation: false, ignoreWhitespace: false }): CompareResult {
    const docA = current('a');
    const docB = current('b');
    // The comparison key of a word under the options; words with an empty key are left out.
    const key = (t: string) => {
      let k = opts.ignoreCase ? t.toLocaleLowerCase() : t;
      if (opts.ignorePunctuation) k = k.replace(/[\p{P}\p{S}]/gu, '');
      return k;
    };
    const keep = (w: Word) => key(w.text) !== '';
    const A = { ...docA, words: opts.ignorePunctuation ? docA.words.filter(keep) : docA.words };
    const B = { ...docB, words: opts.ignorePunctuation ? docB.words.filter(keep) : docB.words };
    const ops = diffWords(
      A.words.map((w) => key(w.text)),
      B.words.map((w) => key(w.text)),
    );
    const joined = (words: Word[]) => words.map((w) => key(w.text)).join('');
    const marksA = new Map<number, PageMarks>();
    const marksB = new Map<number, PageMarks>();
    const mark = (map: Map<number, PageMarks>, page: number, box: Box, change: number) => {
      let pm = map.get(page);
      if (!pm) {
        pm = { page, boxes: [] };
        map.set(page, pm);
      }
      pm.boxes.push({ box, change });
    };
    // Pairing votes: equal words shared by page pairs.
    const votes = new Map<string, number>();
    const changes: Change[] = [];
    let removed = 0;
    let added = 0;
    for (let k = 0; k < ops.length; k += 1) {
      const op = ops[k];
      if (!op) continue;
      if (op.kind === 'equal') {
        for (let i = 0; i < op.a1 - op.a0; i += 1) {
          const key = `${A.words[op.a0 + i]?.page}:${B.words[op.b0 + i]?.page}`;
          votes.set(key, (votes.get(key) ?? 0) + 1);
        }
        continue;
      }
      // A change is a run of del/ins ops between equal ones.
      let del = op.kind === 'del' ? op : null;
      let ins = op.kind === 'ins' ? op : null;
      const next = ops[k + 1];
      if (next && next.kind !== 'equal' && next.kind !== op.kind) {
        if (next.kind === 'del') del = next;
        else ins = next;
        k += 1;
      }
      const id = changes.length;
      const aWords = del ? A.words.slice(del.a0, del.a1) : [];
      const bWords = ins ? B.words.slice(ins.b0, ins.b1) : [];
      // The same letters split into words differently: not a change when spacing is ignored.
      if (opts.ignoreWhitespace && aWords.length && bWords.length && joined(aWords) === joined(bWords)) continue;
      removed += aWords.length;
      added += bWords.length;
      for (const r of lineBoxes(aWords)) mark(marksA, r.page, r.box, id);
      for (const r of lineBoxes(bWords)) mark(marksB, r.page, r.box, id);
      // Where the change sits on the other side: the word just before it.
      const aAt = A.words[Math.max(0, (del?.a0 ?? op.a0) - 1)]?.page ?? A.words[del?.a0 ?? op.a0]?.page ?? 0;
      const bAt = B.words[Math.max(0, (ins?.b0 ?? op.b0) - 1)]?.page ?? B.words[ins?.b0 ?? op.b0]?.page ?? 0;
      changes.push({
        id,
        pageA: aWords[0]?.page ?? aAt,
        pageB: bWords[0]?.page ?? bAt,
        removed: del ? snippet(A.words, del.a0, del.a1) : '',
        added: ins ? snippet(B.words, ins.b0, ins.b1) : '',
        removedWords: aWords.length,
        addedWords: bWords.length,
      });
    }
    // For every page of A, the B page sharing most words with it (and the reverse).
    const bestB = new Map<number, [number, number]>();
    const bestA = new Map<number, [number, number]>();
    for (const [key, n] of votes) {
      const [pa = 0, pb = 0] = key.split(':').map(Number);
      if ((bestB.get(pa)?.[1] ?? 0) < n) bestB.set(pa, [pb, n]);
      if ((bestA.get(pb)?.[1] ?? 0) < n) bestA.set(pb, [pa, n]);
    }
    const pairOfA = A.sizes.map((_, i) => bestB.get(i)?.[0] ?? (i < B.sizes.length ? i : null));
    const pairOfB = B.sizes.map((_, i) => bestA.get(i)?.[0] ?? (i < A.sizes.length ? i : null));
    return {
      pagesA: A.sizes.map(([w, h], i) => ({ width: w, height: h, words: docA.words.filter((x) => x.page === i).length })),
      pagesB: B.sizes.map(([w, h], i) => ({ width: w, height: h, words: docB.words.filter((x) => x.page === i).length })),
      marksA: [...marksA.values()],
      marksB: [...marksB.values()],
      changes,
      pairOfA,
      pairOfB,
      stats: { wordsA: docA.words.length, wordsB: docB.words.length, removed, added },
    };
  },

  async render(side: Side, index: number, scale: number): Promise<Blob> {
    const m = await load();
    const pix = renderPixmap(m, side, index, scale);
    try {
      return new Blob([pix.asPNG().slice()], { type: 'image/png' });
    } finally {
      pix.destroy();
    }
  },

  /**
   * Pixel comparison of page `a` of the old file and page `b` of the new one,
   * both drawn at `width` pixels wide (the new page is stretched to the old
   * page's shape). `overlay`: old in red, new in cyan, unchanged in grey.
   * `difference`: changed pixels in magenta over a faded old page.
   */
  async visual(a: number, b: number, width: number): Promise<VisualDiff> {
    const m = await load();
    const [wa, ha] = current('a').sizes[a] ?? [595, 842];
    const height = Math.max(1, Math.round((width * ha) / wa));
    const pa = renderToSize(m, 'a', a, width, height);
    const pb = renderToSize(m, 'b', b, width, height);
    const n = width * height;
    const overlay = new Uint8Array(n * 3);
    const diff = new Uint8Array(n * 3);
    let changed = 0;
    const cell = 16;
    const gw = Math.ceil(width / cell);
    const grid = new Uint16Array(gw * Math.ceil(height / cell));
    for (let i = 0; i < n; i += 1) {
      const la = ((pa[i * 3] ?? 0) * 3 + (pa[i * 3 + 1] ?? 0) * 6 + (pa[i * 3 + 2] ?? 0)) / 10;
      const lb = ((pb[i * 3] ?? 0) * 3 + (pb[i * 3 + 1] ?? 0) * 6 + (pb[i * 3 + 2] ?? 0)) / 10;
      const delta =
        Math.abs((pa[i * 3] ?? 0) - (pb[i * 3] ?? 0)) + Math.abs((pa[i * 3 + 1] ?? 0) - (pb[i * 3 + 1] ?? 0)) + Math.abs((pa[i * 3 + 2] ?? 0) - (pb[i * 3 + 2] ?? 0));
      overlay[i * 3] = lb;
      overlay[i * 3 + 1] = la;
      overlay[i * 3 + 2] = la;
      if (delta > 96) {
        changed += 1;
        const x = i % width;
        const y = (i / width) | 0;
        const g = ((y / cell) | 0) * gw + ((x / cell) | 0);
        grid[g] = (grid[g] ?? 0) + 1;
        diff[i * 3] = 230;
        diff[i * 3 + 1] = 0;
        diff[i * 3 + 2] = 160;
      } else {
        const f = 255 - (255 - la) * 0.25;
        diff[i * 3] = f;
        diff[i * 3 + 1] = f;
        diff[i * 3 + 2] = f;
      }
    }
    // Changed regions: grid cells with a few changed pixels, merged into boxes (fraction of the page).
    const regions: Box[] = [];
    for (let g = 0; g < grid.length; g += 1) {
      if ((grid[g] ?? 0) < 4) continue;
      const x = (g % gw) * cell;
      const y = ((g / gw) | 0) * cell;
      const box: Box = [x / width, y / height, Math.min(1, (x + cell) / width), Math.min(1, (y + cell) / height)];
      const near = regions.find((r) => box[0] <= r[2] + 0.02 && box[2] >= r[0] - 0.02 && box[1] <= r[3] + 0.02 && box[3] >= r[1] - 0.02);
      if (near) {
        near[0] = Math.min(near[0], box[0]);
        near[1] = Math.min(near[1], box[1]);
        near[2] = Math.max(near[2], box[2]);
        near[3] = Math.max(near[3], box[3]);
      } else regions.push(box);
    }
    // Merge regions until none overlap (growing boxes can swallow earlier ones).
    for (let merged = true; merged; ) {
      merged = false;
      for (let i = 0; i < regions.length && !merged; i += 1) {
        for (let j = i + 1; j < regions.length; j += 1) {
          const r = regions[i];
          const q = regions[j];
          if (!r || !q || q[0] > r[2] + 0.01 || q[2] < r[0] - 0.01 || q[1] > r[3] + 0.01 || q[3] < r[1] - 0.01) continue;
          regions[i] = [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[2]), Math.max(r[3], q[3])];
          regions.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
    return {
      width,
      height,
      overlay: pngOf(m, overlay, width, height),
      difference: pngOf(m, diff, width, height),
      changedFraction: changed / n,
      regions: regions.slice(0, 200),
    };
  },

  /** A page image with change boxes painted in (for the report), as JPEG. */
  async markedImage(side: Side, index: number, scale: number, boxes: Box[]): Promise<{ jpeg: Uint8Array<ArrayBuffer>; width: number; height: number }> {
    const m = await load();
    const pix = renderPixmap(m, side, index, scale);
    try {
      const w = pix.getWidth();
      const h = pix.getHeight();
      const stride = pix.getStride();
      const px = pix.getPixels();
      const tint = side === 'a' ? [235, 64, 64] : [40, 170, 90];
      for (const b of boxes) {
        const x0 = Math.max(0, Math.floor(b[0] * scale) - 1);
        const y0 = Math.max(0, Math.floor(b[1] * scale) - 1);
        const x1 = Math.min(w, Math.ceil(b[2] * scale) + 1);
        const y1 = Math.min(h, Math.ceil(b[3] * scale) + 1);
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const o = y * stride + x * 3;
            for (let c = 0; c < 3; c += 1) px[o + c] = Math.round((px[o + c] ?? 0) * 0.6 + (tint[c] ?? 0) * 0.4);
          }
        }
      }
      const jpeg = pix.asJPEG(80, false).slice();
      return transfer({ jpeg, width: w, height: h }, [jpeg.buffer]);
    } finally {
      pix.destroy();
    }
  },

  /** A copy of one file with its changed words highlighted as annotations (red: removed, green: added). */
  async highlighted(side: Side, marks: PageMarks[]): Promise<Blob> {
    const m = await load();
    const src = current(side).doc;
    const doc = openPdf(m, bufferToBytes(src.saveToBuffer(writeOptions({ encrypt: 'no' }))));
    try {
      const color: [number, number, number] = side === 'a' ? [0.95, 0.3, 0.3] : [0.3, 0.85, 0.45];
      for (const pm of marks) {
        const page = doc.loadPage(pm.page);
        try {
          for (const { box } of pm.boxes) {
            const annot = page.createAnnotation(side === 'a' ? 'StrikeOut' : 'Highlight');
            annot.setColor(color);
            annot.setQuadPoints([[box[0], box[1], box[2], box[1], box[0], box[3], box[2], box[3]]]);
            annot.setContents(side === 'a' ? 'Removed in the new version' : 'Added in the new version');
            annot.update();
          }
        } finally {
          page.destroy();
        }
      }
      return new Blob([bufferToBytes(doc.saveToBuffer(writeOptions({ encrypt: 'no' })))], { type: 'application/pdf' });
    } finally {
      doc.destroy();
    }
  },

  close(): void {
    closeAll();
  },
};

export type CompareWorkerApi = typeof api;

expose(api);
