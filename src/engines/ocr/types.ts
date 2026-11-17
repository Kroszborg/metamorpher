// Public types of the OCR engine. Everything here crosses worker boundaries,
// so it stays plain data.

/** [x0, y0, x1, y1], top-left origin. Pixels of the recognised image, or points on a page. */
export type OcrBox = [number, number, number, number];

export type OcrWord = { text: string; box: OcrBox; confidence: number };

export type OcrLine = {
  box: OcrBox;
  /** The baseline from (x0, y0) to (x1, y1), when Tesseract reports one. */
  baseline: OcrBox | null;
  words: OcrWord[];
};

export type OcrResult = {
  /** Size of the recognised image in pixels (the coordinate space of every box). */
  width: number;
  height: number;
  /** Plain text, lines and paragraphs as Tesseract laid them out. */
  text: string;
  /** Mean word confidence, 0–100 (0 when nothing was recognised). */
  confidence: number;
  lines: OcrLine[];
};

export type OcrLanguage = {
  /** Tesseract code, e.g. "eng", "hin". */
  code: string;
  label: string;
  /** Size of the gzipped model fetched on first use, in bytes. */
  bytes: number;
};

export type OcrProgress = (fraction: number, note: string) => void;

/** A line of a page's text layer, in MuPDF page space (points, top-left origin, as displayed). */
export type LayerLine = { box: OcrBox; baseline: OcrBox | null; words: { text: string; box: OcrBox }[] };

/** One page as the OCR worker rendered it for recognition. */
export type OcrRender = {
  index: number;
  /** A binary PGM (P5) image, the cheapest format Tesseract reads. */
  image: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** Page size in points as displayed (after /Rotate and the crop box). */
  pageWidth: number;
  pageHeight: number;
};

export type OcrPageInfo = {
  index: number;
  /** Visible characters the page already has as text (0 for a pure scan). */
  textChars: number;
  /** The page's text, when it has some (for text output of pages that are not recognised). */
  text: string;
};

/** A fixed page size for image pages (points); images are fitted inside the margin and centred. */
export type PageSheet = { width: number; height: number; margin: number };
