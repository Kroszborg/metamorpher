'use client';

import { useCallback, useMemo, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { modelNotes, plural } from '@/components/doc-tools';
import { modelToHtml } from '@/components/doc-tools/model-html';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { buildDocument, pdfExtract } from '@/engines/pdf-extract';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Mode = 'reflow' | 'fixed';
type Options = {
  mode: Mode;
  images: boolean;
  pageRules: boolean;
  password: string;
  onReport: (id: string, notes: ResultNote[]) => void;
};

const FIXED_CSS = `body{background:#e9ebee;margin:0;padding:16px 0;font-family:sans-serif}
.page{position:relative;background:#fff;margin:0 auto 16px;box-shadow:0 1px 4px rgba(0,0,0,.25);overflow:hidden}
.page p{position:absolute;margin:0;white-space:pre}
.page img{position:absolute;top:0;left:0}`;

function escapeTitle(t: string): string {
  return t.replace(/[&<>"]/g, '');
}

const job = perFile<Options>(async (input, o, ctx) => {
  const name = baseName(input.file.name);
  const progress = (d: number, t: number, n?: string) => ctx.onProgress((d / Math.max(1, t)) * 0.95, n);
  if (o.mode === 'fixed') {
    const { pages, title } = await pdfExtract.fixedHtml(input.file, { password: o.password || undefined, signal: ctx.signal, onProgress: progress });
    // MuPDF writes each page as <div id="pageN" style="width:…;height:…">; give them the page class.
    const body = pages.map((p) => p.replace(/^<div id="page(\d+)"/, '<div class="page" id="page$1"')).join('\n');
    const html = `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeTitle(title ?? name)}</title>\n<style>${FIXED_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
    o.onReport(input.id, [{ kind: 'ok', text: `${plural(pages.length, 'page')}, positioned like the PDF; images embedded` }]);
    return { name: `${name}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) };
  }
  const raw = await pdfExtract.structure(input.file, { images: o.images, password: o.password || undefined, signal: ctx.signal, onProgress: progress });
  const model = buildDocument(raw, { dropRunning: true, pageBreaks: o.pageRules , tables: true, columns: true });
  const html = modelToHtml({ ...model, title: model.title ?? name }, { pageRules: o.pageRules });
  o.onReport(input.id, modelNotes(model));
  return { name: `${name}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) };
});

export default function PdfToHtml({ tool }: ToolProps) {
  const [mode, setMode] = useState<Mode>('reflow');
  const [images, setImages] = useState(true);
  const [pageRules, setPageRules] = useState(false);
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(() => ({ mode, images, pageRules, password, onReport }), [mode, images, pageRules, password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Convert to HTML"
      optionsPanel={
        <>
          <OptionField
            label="Layout"
            hint={
              mode === 'reflow'
                ? 'A readable web page: headings, paragraphs, links and images that reflow on any screen.'
                : 'Text and images placed where they are on each PDF page. Looks like the PDF but does not reflow; drawn lines, borders and background colours are left out.'
            }
          >
            <Segmented<Mode>
              label="Layout"
              value={mode}
              options={[
                { value: 'reflow', label: 'Reflowing' },
                { value: 'fixed', label: 'Like the PDF' },
              ]}
              onChange={setMode}
            />
          </OptionField>
          {mode === 'reflow' ? (
            <>
              <SwitchRow id="ph-images" label="Include images" checked={images} onChange={setImages} />
              <SwitchRow id="ph-rules" label="Mark page boundaries" checked={pageRules} onChange={setPageRules} />
            </>
          ) : null}
          <OptionField label="Password" htmlFor="ph-password" hint="Only for files that need a password to open.">
            <PasswordInput id="ph-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="html-pages.zip" notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
    </ToolFrame>
  );
}
