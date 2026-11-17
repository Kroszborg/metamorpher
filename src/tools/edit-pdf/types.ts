import type { Placement } from '@/engines/pdf-stamp/geometry';

export type Kind = 'text' | 'image' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'ink' | 'highlight' | 'whiteout';
export type Family = 'sans' | 'serif' | 'mono';
export type Align = 'left' | 'center' | 'right';

/** Something added to a page. Every kind lives in a placement box, so all of them move, resize and rotate alike. */
export type EditItem = {
  id: string;
  page: number;
  kind: Kind;
  placement: Placement;
  /** Text items. */
  text?: string;
  family?: Family;
  bold?: boolean;
  italic?: boolean;
  /** Points. */
  size?: number;
  align?: Align;
  /** "#rrggbb": text colour, or the outline of shapes, lines and ink. */
  color?: string;
  /** Shapes: fill colour, or null for none. */
  fill?: string | null;
  /** Points. */
  strokeWidth?: number;
  /** Lines and arrows: from the top-left corner of the box to the bottom-right ('down') or bottom-left to top-right ('up'). */
  direction?: 'down' | 'up';
  /** Ink: strokes as points in the box, 0–1, y down. */
  strokes?: [number, number][][];
  image?: Blob;
  /** Text items: the page of the laid-out text boxes PDF that holds this item (set by the tool before writing). */
  textPage?: number;
};
