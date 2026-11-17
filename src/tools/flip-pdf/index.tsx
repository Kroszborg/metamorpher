'use client';

import { useMemo, useState } from 'react';
import {
  docPages,
  indicesOf,
  keysOf,
  named,
  outputName,
  PageGrid,
  PageToolLayout,
  usePdfPreview,
  useScopedState,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { Button } from '@/components/ui/button';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

type Direction = 'horizontal' | 'vertical';
type Options = { direction: Direction; only: ReadonlySet<number>; total: number };

const job = perFile<Options>(async ({ file }, { direction, only, total }, ctx) => {
  ctx.onProgress(0.2, 'Mirroring pages');
  const blob = await ctx.engines.pdf.pages.rewrite(
    named(file),
    Array.from({ length: total }, (_, page) => ({
      page,
      flip: only.size === 0 || only.has(page) ? direction : undefined,
    })),
    { signal: ctx.signal },
  );
  return { name: outputName(file, 'flipped'), blob };
});

export default function FlipPdf({ tool }: ToolProps) {
  const [direction, setDirection] = useState<Direction>('horizontal');
  const [sel, setSel, sync] = useScopedState<{ only: ReadonlySet<number>; total: number }>({ only: new Set(), total: 0 });
  const wb = useWorkbench({ job, options: { direction, ...sel }, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  sync(doc.status === 'ready' ? input?.id : null, () => ({ only: new Set(), total: doc.pageCount }));

  const { only, total } = sel;
  const pages = useMemo(
    () => docPages(doc.preview, total, (i) => ({ flip: only.size === 0 || only.has(i) ? direction : undefined })),
    [doc.preview, total, only, direction],
  );

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel="Flip PDF"
      pagesDescription={`${total} pages · ${only.size === 0 ? 'all pages are flipped' : `${only.size} selected`} · click pages to flip only those`}
      pagesAction={
        only.size > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setSel((s) => ({ ...s, only: new Set() }))} disabled={wb.running}>
            Flip all pages
          </Button>
        ) : null
      }
      optionsPanel={
        <>
          <OptionField
            label="Mirror"
            hint={direction === 'horizontal' ? 'Left and right swap, as in a mirror.' : 'Top and bottom swap.'}
          >
            <Segmented
              label="Mirror"
              value={direction}
              options={[
                { value: 'horizontal', label: 'Horizontally' },
                { value: 'vertical', label: 'Vertically' },
              ]}
              onChange={setDirection}
            />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Pages are mirrored as vector content, not re-rendered. Text stays selectable (it reads mirrored), and
            links move with the page.
          </p>
        </>
      }
    >
      {doc.preview ? (
        <PageGrid
          pages={pages}
          selected={keysOf(only)}
          onSelectedChange={(keys) => setSel((s) => ({ ...s, only: indicesOf(keys) }))}
          disabled={wb.running}
          aria-label="Pages to flip"
        />
      ) : null}
    </PageToolLayout>
  );
}
