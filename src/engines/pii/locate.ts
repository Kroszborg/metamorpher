// Runs the detectors over positioned characters and turns each match into
// boxes, one per line it touches. Pure, shared by the MuPDF worker (real text)
// and the OCR path (recognised words).
import { type DetectOptions, detectPii, type PiiCategory } from './detectors';

/** [x0, y0, x1, y1] in MuPDF page space (points, top-left origin, as displayed). */
export type PiiBox = [number, number, number, number];

/** One character of page text; line breaks have no box. */
export type PositionedChar = { c: string; box: PiiBox | null; line: number };

export type PiiHit = {
  /** Stable within one scan: page and character offset. */
  id: string;
  page: number;
  category: PiiCategory;
  text: string;
  /** One box per line the match touches, in MuPDF page space. */
  boxes: PiiBox[];
  /** True when the text came from OCR (a scanned page). */
  ocr?: boolean;
};

const JOINERS = /[@._/-]/;

/**
 * Page text with line breaks dropped where a token was wrapped (next to
 * "@", ".", "_", "/" or "-"), and the map back to the original offsets, so
 * "jane.doe@exam-⏎ple.org" style wraps are still found.
 */
function joinedVariant(text: string): { text: string; map: number[] } | null {
  let out = '';
  const map: number[] = [];
  let changed = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (ch === '\n') {
      const prev = text[i - 1] ?? ' ';
      const next = text[i + 1] ?? ' ';
      if (/\S/.test(prev) && /\S/.test(next) && (JOINERS.test(prev) || JOINERS.test(next))) {
        changed = true;
        continue;
      }
    }
    out += ch;
    map.push(i);
  }
  return changed ? { text: out, map } : null;
}

function boxesFor(chars: PositionedChar[], start: number, end: number): PiiBox[] {
  const byLine = new Map<number, PiiBox>();
  for (let i = start; i < end; i += 1) {
    const ch = chars[i];
    if (!ch?.box || !/\S/.test(ch.c)) continue;
    const b = byLine.get(ch.line);
    byLine.set(
      ch.line,
      b ? [Math.min(b[0], ch.box[0]), Math.min(b[1], ch.box[1]), Math.max(b[2], ch.box[2]), Math.max(b[3], ch.box[3])] : [...ch.box],
    );
  }
  return [...byLine.values()];
}

/** Matches on one page, each with its boxes. */
export function locatePii(chars: PositionedChar[], page: number, opts: DetectOptions, ocr = false): PiiHit[] {
  const text = chars.map((c) => (c.c.length === 1 ? c.c : (c.c[0] ?? ' '))).join('');
  const ranges: { category: PiiCategory; start: number; end: number; text: string }[] = [];
  for (const m of detectPii(text, opts)) ranges.push({ category: m.category, start: m.start, end: m.end, text: m.text });
  const joined = joinedVariant(text);
  if (joined) {
    for (const m of detectPii(joined.text, opts)) {
      const start = joined.map[m.start] ?? 0;
      const end = (joined.map[m.end - 1] ?? start) + 1;
      // Keep only what the plain text did not already find.
      if (ranges.some((r) => start < r.end && r.start < end)) continue;
      ranges.push({ category: m.category, start, end, text: m.text });
    }
  }
  const hits: PiiHit[] = [];
  for (const r of ranges.sort((a, b) => a.start - b.start)) {
    const boxes = boxesFor(chars, r.start, r.end);
    if (boxes.length === 0) continue;
    hits.push({
      id: `${page}:${r.start}`,
      page,
      category: r.category,
      text: r.text.replace(/\s+/g, ' ').trim(),
      boxes,
      ...(ocr ? { ocr: true } : {}),
    });
  }
  return hits;
}

/** Recognised words → positioned characters (each word's box split evenly between its characters). */
export function charsFromWords(lines: { words: { text: string; box: PiiBox }[] }[]): PositionedChar[] {
  const out: PositionedChar[] = [];
  lines.forEach((line, li) => {
    line.words.forEach((w, wi) => {
      if (wi > 0) out.push({ c: ' ', box: null, line: li });
      const n = Math.max(1, w.text.length);
      const step = (w.box[2] - w.box[0]) / n;
      for (let i = 0; i < w.text.length; i += 1) {
        out.push({ c: w.text[i] ?? ' ', box: [w.box[0] + step * i, w.box[1], w.box[0] + step * (i + 1), w.box[3]], line: li });
      }
    });
    out.push({ c: '\n', box: null, line: li });
  });
  return out;
}
