import type { JobContext, OutputFile } from '@/components/workbench';
import type { PageSpec } from '@/engines/pdf';
import { pagesLabel } from './page-range';

/** One output file of a split: its pages (0-based, in output order) and file name. */
export type Part = { pages: number[]; name: string };

/** Adds " (2)", " (3)" … to repeated names, keeping the extension. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let out = name;
    for (let n = 2; seen.has(out.toLowerCase()); n += 1) out = `${stem} (${n})${ext}`;
    seen.add(out.toLowerCase());
    return out;
  });
}

/** "Part 2" badges on the first page of each part (for `GridPage.badge`). */
export function partStarts(parts: readonly { pages: readonly number[] }[]): Map<number, string> {
  const out = new Map<number, string>();
  parts.forEach((p, i) => {
    const first = p.pages[0];
    if (first !== undefined && !out.has(first)) out.set(first, `Part ${i + 1}`);
  });
  return out;
}

/** Which part each page lands in (first part wins), for tile captions and tones. */
export function partOfPage(parts: readonly { pages: readonly number[] }[]): Map<number, number> {
  const out = new Map<number, number>();
  parts.forEach((p, i) => {
    for (const page of p.pages) if (!out.has(page)) out.set(page, i);
  });
  return out;
}

/** A default part name fragment: "pages-1-3", or "part-02_pages-1-3" when numbering helps ordering. */
export function partLabel(pages: readonly number[], index: number, count: number, numbered: boolean): string {
  const label = pagesLabel(pages);
  if (!numbered) return label;
  const width = String(count).length;
  return `part-${String(index + 1).padStart(width, '0')}_${label}`;
}

/**
 * Runs an engine call with a progress callback that goes quiet once the call
 * settles. Comlink delivers proxied callbacks on their own message channel, so
 * a last progress message can arrive after the result; without this guard it
 * would flip a finished file back to "running".
 */
export async function withProgress<T>(
  ctx: JobContext,
  map: (done: number, total: number) => [fraction: number, note?: string],
  run: (onProgress: (done: number, total: number) => void) => Promise<T>,
): Promise<T> {
  let live = true;
  try {
    return await run((done, total) => {
      if (!live) return;
      const [fraction, note] = map(done, total);
      ctx.onProgress(fraction, note);
    });
  } finally {
    live = false;
  }
}

/**
 * Builds each part as its own PDF from one file (pages copied with only what
 * they use, bookmarks and links kept within each part) and names it.
 */
export async function buildParts(
  ctx: JobContext,
  file: File,
  parts: readonly Part[],
  { note = 'Part', transform }: { note?: string; transform?: (page: number) => Omit<PageSpec, 'page' | 'file'> } = {},
): Promise<OutputFile[]> {
  if (parts.length === 0) throw new Error('There is nothing to save.');
  ctx.onProgress(0.02, 'Reading the PDF');
  const blobs = await withProgress(
    ctx,
    (done, total) => [done / total, `${note} ${done} of ${total}`],
    (onProgress) =>
      ctx.engines.pdf.pages.assemble(
        [{ name: file.name, blob: file }],
        parts.map((p) => p.pages.map((page) => ({ page, ...transform?.(page) }))),
        { signal: ctx.signal, onProgress },
      ),
  );
  const names = uniqueNames(parts.map((p) => p.name));
  return blobs.map((blob, i) => ({ name: names[i] ?? `part-${i + 1}.pdf`, blob }));
}
