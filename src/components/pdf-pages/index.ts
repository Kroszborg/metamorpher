import type { PdfPreview } from '@/engines/pdf';
import { baseName } from '@/lib/files';
import type { GridPage } from './page-grid';

export { type GridPage, PageGrid, type PageGridProps, PageThumb } from './page-grid';
export {
  chunkPages,
  formatPageRanges,
  type PageRange,
  pagesLabel,
  parsePageRanges,
  parsePageSelection,
  rangesToIndices,
  toRuns,
} from './page-range';
export { PageRangeInput } from './page-range-input';
export { NumberInput, SwitchRow, TileAction } from './fields';
export { containsPhrase, normalizeText, type PageTexts, usePageTexts } from './use-page-texts';
export { buildParts, type Part, partLabel, partOfPage, partStarts, uniqueNames, withProgress } from './parts';
export { PageToolLayout, PdfProblem } from './page-tool-layout';
export { useScopedState } from './scoped-state';
export { type PdfPreviewState, usePdfPreview, usePdfPreviews } from './use-pdf-preview';

/** `{ name, blob }` for engine calls. */
export const named = (file: File) => ({ name: file.name, blob: file });

/** "report.pdf" + "pages-1-3" → "report_pages-1-3.pdf". */
export function outputName(file: { name: string }, suffix: string): string {
  const printable = [...suffix].filter((c) => c.charCodeAt(0) >= 32).join('');
  const safe = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return `${baseName(file.name)}${safe ? `_${safe}` : ''}.pdf`;
}

/** Grid tiles for every page of one document; keys are the page indices as strings. */
export function docPages(
  preview: PdfPreview | null,
  count: number,
  decorate?: (index: number) => Partial<GridPage>,
): GridPage[] {
  return Array.from({ length: count }, (_, index) => ({
    key: String(index),
    preview,
    index,
    ...decorate?.(index),
  }));
}

/** Page indices ↔ grid keys for single-document grids built with `docPages`. */
export const keysOf = (indices: Iterable<number>) => new Set([...indices].map(String));
export const indicesOf = (keys: Iterable<string>) => new Set([...keys].map(Number));
