// Public types of the MuPDF engine, shared by the main-thread facade, the
// worker and the operation modules. Everything here crosses the worker
// boundary, so it must stay structured-cloneable (plain data, Blobs, typed arrays).

/** A rectangle in PDF page space, top-left origin as MuPDF reports it: [x0, y0, x1, y1] in points. */
export type Box = [number, number, number, number];

/** Four corners (ul, ur, ll, lr) of a possibly rotated text run: [x0,y0, x1,y1, x2,y2, x3,y3]. */
export type QuadPoints = [number, number, number, number, number, number, number, number];

/** An affine matrix [a, b, c, d, e, f] (x' = a·x + c·y + e, y' = b·x + d·y + f). */
export type Matrix = [number, number, number, number, number, number];

export type ProgressFn = (done: number, total: number, note?: string) => void;

// ── Documents ────────────────────────────────────────────────────────────

export type EncryptionInfo = {
  encrypted: boolean;
  /** An open (user) password is required to read the file. */
  needsPassword: boolean;
  /** e.g. "AES-256", "AES-128", "RC4-128". Null when not encrypted. */
  method: string | null;
  /** Permissions granted to someone who opens the file without the owner password. */
  permissions: PermissionSet;
};

export type PermissionSet = {
  print: boolean;
  printHighQuality: boolean;
  copy: boolean;
  edit: boolean;
  annotate: boolean;
  fillForms: boolean;
  accessibility: boolean;
  assemble: boolean;
};

export type PdfInfo = {
  pageCount: number;
  version: string;
  encryption: EncryptionInfo;
  metadata: Record<string, string>;
  /** MuPDF had to reconstruct the cross-reference table while opening. */
  repaired: boolean;
};

export type OpenOptions = { password?: string };

// ── Security ─────────────────────────────────────────────────────────────

export type EncryptOptions = {
  /** Needed to open the file. Empty: anyone can open it, the owner password guards the permissions. */
  userPassword: string;
  /** Needed to change permissions. Required. */
  ownerPassword: string;
  /** What someone with only the user password (or none) may do. */
  permissions: PermissionSet;
  algorithm?: 'aes-256' | 'aes-128';
};

// ── Compression ──────────────────────────────────────────────────────────

export type CompressOptions = {
  /** Re-encode raster images (JPEG). */
  recompressImages: boolean;
  /** Downsample images whose effective resolution on the page exceeds this. Null keeps resolution. */
  maxImageDpi: number | null;
  /** JPEG quality for re-encoded images, 1–100. */
  imageQuality: number;
  /** Convert images to greyscale. */
  grayscaleImages: boolean;
  /** Remove the document info dictionary, XMP metadata, thumbnails and private app data. */
  stripMetadata: boolean;
  /** Keep only the glyphs that are used in embedded fonts. */
  subsetFonts: boolean;
  /** Drop unused objects; 'deduplicate' also merges identical objects (slower). */
  garbage: 'compact' | 'deduplicate';
  /** Pack small objects into compressed object streams (PDF 1.5+). */
  objectStreams: boolean;
  /** Rewrite page content streams compactly (drops redundant operators). */
  cleanContent: boolean;
};

export type CompressStats = {
  inputBytes: number;
  outputBytes: number;
  /** The result was not smaller, so the original bytes were returned unchanged. */
  keptOriginal: boolean;
  imagesTotal: number;
  imagesRecompressed: number;
  imagesDownsampled: number;
  fontsSubset: boolean;
};

// ── Size analysis ────────────────────────────────────────────────────────

export type SizeCategory = 'images' | 'fonts' | 'content' | 'metadata' | 'forms' | 'attachments' | 'structure' | 'other';

export type SizeObject = {
  /** Object number. */
  num: number;
  category: SizeCategory;
  bytes: number;
  /** Human description: "Image 3840×2400 RGB JPEG", "Font Arial (TrueType)". */
  label: string;
  /** Pages (0-based) that use this object, when known. */
  pages: number[];
  /** Images only: effective resolution at the largest placement. */
  dpi?: number;
};

export type SizeReport = {
  fileBytes: number;
  pageCount: number;
  /** Bytes per category, measured from the stored (compressed) stream lengths plus object syntax. */
  categories: Record<SizeCategory, number>;
  /** The largest objects, biggest first. */
  largest: SizeObject[];
  /** Bytes attributable to each page (shared objects split evenly between the pages that use them). */
  pages: { index: number; bytes: number; images: number; fonts: number; content: number }[];
  /** Fonts embedded in full (not subset), with their sizes. */
  fullFonts: { name: string; bytes: number }[];
  /** Images above 300 dpi at their largest placement. */
  highDpiImages: number;
  /** Bytes in unreferenced objects and older revisions (incremental updates). */
  unusedBytes: number;
  revisions: number;
  hasObjectStreams: boolean;
};

