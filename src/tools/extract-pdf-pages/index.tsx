'use client';

import { useMemo, useState } from 'react';
import {
  buildParts,
  docPages,
  indicesOf,
  keysOf,
  outputName,
  PageGrid,
  PageRangeInput,
  type Part,
  PageToolLayout,
  pagesLabel,
  usePdfPreview,
  useScopedState,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

type Options = { pick: ReadonlySet<number>; separate: boolean };

const job = perFile<Options>(async ({ file }, { pick, separate }, ctx) => {
  const pages = [...pick].sort((a, b) => a - b);
  if (pages.length === 0) throw new Error('Select at least one page.');
  const parts: Part[] = separate
    ? pages.map((p) => ({ pages: [p], name: outputName(file, pagesLabel([p])) }))
    : [{ pages, name: outputName(file, pagesLabel(pages)) }];
  return buildParts(ctx, file, parts, { note: 'File' });
});

export default function ExtractPdfPages({ tool }: ToolProps) {
  const [separate, setSeparate] = useState(false);
  const [pick, setPick, sync] = useScopedState<ReadonlySet<number>>(new Set());
  const wb = useWorkbench({ job, options: { pick, separate }, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  sync(doc.status === 'ready' ? input?.id : null, () => new Set());

  const total = doc.pageCount;
  const pages = useMemo(() => docPages(doc.preview, total), [doc.preview, total]);
  const n = pick.size;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel={separate && n > 1 ? `Extract ${n} files` : 'Extract pages'}
      disabledReason={n === 0 ? 'Select the pages to extract.' : null}
      zipName={input ? outputName(input.file, 'pages').replace(/\.pdf$/, '.zip') : undefined}
      pagesDescription={`${total} pages · click the ones to keep, Shift-click for a range`}
      optionsPanel={
        <>
          <OptionField label="Pages to extract" htmlFor="ep-range">
            <PageRangeInput id="ep-range" total={total} value={pick} onChange={setPick} />
          </OptionField>
          <OptionField
            label="Save as"
            hint={
              separate
                ? 'Each selected page becomes its own PDF.'
                : 'The selected pages, in page order, in one new PDF.'
            }
          >
            <Segmented
              label="Save as"
              value={separate ? 'separate' : 'one'}
              options={[
                { value: 'one', label: 'One PDF' },
                { value: 'separate', label: 'One per page' },
              ]}
              onChange={(v) => setSeparate(v === 'separate')}
            />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            The original is not changed. Bookmarks and links between extracted pages are kept.
          </p>
        </>
      }
    >
      {doc.preview ? (
        <PageGrid
          pages={pages}
          selected={keysOf(pick)}
          onSelectedChange={(keys) => setPick(indicesOf(keys))}
          disabled={wb.running}
          aria-label="Pages to extract"
        />
      ) : null}
    </PageToolLayout>
  );
}
