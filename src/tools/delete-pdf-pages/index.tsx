'use client';

import { useMemo } from 'react';
import {
  docPages,
  indicesOf,
  keysOf,
  named,
  outputName,
  PageGrid,
  PageRangeInput,
  PageToolLayout,
  pagesLabel,
  usePdfPreview,
  useScopedState,
} from '@/components/pdf-pages';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

type Options = { remove: ReadonlySet<number>; total: number };

const job = perFile<Options>(async ({ file }, { remove, total }, ctx) => {
  const keep = Array.from({ length: total }, (_, page) => page).filter((p) => !remove.has(p));
  if (keep.length === 0) throw new Error('Every page is marked for deletion. Keep at least one.');
  ctx.onProgress(0.2, 'Removing pages');
  const blob = await ctx.engines.pdf.pages.rewrite(
    named(file),
    keep.map((page) => ({ page })),
    { signal: ctx.signal },
  );
  return { name: outputName(file, `without-${pagesLabel(remove)}`), blob };
});

export default function DeletePdfPages({ tool }: ToolProps) {
  const [opts, setOpts, sync] = useScopedState<Options>({ remove: new Set(), total: 0 });
  const wb = useWorkbench({ job, options: opts, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  sync(doc.status === 'ready' ? input?.id : null, () => ({ remove: new Set(), total: doc.pageCount }));

  const pages = useMemo(
    () => docPages(doc.preview, opts.total, (i) => ({ tone: opts.remove.has(i) ? 'danger' : 'default' })),
    [doc.preview, opts.total, opts.remove],
  );
  const setRemove = (remove: Set<number>) => setOpts((o) => ({ ...o, remove }));
  const left = opts.total - opts.remove.size;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel="Delete pages"
      disabledReason={
        opts.remove.size === 0
          ? 'Select the pages to delete.'
          : left === 0
            ? 'Keep at least one page.'
            : null
      }
      pagesDescription={`${opts.total} pages · click the ones to delete, Shift-click for a range`}
      optionsPanel={
        <>
          <OptionField
            label="Pages to delete"
            htmlFor="dp-range"
            hint={`${left} ${left === 1 ? 'page' : 'pages'} will remain. Bookmarks and links to deleted pages are removed.`}
          >
            <PageRangeInput id="dp-range" total={opts.total} value={opts.remove} onChange={setRemove} />
          </OptionField>
        </>
      }
    >
      {doc.preview ? (
        <PageGrid
          pages={pages}
          selected={keysOf(opts.remove)}
          onSelectedChange={(keys) => setRemove(indicesOf(keys))}
          disabled={wb.running}
          aria-label="Pages to delete"
        />
      ) : null}
    </PageToolLayout>
  );
}
