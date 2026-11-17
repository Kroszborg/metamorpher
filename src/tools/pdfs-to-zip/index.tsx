'use client';

import { defineJob, Workbench } from '@/components/workbench';
import { isAbortError } from '@/engines';
import type { ToolProps } from '@/tools/types';

const job = defineJob<null>({
  mode: 'batch',
  async run(inputs, _options, ctx) {
    // PDFs are already compressed, so they are stored as they are; repeated
    // names get " (2)" suffixes inside the archive.
    const zip = new ctx.engines.archive.ZipWriter();
    for (const [i, input] of inputs.entries()) {
      if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        await zip.add(input.file.name, input.file);
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw new Error(`${input.file.name} could not be read. Remove it and try again.`);
      }
      ctx.onProgress((i + 1) / inputs.length, `Added ${i + 1} of ${inputs.length}`);
    }
    return [{ name: 'pdfs.zip', blob: zip.finish() }];
  },
});

export default function PdfsToZip({ tool }: ToolProps) {
  return <Workbench job={job} options={null} accept={tool.accept} runLabel="Create ZIP" />;
}
