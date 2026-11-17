export type Side = 'a' | 'b';

/** What the text comparison overlooks. */
export type CompareOptions = {
  ignoreCase: boolean;
  /** Punctuation and symbols (a word that is only punctuation is skipped). */
  ignorePunctuation: boolean;
  /** Spacing, line breaks and words split or joined differently ("data base" = "database"). */
  ignoreWhitespace: boolean;
};

/** [x0, y0, x1, y1] in MuPDF page space (points, top-left origin, as displayed). */
export type Box = [number, number, number, number];

/** Changed words on one page, one box per line run, tagged with the change they belong to. */
export type PageMarks = { page: number; boxes: { box: Box; change: number }[] };

export type Change = {
  id: number;
  /** Page of the old file where the change is (or would be, for pure additions). */
  pageA: number;
  pageB: number;
  removed: string;
  added: string;
  removedWords: number;
  addedWords: number;
};

export type CompareResult = {
  pagesA: { width: number; height: number; words: number }[];
  pagesB: { width: number; height: number; words: number }[];
  marksA: PageMarks[];
  marksB: PageMarks[];
  changes: Change[];
  /** For each old page, the new page with the most text in common (null when there is none). */
  pairOfA: (number | null)[];
  pairOfB: (number | null)[];
  stats: { wordsA: number; wordsB: number; removed: number; added: number };
};

export type VisualDiff = {
  width: number;
  height: number;
  overlay: Blob;
  difference: Blob;
  /** Share of pixels that differ clearly. */
  changedFraction: number;
  /** Changed areas as fractions of the page ([x0, y0, x1, y1] in 0–1). */
  regions: Box[];
};
