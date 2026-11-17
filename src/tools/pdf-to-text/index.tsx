'use client';

import { useCallback, useMemo, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES, mupdfEngine, type TextMode } from '@/engines/mupdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Split = 'file' | 'pages';
type Report = { notes: ResultNote[]; preview: string };
type Options = {
  mode: TextMode;
  split: Split;
  markers: boolean;
  password: string;
  onReport: (id: string, report: Report) => void;
};

const PREVIEW_CHARS = 6000;
const TEXT_TYPE = 'text/plain;charset=utf-8';

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  const base = baseName(file.name);
  const pages = await mupdfEngine.extractText(file, o.mode, {
    signal: ctx.signal,
    password: o.password || undefined,
    onProgress: (done, total) => ctx.onProgress(done / Math.max(1, total), `Page ${done} of ${total}`),
  });
  const empty = pages.filter((p) => p.trim() === '').length;
  const chars = pages.reduce((n, p) => n + p.length, 0);
  const notes: ResultNote[] = [];
  if (empty === pages.length) {
    notes.push({
      kind: 'warn',
      text: 'No text found. The pages are probably scanned images, which need text recognition (OCR) first.',
    });
  } else {
    notes.push({
      kind: 'ok',
      text: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}, ${chars.toLocaleString()} characters${
        empty ? ` · ${empty} ${empty === 1 ? 'page has' : 'pages have'} no text` : ''
      }`,
    });
  }

  const joined = pages
    .map((text, i) => (o.markers ? `=== Page ${i + 1} ===\n\n${text}` : text))
    .join(o.markers ? '\n\n' : '\n\f');
  o.onReport(input.id, { notes, preview: joined.slice(0, PREVIEW_CHARS) });

  if (o.split === 'file' || pages.length === 1) {
    return { name: `${base}.txt`, blob: new Blob([joined], { type: TEXT_TYPE }) };
  }
  const zip = new ctx.engines.archive.ZipWriter();
  const width = String(pages.length).length;
  for (const [i, text] of pages.entries()) {
    await zip.add(`${base}-page-${String(i + 1).padStart(width, '0')}.txt`, new Blob([text], { type: TEXT_TYPE }));
  }
  return { name: `${base}-pages.zip`, blob: zip.finish() };
});

export default function PdfToText({ tool }: ToolProps) {
  const [mode, setMode] = useState<TextMode>('plain');
  const [split, setSplit] = useState<Split>('file');
  const [markers, setMarkers] = useState(true);
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, Report>>({});
  const onReport = useCallback((id: string, r: Report) => setReports((p) => ({ ...p, [id]: r })), []);
  const options = useMemo<Options>(
    () => ({ mode, split, markers, password, onReport }),
    [mode, split, markers, password, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept });
  const first = wb.results[0];
  const preview = first?.sourceId ? reports[first.sourceId]?.preview : undefined;

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Extract text"
      optionsPanel={
        <>
          <OptionField
            label="Text"
            hint={
              mode === 'plain'
                ? 'Reading order, one paragraph after another. Best for copying and searching.'
                : 'Keeps columns and tables lined up with spaces. View it in a monospaced font.'
            }
          >
            <Segmented<TextMode>
              label="Text"
              value={mode}
              options={[
                { value: 'plain', label: 'Plain' },
                { value: 'layout', label: 'Keep layout' },
              ]}
              onChange={setMode}
            />
          </OptionField>
          <OptionField label="Output">
            <Segmented<Split>
              label="Output"
              value={split}
              options={[
                { value: 'file', label: 'One file' },
                { value: 'pages', label: 'File per page' },
              ]}
              onChange={setSplit}
            />
          </OptionField>
          {split === 'file' ? (
            <SwitchRow id="tx-markers" label="Mark page breaks" checked={markers} onChange={setMarkers} />
          ) : null}
          <OptionField label="Password" htmlFor="tx-password" hint="Only for files that need a password to open.">
            <PasswordInput id="tx-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName="pdf-text.zip"
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId]?.notes ?? []) : [])}
      />
      {preview ? (
        <SectionCard title="Preview" description={first?.name}>
          <pre
            data-report="text-preview"
            className="max-h-96 overflow-auto whitespace-pre font-mono text-[0.7rem]/relaxed text-muted-foreground"
          >
            {preview}
          </pre>
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
