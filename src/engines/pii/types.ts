import type { PiiCategory } from './detectors';
import type { PiiHit } from './locate';

export type PiiScanOptions = {
  categories: PiiCategory[];
  words: string[];
  patterns: string[];
};

export type PiiPage = {
  index: number;
  /** Visible characters of real text (0 for a scanned page without a text layer). */
  textChars: number;
  /** Image XObjects drawn on the page. */
  images: number;
  /** PDF user space → MuPDF page space for this page ([a, b, c, d, e, f]). */
  transform: [number, number, number, number, number, number];
  hits: PiiHit[];
};

/** What a PDF reveals besides its visible pages. */
export type PrivacyReport = {
  pageCount: number;
  /** Document properties (the Info dictionary), every key. Dates as "YYYY-MM-DD hh:mm:ss zone". */
  info: { key: string; value: string }[];
  /** XMP metadata packet: size and the simple fields in it. */
  xmp: { bytes: number; fields: { key: string; value: string }[] } | null;
  /** File identifiers (hex) that can link copies of a document. */
  ids: string[];
  /** Saved revisions; above 1, earlier versions may be recoverable from the file. */
  revisions: number;
  attachments: { name: string; size: number | null; mime: string | null; page: number | null }[];
  javascript: { where: string; snippet: string }[];
  /** Launch, submit, import and remote actions, and non-navigation open actions. */
  actions: { where: string; kind: string }[];
  layers: { name: string; hidden: boolean }[];
  /** Comments and markups (not links or form fields). */
  annotations: { page: number; type: string; author: string; contents: string; date: string | null }[];
  fields: { page: number; name: string; type: string; value: string }[];
  signatures: number;
  fonts: { name: string; type: string; embedded: boolean; subset: boolean }[];
  links: { page: number; uri: string }[];
  thumbnails: number;
  /** Private application data (PieceInfo, e.g. from Illustrator). */
  pieceInfo: boolean;
  /** JPEG pictures and the metadata stored inside them (camera, GPS, software, XMP, IPTC). */
  imageMeta: { images: number; withMeta: number; details: string[] };
  /** Personal data in the text, per category, with a few of the matches. */
  pii: { category: PiiCategory; count: number; examples: string[] }[];
  /** Text still extractable under dark boxes or unapplied redaction marks. */
  covered: { page: number; box: [number, number, number, number]; text: string; kind: string }[];
  coverChecked: boolean;
};

export type CleanOptions = {
  metadata: boolean;
  attachments: boolean;
  javascript: boolean;
  comments: boolean;
  formValues: boolean;
  /** Truly redact text found under dark boxes. */
  covered: boolean;
  /** Content of layers that are hidden by default (cut out of the pages). */
  hiddenLayers: boolean;
  /** EXIF, XMP and IPTC inside JPEG pictures (pixels untouched). */
  imageMetadata: boolean;
  /** The file identifier that links copies and versions of a file. */
  fileId: boolean;
};
