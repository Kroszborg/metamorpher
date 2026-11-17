import type { Orientation, PageGeometry, PageSizeId } from './types';

/** Portrait sizes in points. */
export const PAGE_SIZES: Record<PageSizeId, { label: string; width: number; height: number }> = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  letter: { label: 'Letter', width: 612, height: 792 },
  legal: { label: 'Legal', width: 612, height: 1008 },
  a3: { label: 'A3', width: 841.89, height: 1190.55 },
  a5: { label: 'A5', width: 419.53, height: 595.28 },
  tabloid: { label: 'Tabloid', width: 792, height: 1224 },
};

export type MarginPreset = 'narrow' | 'normal' | 'wide';

/** Margins in points: 0.5 in, 0.75 in, 1 in. */
export const MARGINS: Record<MarginPreset, { label: string; points: number }> = {
  narrow: { label: 'Narrow', points: 36 },
  normal: { label: 'Normal', points: 54 },
  wide: { label: 'Wide', points: 72 },
};

/** Default page size for the user's locale: Letter in the US, Canada and a few others, A4 elsewhere. */
export function defaultPageSize(): PageSizeId {
  if (typeof navigator === 'undefined') return 'a4';
  const region = /-([A-Z]{2})\b/.exec(navigator.language)?.[1];
  return region && ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR'].includes(region) ? 'letter' : 'a4';
}

export function pageGeometry(size: PageSizeId, orientation: Orientation, margin: MarginPreset | number): PageGeometry {
  const s = PAGE_SIZES[size];
  const m = typeof margin === 'number' ? margin : MARGINS[margin].points;
  const landscape = orientation === 'landscape';
  return {
    width: landscape ? s.height : s.width,
    height: landscape ? s.width : s.height,
    margin: { top: m, right: m, bottom: m, left: m },
  };
}

/** The same geometry turned to the other orientation (margins follow the paper). */
export function rotateGeometry(g: PageGeometry): PageGeometry {
  return {
    width: g.height,
    height: g.width,
    margin: { top: g.margin.left, right: g.margin.top, bottom: g.margin.right, left: g.margin.bottom },
  };
}
