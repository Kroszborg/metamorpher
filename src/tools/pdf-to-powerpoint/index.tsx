'use client';

import { useCallback, useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { plural } from '@/components/doc-tools';
import { type SlidePicture, writePptx } from '@/components/doc-tools/pptx-writer';
import { EngineNote, NoteLine, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES, mupdfEngine } from '@/engines/mupdf';
import { WorkerHost } from '@/engines/worker-host';
import { baseName, formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import type { SlidesWorkerApi } from './slides.worker';

const host = new WorkerHost<SlidesWorkerApi>(() => new Worker(new URL('./slides.worker.ts', import.meta.url), { type: 'module' }));

type SlideSize = 'page' | 'wide' | 'standard';
type Quality = 'standard' | 'high';
type Mode = 'picture' | 'editable';
type Options = { mode: Mode; size: SlideSize; quality: Quality; password: string; onReport: (id: string, notes: ResultNote[]) => void };

/** Editable slides: each page's graphics as the background picture, its visible text as text boxes on top. */
async function editableSlides(file: File, o: Options, ctx: Parameters<Parameters<typeof perFile<Options>>[0]>[2]): Promise<{ pictures: SlidePicture[]; lines: number; hidden: number }> {
  const count = await host.call((api) => api.open(file, o.password || undefined), ctx.signal);
  try {
    if (count > MAX_PAGES) throw new Error(`This PDF has ${count} pages; up to ${MAX_PAGES} slides are made at a time. Split it first.`);
    const dpi = o.quality === 'high' ? 200 : 144;
    const pictures: SlidePicture[] = [];
    let lines = 0;
    let hidden = 0;
    for (let i = 0; i < count; i++) {
      const page = await host.call((api) => api.page(i, dpi), ctx.signal);
      lines += page.lines.length;
      hidden += page.hiddenLines;
      pictures.push({ bytes: page.image, mime: 'image/jpeg', width: page.width, height: page.height, texts: page.lines });
      ctx.onProgress(((i + 1) / count) * 0.95, `Slide ${i + 1} of ${count}`);
    }
    return { pictures, lines, hidden };
  } finally {
    await host.call((api) => api.close()).catch(() => undefined);
  }
}

const MAX_PAGES = 300;

const job = perFile<Options>(async (input, o, ctx) => {
  if (o.mode === 'editable') {
    const { pictures, lines, hidden } = await editableSlides(input.file, o, ctx);
    const first = pictures[0] ?? { width: 960, height: 540 };
    const slide = o.size === 'wide' ? { width: 960, height: 540 } : o.size === 'standard' ? { width: 720, height: 540 } : { width: first.width, height: first.height };
    const blob = writePptx(pictures, slide, baseName(input.file.name));
    const notes: ResultNote[] = [
      { kind: 'ok', text: `${plural(pictures.length, 'slide')} with ${plural(lines, 'editable text line')} over the page graphics · ${formatBytes(blob.size)}` },
      { kind: 'info', text: 'Each line of text is its own text box, placed where it was on the page. Fonts you do not have are replaced by PowerPoint, so line lengths can differ a little.' },
    ];
    if (hidden > 0) notes.push({ kind: 'info', text: `${plural(hidden, 'line')} of invisible text (an OCR layer) stay in the picture only.` });
    if (lines === 0) notes.push({ kind: 'warn', text: 'No text was found (scanned pages?): the slides are pictures only. Run text recognition (OCR) first for editable text.' });
    o.onReport(input.id, notes);
    return { name: `${baseName(input.file.name)}.pptx`, blob };
  }
  const session = await mupdfEngine.openSession(input.file, { signal: ctx.signal, password: o.password || undefined });
  try {
    const count = session.pageCount;
    if (count > MAX_PAGES) throw new Error(`This PDF has ${count} pages; up to ${MAX_PAGES} slides are made at a time. Split it first.`);
    const dpi = o.quality === 'high' ? 200 : 144;
    const pictures: SlidePicture[] = [];
    let first: { width: number; height: number } | null = null;
    for (let i = 0; i < count; i++) {
      if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const page = await session.renderPage(i, { dpi, format: 'jpeg', signal: ctx.signal });
      let alt = '';
      try {
        const text = await session.pageText(i, ctx.signal);
        alt = text.blocks.map((b) => b.lines.map((l) => l.text).join(' ')).join('\n').trim();
      } catch {
        // no text on this page
      }
      first ??= { width: page.pageWidth, height: page.pageHeight };
      pictures.push({ bytes: new Uint8Array(await page.blob.arrayBuffer()), mime: 'image/jpeg', width: page.pageWidth, height: page.pageHeight, alt: alt || undefined });
      ctx.onProgress(((i + 1) / count) * 0.95, `Slide ${i + 1} of ${count}`);
    }
    const slide =
      o.size === 'wide' ? { width: 960, height: 540 } : o.size === 'standard' ? { width: 720, height: 540 } : (first ?? { width: 960, height: 540 });
    const blob = writePptx(pictures, slide, baseName(input.file.name));
    o.onReport(input.id, [
      { kind: 'ok', text: `${plural(count, 'slide')}, each page as a picture at ${dpi} dpi · ${formatBytes(blob.size)}` },
      { kind: 'info', text: 'Page text is stored as the alternative text of each picture (for screen readers and search), not as editable text boxes.' },
    ]);
    return { name: `${baseName(input.file.name)}.pptx`, blob };
  } finally {
    session.close();
  }
});

export default function PdfToPowerpoint({ tool }: ToolProps) {
  const [mode, setMode] = useState<Mode>('editable');
  const [size, setSize] = useState<SlideSize>('page');
  const [quality, setQuality] = useState<Quality>('standard');
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(() => ({ mode, size, quality, password, onReport }), [mode, size, quality, password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Convert to PowerPoint"
      optionsPanel={
        <>
          <OptionField
            label="Slides"
            hint={mode === 'editable' ? 'Text becomes text boxes you can edit; pictures, lines and shapes stay as the slide background.' : 'Each page is one picture: looks exactly like the PDF, text cannot be edited.'}
          >
            <Segmented<Mode>
              label="Slides"
              value={mode}
              options={[
                { value: 'editable', label: 'Editable text' },
                { value: 'picture', label: 'Picture of the page' },
              ]}
              onChange={setMode}
            />
          </OptionField>
          <OptionField label="Slide size" hint={size === 'page' ? 'Slides take the shape of the PDF pages.' : 'Pages are centred on the slide, with white space around them if the shapes differ.'}>
            <Segmented<SlideSize>
              label="Slide size"
              value={size}
              options={[
                { value: 'page', label: 'Like the page' },
                { value: 'wide', label: '16:9' },
                { value: 'standard', label: '4:3' },
              ]}
              onChange={setSize}
            />
          </OptionField>
          <OptionField label="Picture quality">
            <Segmented<Quality>
              label="Picture quality"
              value={quality}
              options={[
                { value: 'standard', label: 'Standard (144 dpi)' },
                { value: 'high', label: 'High (200 dpi)' },
              ]}
              onChange={setQuality}
            />
          </OptionField>
          <OptionField label="Password" htmlFor="pp-password" hint="Only for files that need a password to open.">
            <PasswordInput id="pp-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <NoteLine
            note={{
              kind: 'info',
              text:
                mode === 'editable'
                  ? 'Each page becomes one slide: its graphics as a background picture and every line of text as an editable text box in place. Paragraphs are not rejoined, and fonts are replaced when PowerPoint does not have them.'
                  : 'Each page becomes one slide showing the page as a picture, so it looks exactly like the PDF. Text on the slides is not editable.',
            }}
          />
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="presentations.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
