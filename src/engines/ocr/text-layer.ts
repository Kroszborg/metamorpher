// Builds the content stream of an invisible OCR text layer. Pure functions,
// no imports with side effects, so it runs in workers and under node tests.
import { FONT_DESCENT, GLYPH_ADVANCE } from './glyphless';
import type { LayerLine, OcrBox, OcrLine, OcrResult } from './types';

type Matrix = [number, number, number, number, number, number];

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** UTF-16 code units as 4-digit hex: the character codes of the glyphless Identity-H font. */
export function hexCodes(text: string): string {
  let s = '';
  for (let i = 0; i < text.length; i += 1) s += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return s;
}

export function invertMatrix([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c || 1;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** a × b: apply a, then b (PDF row-vector convention). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/** Recognised lines (image pixels) → page-space lines (points), dropping empty words. */
export function toPageLines(result: OcrResult, pageWidth: number, pageHeight: number): LayerLine[] {
  const sx = pageWidth / Math.max(1, result.width);
  const sy = pageHeight / Math.max(1, result.height);
  const box = (b: OcrBox): OcrBox => [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy];
  const out: LayerLine[] = [];
  for (const line of result.lines) {
    const words = line.words
      .map((w) => ({ text: w.text.replace(/\s+/g, ' ').trim(), box: box(w.box) }))
      .filter((w) => w.text.length > 0 && w.box[2] > w.box[0] && w.box[3] > w.box[1]);
    if (words.length === 0) continue;
    out.push({ box: box(line.box), baseline: line.baseline ? box(line.baseline) : null, words });
  }
  return out;
}

/** Quarter turns clockwise a line is drawn at: 0 reads left to right, 90 top to bottom, 180 upside down, 270 bottom to top. */
export type Turn = 0 | 90 | 180 | 270;

/** The direction of a line, from the baseline Tesseract reports (pages scanned sideways have vertical lines). */
export function lineTurn(line: { baseline: OcrBox | null }): Turn {
  const b = line.baseline;
  if (!b) return 0;
  const dx = b[2] - b[0];
  const dy = b[3] - b[1];
  if (Math.abs(dy) > Math.abs(dx) * 2) return dy > 0 ? 90 : 270;
  if (dx < 0 && Math.abs(dx) > Math.abs(dy) * 2) return 180;
  return 0;
}

/** Page point → the frame in which a line of turn `t` reads upright. */
function toUpright(t: Turn, x: number, y: number): [number, number] {
  if (t === 90) return [y, -x];
  if (t === 180) return [-x, -y];
  if (t === 270) return [-y, x];
  return [x, y];
}

/** That frame → page space. */
const FROM_UPRIGHT: Record<Turn, Matrix> = {
  0: [1, 0, 0, 1, 0, 0],
  90: [0, 1, -1, 0, 0, 0],
  180: [-1, 0, 0, -1, 0, 0],
  270: [0, -1, 1, 0, 0, 0],
};

function uprightBox(t: Turn, b: OcrBox): OcrBox {
  const [ax, ay] = toUpright(t, b[0], b[1]);
  const [bx, by] = toUpright(t, b[2], b[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

function uprightLine(t: Turn, line: LayerLine): LayerLine {
  if (t === 0) return line;
  let baseline: OcrBox | null = null;
  if (line.baseline) {
    const [x0, y0] = toUpright(t, line.baseline[0], line.baseline[1]);
    const [x1, y1] = toUpright(t, line.baseline[2], line.baseline[3]);
    baseline = [x0, y0, x1, y1];
  }
  return { box: uprightBox(t, line.box), baseline, words: line.words.map((w) => ({ text: w.text, box: uprightBox(t, w.box) })) };
}

/** The y of the baseline under `x`, from the line's baseline segment or its box (upright frame). */
function baselineAt(line: LayerLine, x: number, height: number): number {
  const b = line.baseline;
  if (b && b[2] !== b[0]) {
    const t = (x - b[0]) / (b[2] - b[0]);
    const y = b[1] + (b[3] - b[1]) * t;
    // A baseline outside the line box is a misreport: fall back to the box.
    if (y > line.box[1] && y <= line.box[3] + height * 0.1) return y;
  }
  return line.box[3] - FONT_DESCENT * height;
}

/**
 * Content-stream operators that draw `lines` as invisible text (render mode
 * 3) with font `font` (the glyphless font). `pageToUser` maps MuPDF page space
 * (top-left origin, as displayed) to the PDF user space the content stream
 * draws in, so rotated pages and offset crop boxes come out right. Lines that
 * run down, up or upside down on the page are written in their own direction.
 *
 * Each word is stretched to its box; a space after a word is stretched to
 * reach the next word, so extracted text has its spaces and words line up
 * with the picture.
 */
export function textLayerOps(lines: LayerLine[], font: string, pageToUser: Matrix): string {
  if (lines.length === 0) return '';
  const out: string[] = ['q', `${pageToUser.map(num).join(' ')} cm`, 'BT', '3 Tr', `/${font} 1 Tf`];
  for (const original of lines) {
    const turn = lineTurn(original);
    const line = uprightLine(turn, original);
    const words = [...line.words].sort((a, b) => a.box[0] - b.box[0]);
    const tallest = Math.max(...words.map((w) => w.box[3] - w.box[1]));
    let height = line.box[3] - line.box[1];
    // A slanted line's box is taller than its words; size the text by the words then.
    if (height > tallest * 1.6) height = tallest;
    if (!(height > 0)) continue;
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      if (!w) continue;
      const next = words[i + 1];
      const reach = next && next.box[0] > w.box[0] + 1e-3 ? next.box[0] - w.box[0] : 0;
      const text = reach ? `${w.text} ` : w.text;
      const width = reach || w.box[2] - w.box[0];
      const scaleX = width / (text.length * GLYPH_ADVANCE);
      if (!(scaleX > 0) || !Number.isFinite(scaleX)) continue;
      const y = baselineAt(line, (w.box[0] + w.box[2]) / 2, height);
      const tm = multiply([scaleX, 0, 0, -height, w.box[0], y], FROM_UPRIGHT[turn]);
      out.push(`${tm.map(num).join(' ')} Tm <${hexCodes(text)}> Tj`);
    }
  }
  out.push('ET', 'Q');
  return `${out.join('\n')}\n`;
}

/** Plain text of recognised lines, one line of words per line. */
export function linesText(lines: OcrLine[]): string {
  return lines.map((l) => l.words.map((w) => w.text).join(' ')).join('\n');
}
