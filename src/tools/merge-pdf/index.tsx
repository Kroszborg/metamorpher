'use client';

import { defineJob, Workbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

const job = defineJob<null>({
  mode: 'batch',
  async run(inputs, _options, ctx) {
    const blob = await ctx.engines.pdf.merge(
      inputs.map((i) => ({ name: i.file.name, blob: i.file })),
      {
        signal: ctx.signal,
        onProgress: (done, total) => ctx.onProgress(done / total, `Added ${done} of ${total}`),
      },
    );
    return [{ name: 'merged.pdf', blob }];
  },
});

export default function MergePdf({ tool }: ToolProps) {
  return (
    <Workbench
      job={job}
      options={null}
      accept={tool.accept}
      reorderable
      minFiles={2}
      runLabel="Merge PDFs"
    />
  );
}
