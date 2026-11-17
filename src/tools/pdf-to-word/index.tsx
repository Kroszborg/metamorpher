'use client';

import { useCallback, useMemo, useState } from 'react';
import { modelNotes } from '@/components/doc-tools';
import { writeDocx } from '@/components/doc-tools/docx-writer';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, NoteLine, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { buildDocument, pdfExtract } from '@/engines/pdf-extract';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = {
  pageBreaks: boolean;
  images: boolean;
  dropRunning: boolean;
  password: string;
  onReport: (id: string, notes: ResultNote[]) => void;
};

const job = perFile<Options>(async (input, o, ctx) => {
  const raw = await pdfExtract.structure(input.file, {
    images: o.images,
    password: o.password || undefined,
    signal: ctx.signal,
    onProgress: (d, t, n) => ctx.onProgress((d / Math.max(1, t)) * 0.9, n),
  });
  const model = buildDocument(raw, { dropRunning: o.dropRunning, pageBreaks: o.pageBreaks , tables: true, columns: true });
  ctx.onProgress(0.95, 'Writing the Word file');
  const blob = writeDocx(model);
  o.onReport(input.id, modelNotes(model));
  return { name: `${baseName(input.file.name)}.docx`, blob };
});

export default function PdfToWord({ tool }: ToolProps) {
  const [pageBreaks, setPageBreaks] = useState(true);
  const [images, setImages] = useState(true);
  const [dropRunning, setDropRunning] = useState(true);
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(
    () => ({ pageBreaks, images, dropRunning, password, onReport }),
    [pageBreaks, images, dropRunning, password, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept });
  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Convert to Word"
      optionsPanel={
        <>
          <SwitchRow id="pw-breaks" label="Start each PDF page on a new page" checked={pageBreaks} onChange={setPageBreaks} />
          <SwitchRow id="pw-images" label="Include images" checked={images} onChange={setImages} />
          <SwitchRow
            id="pw-running"
            label="Leave out headers, footers and page numbers"
            hint="Text repeated at the top or bottom of many pages."
            checked={dropRunning}
            onChange={setDropRunning}
          />
          <OptionField label="Password" htmlFor="pw-password" hint="Only for files that need a password to open.">
            <PasswordInput id="pw-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <NoteLine
            note={{
              kind: 'info',
              text: 'The text becomes editable paragraphs with headings, bold, italics, sizes, colours, links and images. Tables (ruled, or columns of aligned text) become real Word tables, and pages in two or three columns are read column by column. Merged cells are kept across columns but not down rows; scanned pages need OCR first.',
            }}
          />
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="word-documents.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
