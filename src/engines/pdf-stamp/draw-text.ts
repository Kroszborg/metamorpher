import {
  beginText,
  endText,
  type PDFOperator,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
} from '@cantoo/pdf-lib';
import type { PDFName } from '@cantoo/pdf-lib';
import type { TextFont } from './fonts';

export function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = Number.parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** One line of text with its baseline starting at (x, y) in the current coordinate system. */
export function textOps(
  key: PDFName,
  font: TextFont,
  text: string,
  size: number,
  x: number,
  y: number,
  color: string,
): PDFOperator[] {
  const [r, g, b] = parseColor(color);
  return [
    beginText(),
    setFontAndSize(key, size),
    setFillingRgbColor(r, g, b),
    setTextMatrix(1, 0, 0, 1, x, y),
    showText(font.encode(text)),
    endText(),
  ];
}
