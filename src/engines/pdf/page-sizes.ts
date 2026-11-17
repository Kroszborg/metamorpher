/** Page sizes in PDF points (1/72 inch), portrait. */
export const PAGE_SIZES = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  letter: { label: 'Letter', width: 612, height: 792 },
  legal: { label: 'Legal', width: 612, height: 1008 },
  a3: { label: 'A3', width: 841.89, height: 1190.55 },
  a5: { label: 'A5', width: 419.53, height: 595.28 },
} as const;

export type FixedPageSize = keyof typeof PAGE_SIZES;
/** A named size, or 'fit': each page takes the size of its image (1 px = 1 pt) plus the margin. */
export type PageSize = FixedPageSize | 'fit';
/** 'auto' picks portrait or landscape per page to match the image. */
export type Orientation = 'portrait' | 'landscape' | 'auto';

export type ImagePageLayout = {
  pageSize: PageSize;
  orientation: Orientation;
  /** Margin on every side, in points. */
  margin: number;
};

/** The page box for an image of `w`×`h` pixels under `layout`. Pure, so it is unit-testable. */
export function pageBoxFor(
  w: number,
  h: number,
  layout: ImagePageLayout,
): { pageWidth: number; pageHeight: number; x: number; y: number; width: number; height: number } {
  const m = Math.max(0, layout.margin);
  if (layout.pageSize === 'fit') {
    return { pageWidth: w + 2 * m, pageHeight: h + 2 * m, x: m, y: m, width: w, height: h };
  }
  const base = PAGE_SIZES[layout.pageSize];
  const short = Math.min(base.width, base.height);
  const long = Math.max(base.width, base.height);
  const landscape =
    layout.orientation === 'landscape' || (layout.orientation === 'auto' && w > h);
  const pageWidth = landscape ? long : short;
  const pageHeight = landscape ? short : long;
  const scale = Math.min((pageWidth - 2 * m) / w, (pageHeight - 2 * m) / h);
  const width = w * scale;
  const height = h * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}
