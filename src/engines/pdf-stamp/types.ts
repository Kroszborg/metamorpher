/** Option shapes shared by the tools (main thread) and the stamping worker. Structured-clone safe. */
import type { FontFamily } from './fonts';
import type { Placement } from './geometry';
import type { BatesFormat, NumberStyle } from './text-format';

export type { FontFamily } from './fonts';

/** Six text slots: top/bottom × left/centre/right. */
export type SlotId = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export const SLOT_IDS: readonly SlotId[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

export type TextStyle = {
  font: FontFamily;
  bold: boolean;
  /** Points. */
  size: number;
  /** "#rrggbb". */
  color: string;
};

/** Page numbers, Bates numbers and headers/footers. */
export type TextStampSpec = TextStyle & {
  /** Templates per slot, with {page} {total} {date} {filename} {bates}. Empty slots are skipped. */
  slots: Partial<Record<SlotId, string>>;
  /** Distance from the visible page edge, in points. */
  marginX: number;
  marginY: number;
  /** Page range such as "1-3, 7"; empty for every page. */
  pages: string;
  /** Leading pages left unstamped. */
  skipFirst: number;
  /**
   * 'stamped': {page} counts stamped pages from `startNumber`, {total} is the last number printed.
   * 'document': {page} is the physical page number + startNumber − 1, {total} the page count.
   */
  counting: 'stamped' | 'document';
  startNumber: number;
  numberStyle: NumberStyle;
  /** Bates numbering for this file (every page, counting continues from `start`). */
  bates?: BatesFormat & { start: number };
  /** Pre-formatted on the main thread so it follows the user's locale. */
  date: string;
  filename: string;
};

export type GridPosition = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

export type WatermarkSpec = {
  kind: 'text' | 'image';
  text: string;
  style: TextStyle;
  image: Blob | null;
  /** Image width as a fraction of the page width (reader frame). */
  imageScale: number;
  /** 0–1. */
  opacity: number;
  /** Degrees, counter-clockwise as the reader sees it (45 = rising diagonal). */
  rotation: number;
  position: GridPosition;
  tile: boolean;
  /** Gap between tiles, points. */
  gap: number;
  margin: number;
  layer: 'over' | 'under';
  pages: string;
};

export type InvertMode = 'invert' | 'sepia' | 'contrast';

export type InvertSpec = {
  mode: InvertMode;
  pages: string;
  /** For 'contrast': one rendered image per page index (others null). */
  images?: (Blob | null)[];
};

export type FlattenSpec = {
  forms: boolean;
  annotations: boolean;
  keepLinks: boolean;
  removeJavaScript: boolean;
};

export type PdfMetadata = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  /** "YYYY-MM-DDTHH:mm" local time, or '' for none. */
  creationDate: string;
  modDate: string;
};

export type MetadataInfo = PdfMetadata & { hasXmp: boolean; pageCount: number };

export type MetadataSpec = { removeAll: true } | { removeAll: false; values: PdfMetadata };

/** What sign-pdf (and later the editor) places on pages. */
export type OverlayContent =
  | { type: 'image'; image: Blob }
  | { type: 'text'; text: string; font: FontFamily; color: string };

export type OverlayItem = { page: number; placement: Placement; content: OverlayContent };

/** Text overlays: font size = height / TEXT_LINE; baseline sits TEXT_BASELINE × size above the bottom. */
export const TEXT_LINE = 1.25;
export const TEXT_BASELINE = 0.3;

export type FieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature';
export type FieldValue = string | string[] | boolean;

export type FieldWidget = {
  page: number;
  /** Widget rectangle in user space. */
  rect: { x: number; y: number; width: number; height: number };
  /** For radio buttons: the option this widget selects. */
  option?: string;
};

export type FormField = {
  name: string;
  type: FieldType;
  value: FieldValue;
  options: string[];
  readOnly: boolean;
  multiline: boolean;
  maxLength?: number;
  multiSelect: boolean;
  editable: boolean;
  widgets: FieldWidget[];
};

export type FormInfo = { fields: FormField[]; pageCount: number; xfaOnly: boolean };

export type PageSize = { width: number; height: number; rotation: number };
