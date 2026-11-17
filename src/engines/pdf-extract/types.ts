/** What the extraction worker reads out of a PDF page (points, top-left origin). */

export type Rect = [number, number, number, number];

export type Span = {
  text: string;
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  /** "#rrggbb" */
  color: string;
  bbox?: Rect;
};

export type Line = { bbox: Rect; spans: Span[] };

export type TextBlock = { kind: 'text'; bbox: Rect; lines: Line[] };
export type ImageBlock = { kind: 'image'; bbox: Rect; bytes: Uint8Array<ArrayBuffer>; mime: 'image/png' | 'image/jpeg'; px: [number, number] };

export type RawPage = {
  width: number;
  height: number;
  blocks: (TextBlock | ImageBlock)[];
  links: { bbox: Rect; uri: string }[];
  /** Thin horizontal and vertical lines (table rules), page space. */
  rules?: Rect[];
  /** Words with their boxes (tables). */
  words?: Word[];
};

/** A word with its box, for table detection. */
export type Word = { text: string; bbox: Rect; size: number; bold: boolean };
export type WordPage = { width: number; height: number; words: Word[]; rules?: Rect[] };

export type ExtractProgress = (done: number, total: number, note?: string) => void;