// ── Text ─────────────────────────────────────────────────────────────────

export type TextMode = 'plain' | 'layout';

export type TextLine = { text: string; bbox: Box; fontSize: number; font: string };
export type TextBlock = { bbox: Box; lines: TextLine[] };
export type PageText = { index: number; width: number; height: number; blocks: TextBlock[] };

export type SearchHit = { page: number; quads: QuadPoints[]; text: string };

// ── Images ───────────────────────────────────────────────────────────────

export type ExtractImagesOptions = {
  /** Put the transparency mask (SMask) into the PNG alpha channel. */
  applyMasks: boolean;
  /** Convert CMYK images to RGB (otherwise CMYK JPEGs are saved byte-for-byte). */
  cmykToRgb: boolean;
  /** Skip images smaller than this on both sides (icons, spacers). */
  minSize: number;
};

export type ExtractedImage = {
  /** Suggested name without extension, e.g. "page-3-img-12". */
  name: string;
  ext: 'jpg' | 'png' | 'jp2';
  blob: Blob;
  width: number;
  height: number;
  colorspace: string;
  /** How it was saved: the original stream bytes, or decoded to lossless PNG. */
  source: 'original' | 'decoded';
};

// ── Rendering ────────────────────────────────────────────────────────────

export type RenderedPage = {
  index: number;
  /** PNG or JPEG of the page. */
  blob: Blob;
  width: number;
  height: number;
  /** Page size in points (the coordinate space of Box values). */
  pageWidth: number;
  pageHeight: number;
};

export type RawPage = {
  index: number;
  width: number;
  height: number;
  /** 1 (grey) or 3 (RGB) components, no alpha, row-major. */
  components: 1 | 3;
  pixels: Uint8Array<ArrayBuffer>;
};

// ── TIFF ─────────────────────────────────────────────────────────────────

export type TiffOptions = {
  dpi: number;
  /** 'bw' is 1-bit black and white (fax-style). */
  color: 'rgb' | 'gray' | 'bw';
  /** 0-based pages; all when omitted. */
  pages?: number[];
};

// ── Redaction ────────────────────────────────────────────────────────────

/**
 * An area to redact. `box` is in MuPDF page space (top-left origin, like
 * search hits and page text) unless `space` is 'user': PDF user space
 * (bottom-left origin, before /Rotate), which is what the PDF stage reports.
 */
export type RedactionRegion = { page: number; box: Box; space?: 'page' | 'user' };

export type RedactOptions = {
  /** Draw a black box where content was removed (otherwise the area is left blank). */
  fillBlack: boolean;
  /**
   * Also remove document-level hidden data: metadata, XMP, JavaScript, open
   * actions, attachments and thumbnails. (Comments, links and form fields over
   * the boxes are always removed.)
   */
  stripHidden: boolean;
};

export type RedactionCheck = {
  /** Text found under each box before applying (what the user meant to remove). */
  removed: { page: number; text: string }[];
  /** Characters still extractable inside any redaction box after applying. Must be empty. */
  leftInBoxes: { page: number; text: string }[];
  /** Redacted strings that still occur somewhere in the output (outside the boxes), with counts. */
  elsewhere: { text: string; count: number }[];
  passed: boolean;
};

export type RedactResult = { blob: Blob; check: RedactionCheck };

export type FakeRedaction = {
  page: number;
  box: Box;
  /** Text that is still extractable under the covered area. */
  text: string;
  kind: 'vector-box' | 'annotation' | 'image' | 'unapplied-redaction' | 'covered';
};

export type RedactionCheckerReport = {
  pageCount: number;
  findings: FakeRedaction[];
  /** Dark boxes with no recoverable text beneath (look like proper redactions). */
  cleanBoxes: number;
};

// ── Repair ───────────────────────────────────────────────────────────────

export type RepairReport = {
  /**
   * Which strategy produced the output: a MuPDF rewrite, a MuPDF copy of the
   * pages that load, qpdf's reconstruction (then rewritten by MuPDF), or
   * pages rendered to pictures (text lost).
   */
  strategy: 'mupdf' | 'mupdf-pages' | 'qpdf' | 'raster';
  repaired: boolean;
  pagesRecovered: number;
  /** 0-based pages that could not be loaded and were left out. */
  pagesFailed: number[];
  /** What was wrong and what was done, as sentences for the user. */
  notes: string[];
  /** The engine's own warnings (technical), for a details view. */
  messages: string[];
};
