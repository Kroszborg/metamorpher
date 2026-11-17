'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, perFile, QualitySlider, Workbench } from '@/components/workbench';
import type { RenderFormat } from '@/engines/pdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { format: RenderFormat; dpi: number; quality: number };

const job = perFile<Options>(async ({ file }, { format, dpi, quality }, ctx) => {
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const base = baseName(file.name);
  const zip = new ctx.engines.archive.ZipWriter();
  const kept: { single?: Blob } = {};

  const total = await ctx.engines.pdf.renderPages(file, {
    dpi,
    format,
    quality,
    signal: ctx.signal,
    onPage: async ({ index, total, blob }) => {
      ctx.onProgress((index + 1) / total, `Page ${index + 1} of ${total}`);
      if (total === 1) {
        kept.single = blob;
        return;
      }
      // Stream each page into the ZIP so rendered pages are not all held at once.
      const n = String(index + 1).padStart(String(total).length, '0');
      await zip.add(`${base}-page-${n}.${ext}`, blob);
    },
  });

  if (total === 1 && kept.single) return { name: `${base}.${ext}`, blob: kept.single };
  return { name: `${base}-pages.zip`, blob: zip.finish() };
});

export default function PdfToImages({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ format: 'png', dpi: 150, quality: 0.9 });

  return (
    <Workbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Convert to images"
      zipName="pdf-images.zip"
      optionsPanel={
        <>
          <OptionField label="Format">
            <Segmented
              label="Format"
              value={options.format}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPG' },
              ]}
              onChange={(format) => setOptions((o) => ({ ...o, format }))}
            />
          </OptionField>
          <OptionField label="Resolution" hint="Multi-page PDFs download as one ZIP per PDF.">
            <Segmented
              label="Resolution"
              value={options.dpi}
              options={[
                { value: 72, label: '72 dpi' },
                { value: 150, label: '150 dpi' },
                { value: 300, label: '300 dpi' },
              ]}
              onChange={(dpi) => setOptions((o) => ({ ...o, dpi }))}
            />
          </OptionField>
          {options.format === 'jpeg' ? (
            <OptionField label="Quality" htmlFor="pi-quality">
              <QualitySlider
                id="pi-quality"
                value={options.quality}
                onChange={(quality) => setOptions((o) => ({ ...o, quality }))}
              />
            </OptionField>
          ) : null}
        </>
      }
    />
  );
}
