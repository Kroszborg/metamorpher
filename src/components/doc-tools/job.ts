import type { ResultNote } from '@/components/pdf-tools';
import { type InputFile, type JobContext, type OutputFile, perFile } from '@/components/workbench';
import { type Block, type PageGeometry, type RunningText, type TypesetResult, typesetEngine } from '@/engines/typeset';
import { baseName } from '@/lib/files';
import { isImageFile, type Resources } from './images';
import { plural } from './notes';
import { geometryOf, type PageSetup } from './options';

export type DocReport = { notes: ResultNote[] };

/** Options every document-to-PDF tool passes to its job. */
export type DocJobOptions = {
  setup: PageSetup;
  onReport: (id: string, report: DocReport) => void;
  /** Image files added next to the documents, by name. */
  resources: Resources;
};

export type Prepared = {
  blocks: Block[];
  css: string;
  /** Body text size in points. */
  fontSize: number;
  tableFontSize?: number;
  title?: string;
  lang?: string;
  /** Notes from reading the input (encoding, images left out …). */
  notes: ResultNote[];
  /** The document's own page size and margins (Word), instead of the page setup. */
  page?: PageGeometry;
  header?: RunningText;
  footer?: RunningText;
  footnotes?: { id: string; html: string }[];
};

/** Notes about a finished PDF: pages, bookmarks, fonts, characters that could not be shown. */
export function resultNotes(r: TypesetResult, setup: PageSetup): ResultNote[] {
  const notes: ResultNote[] = [];
  const facts = [plural(r.pages, 'page')];
  if (r.bookmarks > 0) facts.push(plural(r.bookmarks, 'bookmark'));
  if (setup.orientation === 'auto' && r.orientation === 'landscape') facts.push('landscape (the table is wide)');
  notes.push({ kind: 'ok', text: `${facts.join(' · ')} · text is selectable and searchable` });
  if (r.fonts.length > 0) notes.push({ kind: 'info', text: `Embedded fonts for this text: ${r.fonts.join(', ')} (only the characters used).` });
  if (r.missing.length > 0) {
    notes.push({
      kind: 'warn',
      text: `Some characters have no font here and show as blanks or boxes: ${r.missing.join(' ')}`,
    });
  }
  return notes;
}

/**
 * A per-file job for the document-to-PDF tools: `prepare` turns one input
 * into blocks for the layout engine; image files in the list are resources
 * for the documents, not inputs, and produce no output of their own.
 */
export function docToPdfJob<O extends DocJobOptions>(
  prepare: (input: InputFile, options: O, ctx: JobContext) => Promise<Prepared>,
) {
  return perFile<O>(async (input, o, ctx): Promise<OutputFile[]> => {
    if (isImageFile(input.file)) {
      o.onReport(input.id, { notes: [{ kind: 'info', text: 'Image used by the documents that refer to it by name.' }] });
      return [];
    }
    ctx.onProgress(0.01, 'Reading');
    const p = await prepare(input, o, ctx);
    if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const result = await typesetEngine.render(
      {
        blocks: p.blocks,
        css: p.css,
        page: p.page ?? geometryOf(o.setup),
        orientation: p.page ? undefined : o.setup.orientation,
        fontSize: p.fontSize,
        tableFontSize: p.tableFontSize,
        outline: o.setup.outline,
        pageNumbers: o.setup.pageNumbers,
        title: p.title ?? baseName(input.file.name),
        lang: p.lang,
        header: p.header,
        footer: p.footer,
        footnotes: p.footnotes,
      },
      { signal: ctx.signal, onProgress: (done, _total, note) => ctx.onProgress(done, note) },
    );
    o.onReport(input.id, { notes: [...resultNotes(result, o.setup), ...p.notes] });
    return [{ name: `${baseName(input.file.name)}.pdf`, blob: result.blob }];
  });
}
