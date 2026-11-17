'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  docPages,
  named,
  NumberInput,
  outputName,
  PageGrid,
  PageToolLayout,
  partLabel,
  usePdfPreview,
  withProgress,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Unit = 'KB' | 'MB';
const FACTOR: Record<Unit, number> = { KB: 1024, MB: 1024 * 1024 };

const job = perFile<{ maxBytes: number }>(async ({ file }, { maxBytes }, ctx) => {
  ctx.onProgress(0.02, 'Reading the PDF');
  const parts = await withProgress(
    ctx,
    (done, total) => [done / total, `Page ${done} of ${total}`],
    (onProgress) => ctx.engines.pdf.pages.splitBySize(named(file), maxBytes, { signal: ctx.signal, onProgress }),
  );
  const over = parts.filter((p) => p.oversized);
  if (over.length > 0) {
    const list = over.map((p) => p.start + 1).join(', ');
    toast.warning(
      `${over.length === 1 ? 'Page' : 'Pages'} ${list} of ${file.name} ${over.length === 1 ? 'is' : 'are'} larger than ${formatBytes(maxBytes)} on ${over.length === 1 ? 'its' : 'their'} own, so ${over.length === 1 ? 'that part is' : 'those parts are'} over the limit.`,
    );
  }
  return parts.map((p, i) => {
    const pages = Array.from({ length: p.end - p.start + 1 }, (_, k) => p.start + k);
    return { name: outputName(file, partLabel(pages, i, parts.length, true)), blob: p.blob };
  });
});

export default function SplitPdfBySize({ tool }: ToolProps) {
  const [amount, setAmount] = useState(10);
  const [unit, setUnit] = useState<Unit>('MB');
  const maxBytes = Math.round(amount * FACTOR[unit]);
  const wb = useWorkbench({ job, options: { maxBytes }, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  const pages = useMemo(() => docPages(doc.preview, doc.pageCount), [doc.preview, doc.pageCount]);
  const size = input?.file.size ?? 0;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel="Split PDF"
      disabledReason={
        size > 0 && size <= maxBytes
          ? `This PDF is ${formatBytes(size)}, already under ${formatBytes(maxBytes)}.`
          : doc.pageCount === 1
            ? 'This PDF has a single page and cannot be split.'
            : null
      }
      zipName={input ? outputName(input.file, 'parts').replace(/\.pdf$/, '.zip') : undefined}
      pagesDescription={`${doc.pageCount} pages · ${formatBytes(size)}`}
      optionsPanel={
        <>
          <OptionField
            label="Largest part"
            htmlFor="ss-size"
            hint="Parts are consecutive pages, each as large as fits. A single page larger than the limit becomes its own part."
          >
            <div className="flex items-center gap-2">
              <NumberInput
                id="ss-size"
                value={amount}
                onChange={setAmount}
                min={unit === 'KB' ? 10 : 0.1}
                max={unit === 'KB' ? 1024 * 1024 : 4096}
                step={unit === 'KB' ? 50 : 0.5}
                decimals
              />
              <Segmented
                label="Unit"
                value={unit}
                options={[
                  { value: 'KB', label: 'KB' },
                  { value: 'MB', label: 'MB' },
                ]}
                onChange={setUnit}
              />
            </div>
          </OptionField>
          {size > maxBytes && maxBytes > 0 ? (
            <p className="text-[0.7rem]/relaxed text-muted-foreground">
              About {Math.ceil(size / maxBytes)} or more parts. Each part carries its own copy of the fonts and
              images it uses, so the parts together can be larger than the original.
            </p>
          ) : null}
        </>
      }
    >
      {doc.preview ? <PageGrid pages={pages} aria-label="Pages" disabled={wb.running} /> : null}
    </PageToolLayout>
  );
}
