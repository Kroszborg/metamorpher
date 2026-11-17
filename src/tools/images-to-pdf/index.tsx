'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { defineJob, OptionField, OptionSelect, Workbench } from '@/components/workbench';
import { type ImagePageLayout, PAGE_SIZES, type PageSize } from '@/engines/pdf';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

const SIZES: { value: PageSize; label: string }[] = [
  ...(Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]).map((k) => ({
    value: k,
    label: PAGE_SIZES[k].label,
  })),
  { value: 'fit', label: 'Fit to image' },
];

const job = defineJob<ImagePageLayout>({
  mode: 'batch',
  async run(inputs, layout, ctx) {
    const blob = await ctx.engines.pdf.imagesToPdf(
      inputs.map((i) => ({ name: i.file.name, blob: i.file })),
      layout,
      {
        signal: ctx.signal,
        onProgress: (done, total) => ctx.onProgress(done / total, `Image ${done} of ${total}`),
      },
    );
    const first = inputs[0];
    const name = inputs.length === 1 && first ? `${baseName(first.file.name)}.pdf` : 'images.pdf';
    return [{ name, blob }];
  },
});

export default function ImagesToPdf({ tool }: ToolProps) {
  const [layout, setLayout] = useState<ImagePageLayout>({
    pageSize: 'a4',
    orientation: 'auto',
    margin: 18,
  });
  const set = <K extends keyof ImagePageLayout>(key: K, value: ImagePageLayout[K]) =>
    setLayout((l) => ({ ...l, [key]: value }));

  return (
    <Workbench
      job={job}
      options={layout}
      accept={tool.accept}
      reorderable
      runLabel="Create PDF"
      optionsPanel={
        <>
          <OptionField
            label="Page size"
            htmlFor="ip-size"
            hint={layout.pageSize === 'fit' ? 'Each page takes the size of its image.' : undefined}
          >
            <OptionSelect id="ip-size" value={layout.pageSize} options={SIZES} onChange={(v) => set('pageSize', v)} />
          </OptionField>
          {layout.pageSize === 'fit' ? null : (
            <OptionField label="Orientation">
              <Segmented
                label="Orientation"
                value={layout.orientation}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'portrait', label: 'Portrait' },
                  { value: 'landscape', label: 'Landscape' },
                ]}
                onChange={(v) => set('orientation', v)}
              />
            </OptionField>
          )}
          <OptionField label="Margin">
            <Segmented
              label="Margin"
              value={layout.margin}
              options={[
                { value: 0, label: 'None' },
                { value: 18, label: 'Small' },
                { value: 36, label: 'Large' },
              ]}
              onChange={(v) => set('margin', v)}
            />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            PNG and JPG are embedded without re-compression. Other formats are converted to PNG.
          </p>
        </>
      }
    />
  );
}
