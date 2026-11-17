'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { openPdfDocument, PageRangeField, type PreviewContext, PreviewWorkbench, renderPageToPng } from '@/components/pdf-stage';
import { OptionField, perFile } from '@/components/workbench';
import { type InvertMode, type InvertSpec, pageRangeError, parsePageRange, pdfStamp, type PreviewRequest } from '@/engines/pdf-stamp';
import { abortError } from '@/engines/worker-host';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { mode: InvertMode; pages: string };

/** Rendering resolution for the high-contrast mode. */
const CONTRAST_DPI = 150;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('A page could not be rendered.'))), 'image/png'),
  );
}

/** Renders the chosen pages with pdf.js, one at a time, for the high-contrast overlay. */
async function renderPages(
  file: Blob,
  pages: string,
  signal: AbortSignal,
  onPage: (done: number, total: number) => void,
): Promise<(Blob | null)[]> {
  const { doc, destroy } = await openPdfDocument(file);
  const canvas = document.createElement('canvas');
  try {
    const range = parsePageRange(pages, doc.numPages);
    if ('error' in range) throw new Error(`Pages: ${range.error}`);
    const images: (Blob | null)[] = Array.from({ length: doc.numPages }, () => null);
    for (const [k, index] of range.pages.entries()) {
      if (signal.aborted) throw abortError();
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: CONTRAST_DPI / 72 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      images[index] = await canvasToPng(canvas);
      page.cleanup();
      onPage(k + 1, range.pages.length);
    }
    return images;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await destroy();
  }
}

const job = perFile<Options>(async (input, o, ctx) => {
  let spec: InvertSpec = { mode: o.mode, pages: o.pages };
  if (o.mode === 'contrast') {
    const images = await renderPages(input.file, o.pages, ctx.signal, (done, total) =>
      ctx.onProgress((done / total) * 0.8, `Rendered page ${done} of ${total}`),
    );
    spec = { ...spec, images };
  }
  ctx.onProgress(0.85, 'Writing PDF');
  const blob = await pdfStamp.invert(input.file, spec, ctx.signal);
  const suffix = o.mode === 'invert' ? 'dark' : o.mode;
  return { name: `${baseName(input.file.name)}-${suffix}.pdf`, blob };
});

const preview = async (o: Options, ctx: PreviewContext): Promise<PreviewRequest | null> => {
  if (pageRangeError(o.pages)) return null;
  if (o.mode !== 'contrast') return { kind: 'invert', spec: { mode: o.mode, pages: o.pages } };
  const images: (Blob | null)[] = [];
  images[ctx.page] = await renderPageToPng(ctx.file, ctx.page, 110);
  return { kind: 'invert', spec: { mode: o.mode, pages: o.pages, images: Array.from(images, (b) => b ?? null) } };
};

const validate = (_files: unknown, o: Options) => {
  const range = pageRangeError(o.pages);
  return range ? `Pages: ${range}` : null;
};

const NOTES: Record<InvertMode, string> = {
  invert:
    'Vector: a blend layer inverts every colour, so text stays sharp, selectable and searchable. Photos are inverted too.',
  sepia: 'Vector: a warm paper tone is blended over the page. Text stays sharp, selectable and searchable.',
  contrast:
    'Rasterises: each page is rendered to an image (150 dpi) of white text on black and laid over the original. The text underneath stays selectable and searchable, but the look is no longer vector and files get larger.',
};

export default function InvertPdfColors({ tool }: ToolProps) {
  const [o, setO] = useState<Options>({ mode: 'invert', pages: '' });

  return (
    <PreviewWorkbench
      job={job}
      options={o}
      accept={tool.accept}
      runLabel="Convert colours"
      preview={preview}
      validate={validate}
      zipName="colours.zip"
      previewNote={o.mode === 'contrast' ? 'The preview is rendered at a lower resolution than the output.' : undefined}
      optionsPanel={
        <>
          <OptionField label="Mode" hint={NOTES[o.mode]}>
            <Segmented
              label="Mode"
              value={o.mode}
              options={[
                { value: 'invert', label: 'Dark' },
                { value: 'sepia', label: 'Sepia' },
                { value: 'contrast', label: 'High contrast' },
              ]}
              onChange={(mode) => setO((s) => ({ ...s, mode }))}
            />
          </OptionField>
          <PageRangeField id="ic-pages" value={o.pages} onChange={(pages) => setO((s) => ({ ...s, pages }))} />
        </>
      }
    />
  );
}
