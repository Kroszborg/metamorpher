'use client';

import { useCallback, useMemo, useState } from 'react';
import { plural } from '@/components/doc-tools';
import { readPptx } from '@/components/doc-tools/pptx';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, NoteLine, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { perFile, useWorkbench } from '@/components/workbench';
import { TYPESET_DOWNLOAD_BYTES, typesetEngine } from '@/engines/typeset';
import { baseName, formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { includeHidden: boolean; outline: boolean; onReport: (id: string, notes: ResultNote[]) => void };

const job = perFile<Options>(async (input, o, ctx) => {
  if (/\.ppt$/i.test(input.file.name)) throw new Error('Old .ppt files are not supported. Save the presentation as .pptx in PowerPoint or LibreOffice first.');
  ctx.onProgress(0.01, 'Reading the slides');
  const { request, report } = readPptx(await input.file.arrayBuffer(), { includeHidden: o.includeHidden });
  if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const result = await typesetEngine.slides(
    { ...request, outline: o.outline, title: request.title ?? baseName(input.file.name) },
    { signal: ctx.signal, onProgress: (done, _total, note) => ctx.onProgress(done, note) },
  );
  const notes: ResultNote[] = [
    {
      kind: 'ok',
      text: `${plural(result.pages, 'slide')} → ${plural(result.pages, 'page')} at the slide size (${Math.round(request.width)} × ${Math.round(request.height)} pt) · text is selectable and searchable · ${formatBytes(result.blob.size)}`,
    },
  ];
  if (result.bookmarks > 0) notes.push({ kind: 'info', text: `${plural(result.bookmarks, 'bookmark')} from the slide titles.` });
  if (report.hidden > 0) notes.push({ kind: 'info', text: `${plural(report.hidden, 'hidden slide')} left out, as in a slide show.` });
  if (report.smartArt > 0) notes.push({ kind: 'info', text: `${plural(report.smartArt, 'SmartArt graphic')} drawn from the shapes PowerPoint stored for it.` });
  if (report.metafilesConverted > 0) notes.push({ kind: 'info', text: `${plural(report.metafilesConverted, 'EMF/WMF picture')} drawn from the bitmap stored inside.` });
  if (result.fonts.length > 0) notes.push({ kind: 'info', text: `Embedded fonts for this text: ${result.fonts.join(', ')} (only the characters used).` });
  const missing: string[] = [];
  if (report.charts > 0) missing.push(`${plural(report.charts, 'chart')} (a labelled frame instead)`);
  if (report.metafilesMissing > 0) missing.push(`${plural(report.metafilesMissing, 'vector EMF/WMF drawing')}`);
  if (result.brokenImages > 0) missing.push(`${plural(result.brokenImages, 'picture')} that could not be decoded`);
  if (report.unknownShapes > 0) missing.push(`${plural(report.unknownShapes, 'unusual shape')} (drawn as rectangles)`);
  if (report.media > 0) missing.push('video and audio (their poster picture is shown)');
  if (missing.length > 0) notes.push({ kind: 'warn', text: `Not reproduced: ${missing.join(', ')}.` });
  if (result.missing.length > 0) notes.push({ kind: 'warn', text: `Some characters have no font here and show as blanks or boxes: ${result.missing.join(' ')}` });
  o.onReport(input.id, notes);
  return { name: `${baseName(input.file.name)}.pdf`, blob: result.blob };
});

export default function PowerpointToPdf({ tool }: ToolProps) {
  const [includeHidden, setIncludeHidden] = useState(false);
  const [outline, setOutline] = useState(true);
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(() => ({ includeHidden, outline, onReport }), [includeHidden, outline, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Convert to PDF"
      optionsPanel={
        <>
          <SwitchRow id="pp-hidden" label="Include hidden slides" checked={includeHidden} onChange={setIncludeHidden} />
          <SwitchRow id="pp-outline" label="Bookmarks from slide titles" checked={outline} onChange={setOutline} />
          <NoteLine
            note={{
              kind: 'info',
              text: 'Converted in your browser without PowerPoint: one page per slide with masters, layouts, backgrounds, text boxes, bullets, pictures, shapes, tables and SmartArt; the text stays real text. Fonts you do not have here are replaced by similar ones, so lines can break differently. Charts, shadows, 3-D effects and animations are not drawn.',
            }}
          />
          <EngineNote bytes={TYPESET_DOWNLOAD_BYTES} name="layout engine" />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="presentation-pdfs.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
