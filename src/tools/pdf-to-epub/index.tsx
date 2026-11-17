'use client';

import { useCallback, useMemo, useState } from 'react';
import { modelNotes } from '@/components/doc-tools';
import { modelToEpub } from '@/components/doc-tools/model-html';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, NoteLine, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { buildDocument, pdfExtract } from '@/engines/pdf-extract';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { images: boolean; password: string; onReport: (id: string, notes: ResultNote[]) => void };

const job = perFile<Options>(async (input, o, ctx) => {
  const name = baseName(input.file.name);
  const raw = await pdfExtract.structure(input.file, {
    images: o.images,
    password: o.password || undefined,
    signal: ctx.signal,
    onProgress: (d, t, n) => ctx.onProgress((d / Math.max(1, t)) * 0.95, n),
  });
  const model = buildDocument(raw, { dropRunning: true, pageBreaks: false , tables: true, columns: true });
  if (model.chars === 0) throw new Error('This PDF has no text (probably scanned pages), so there is nothing to reflow. Run text recognition (OCR) first.');
  const blob = modelToEpub(model, { name });
  o.onReport(input.id, modelNotes(model));
  return { name: `${name}.epub`, blob };
});

export default function PdfToEpub({ tool }: ToolProps) {
  const [images, setImages] = useState(true);
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(() => ({ images, password, onReport }), [images, password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Convert to EPUB"
      optionsPanel={
        <>
          <SwitchRow id="pe-images" label="Include images" checked={images} onChange={setImages} />
          <OptionField label="Password" htmlFor="pe-password" hint="Only for files that need a password to open.">
            <PasswordInput id="pe-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <NoteLine
            note={{
              kind: 'info',
              text: 'Text is reflowed into chapters at the main headings, with a table of contents. Running headers, footers and page numbers are left out. Tables become real tables and multi-column pages are read column by column. Works best with text-based PDFs.',
            }}
          />
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="ebooks.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
