/** Types shared by the typeset engine (main thread) and its worker. */

export type PageSizeId = 'a4' | 'letter' | 'legal' | 'a3' | 'a5' | 'tabloid';
export type Orientation = 'portrait' | 'landscape';

/** Page geometry in PDF points (1/72 inch). */
export type PageGeometry = {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
};

/** A table the engine lays out itself: measured column widths, header repeated on every page. */
export type TableBlock = {
  kind: 'table';
  /** A heading shown above the table (also a bookmark). */
  title?: string;
  header: string[] | null;
  rows: string[][];
  /** Per column; numbers read best right-aligned. */
  align?: ('left' | 'right' | 'center')[];
  /** Repeat the header row at the top of every page the table continues on. Default true. */
  repeatHeader?: boolean;
  /** Shade every other row. */
  zebra?: boolean;
};

export type Block =
  /** Body HTML (already sanitised; images as data: URLs). Page breaks: `{ kind: 'page-break' }` blocks, or the HTML of PAGE_BREAK in html.ts. */
  | { kind: 'html'; html: string }
  | TableBlock
  | { kind: 'page-break' };

export type TypesetRequest = {
  blocks: Block[];
  /** Stylesheet for the whole document (see theme.ts). */
  css: string;
  page: PageGeometry;
  /**
   * 'auto' turns the page to landscape when a table would not fit across a
   * portrait page but fits across a landscape one.
   */
  orientation?: Orientation | 'auto';
  /** Base font size in points (1em). */
  fontSize: number;
  /** Table text size in points (defaults to fontSize). */
  tableFontSize?: number;
  /** Bookmarks from the document's headings. */
  outline: boolean;
  /** "3 / 12" centred in the bottom margin. */
  pageNumbers: boolean;
  title?: string;
  author?: string;
  /** BCP 47 language tag for the PDF catalog. */
  lang?: string;
  /** Running header and footer drawn in the page margins (Word documents). */
  header?: RunningText;
  footer?: RunningText;
  /**
   * Footnotes set at the bottom of the page that refers to them: the body
   * links to each with `<a href="#mm-fn-<id>">`; space for them is kept free
   * at the bottom of every page.
   */
  footnotes?: { id: string; html: string }[];
};

/**
 * Header or footer HTML per kind of page; `{{PAGE}}` and `{{NUMPAGES}}` in
 * the HTML become the page number and the page count.
 */
export type RunningText = {
  default?: string;
  /** The first page (Word's "different first page"). */
  first?: string;
  /** Even pages (Word's "different odd and even pages"). */
  even?: string;
  /** Distance from the top (header) or bottom (footer) edge of the page, in points. */
  distance: number;
};

export type TypesetResult = {
  blob: Blob;
  pages: number;
  orientation: Orientation;
  /** Bookmarks written. */
  bookmarks: number;
  /** Extra fonts that were embedded (subsetted), by family name. */
  fonts: string[];
  /** Characters no available font could show (a few examples). */
  missing: string[];
};

/** EPUB / FB2 / MOBI / XHTML documents MuPDF lays out itself. */
export type ReflowRequest = {
  page: PageGeometry;
  fontSize: number;
  outline: boolean;
  pageNumbers: boolean;
  /** MIME type that tells MuPDF what the bytes are. */
  magic: string;
  /** Extra CSS on top of the book's own. */
  css?: string;
};

export type ProgressFn = (done: number, total: number, note?: string) => void;

/** A box of text laid out on its own page (for placing into another PDF as a form). */
export type TextBoxRequest = {
  /** Body HTML (sanitised by the caller). */
  html: string;
  /** Page size in points. */
  width: number;
  height: number;
};

export type TextBoxesResult = {
  /** One page per box, fonts subsetted and shared. */
  bytes: Uint8Array<ArrayBuffer>;
  fonts: string[];
  missing: string[];
};

// ── Slides (PowerPoint → PDF) ─────────────────────────────────────────────
// The presentation reader (src/components/doc-tools/pptx.ts) resolves
// masters, layouts, placeholders, themes and styles into this flat model;
// the worker draws it: shapes and pictures with MuPDF's device, every text
// box laid out on its own by MuPDF's HTML engine and placed in its box.

/** sRGB 0–1 and opacity 0–1. */
export type SlideColor = { rgb: [number, number, number]; alpha: number };

export type SlideFill =
  | { kind: 'solid'; color: SlideColor }
  /** Linear (angle in degrees, 0 = left to right, 90 = top to bottom) or radial from the centre. */
  | { kind: 'gradient'; stops: { pos: number; color: SlideColor }[]; angle: number; radial: boolean }
  /** `rect`: left, top, right, bottom insets of the picture as fractions of the box (negative = beyond it). */
  | { kind: 'image'; image: number; alpha: number; rect?: [number, number, number, number] };

export type SlideLine = {
  color: SlideColor;
  /** Points. */
  width: number;
  dash?: number[];
  head?: 'arrow' | 'oval';
  tail?: 'arrow' | 'oval';
};

/** A box on the slide in points (y down), rotated clockwise about its centre, flips applied before rotation. */
export type SlideBox = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean };

/** Path commands in the box's own coordinates (0..w, 0..h). */
export type PathCmd = ['M' | 'L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export type SlideText = {
  /** Body HTML of the text box: paragraphs with inline styles (sanitised, made by the reader). */
  html: string;
  /** Left, top, right, bottom insets in points. */
  inset: [number, number, number, number];
  anchor: 't' | 'ctr' | 'b';
  wrap: boolean;
  /** Text turned 90° clockwise or 270°. */
  vert: 0 | 90 | 270;
  /** Shrink text to fit the box (PowerPoint's "shrink text on overflow"); a number = the scale stored in the file. */
  shrink: boolean | number;
  /** Default text direction of the box. */
  rtl?: boolean;
};

export type SlideTableCell = {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  fill?: SlideFill;
  /** Left, top, right, bottom. */
  borders: [SlideLine | null, SlideLine | null, SlideLine | null, SlideLine | null];
  text: SlideText;
};

export type SlideItem =
  | { kind: 'shape'; box: SlideBox; path?: PathCmd[]; fill?: SlideFill; line?: SlideLine; text?: SlideText }
  | {
      kind: 'image';
      box: SlideBox;
      image: number;
      /** Left, top, right, bottom crop as fractions of the picture (negative = padding). */
      crop?: [number, number, number, number];
      alpha?: number;
      /** Clip to this outline (rounded corners, ellipse …). */
      clip?: PathCmd[];
      line?: SlideLine;
    }
  | { kind: 'table'; box: SlideBox; cols: number[]; rows: number[]; cells: SlideTableCell[] }
  /** Something that is not drawn (a chart without a stored picture …): a labelled frame. */
  | { kind: 'missing'; box: SlideBox; label: string };

export type Slide = { background?: SlideFill; items: SlideItem[]; title?: string; number: number };

export type SlidesRequest = {
  /** Slide size in points. */
  width: number;
  height: number;
  slides: Slide[];
  /** Picture files referred to by index (PNG, JPEG, GIF, BMP, TIFF). */
  images: Uint8Array[];
  /** Bookmarks from the slide titles. */
  outline: boolean;
  title?: string;
  author?: string;
  lang?: string;
};

export type SlidesResult = {
  blob: Blob;
  pages: number;
  bookmarks: number;
  fonts: string[];
  missing: string[];
  /** Pictures MuPDF could not decode (drawn as empty frames). */
  brokenImages: number;
};
