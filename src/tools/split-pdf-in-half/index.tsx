'use client';

import { useMemo, useState } from 'react';
import {
  buildParts,
  docPages,
  type GridPage,
  named,
  outputName,
  PageGrid,
  PageToolLayout,
  pagesLabel,
  partStarts,
  SwitchRow,
  usePdfPreview,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { PageMargins, PageSpec } from '@/engines/pdf';
import type { ToolProps } from '@/tools/types';

type Options = {
  mode: 'cut' | 'files';
  direction: 'vertical' | 'horizontal';
  /** Right (or bottom) half first, for right-to-left books. */
  reverse: boolean;
  /** Leave the first and last pages whole (covers of a scanned book). */
  keepCovers: boolean;
};

type Half = 'a' | 'b';
const HALF: Record<Options['direction'], Record<Half, PageMargins>> = {
  vertical: {
    a: { left: 0, top: 0, right: 0.5, bottom: 0 },
    b: { left: 0.5, top: 0, right: 0, bottom: 0 },
  },
  horizontal: {
    a: { left: 0, top: 0, right: 0, bottom: 0.5 },
    b: { left: 0, top: 0.5, right: 0, bottom: 0 },
  },
};

/** The output pages of the cut: each source page as a whole, or its two halves in reading order. */
function cutPlan(total: number, o: Options): { page: number; half: Half | null }[] {
  const out: { page: number; half: Half | null }[] = [];
  const order: Half[] = o.reverse ? ['b', 'a'] : ['a', 'b'];
  for (let page = 0; page < total; page += 1) {
    if (o.keepCovers && total > 2 && (page === 0 || page === total - 1)) out.push({ page, half: null });
    else for (const half of order) out.push({ page, half });
  }
  return out;
}

const job = perFile<Options & { total: number }>(async ({ file }, options, ctx) => {
  const { total } = options;
  if (options.mode === 'files') {
    if (total < 2) throw new Error('A one-page PDF cannot be split into two files.');
    const mid = Math.ceil(total / 2);
    const first = Array.from({ length: mid }, (_, i) => i);
    const second = Array.from({ length: total - mid }, (_, i) => mid + i);
    return buildParts(ctx, file, [
      { pages: first, name: outputName(file, pagesLabel(first)) },
      { pages: second, name: outputName(file, pagesLabel(second)) },
    ]);
  }
  ctx.onProgress(0.2, 'Cutting pages');
  const specs: PageSpec[] = cutPlan(total, options).map(({ page, half }) =>
    half ? { page, crop: HALF[options.direction][half] } : { page },
  );
  const blob = await ctx.engines.pdf.pages.rewrite(named(file), specs, { signal: ctx.signal });
  return { name: outputName(file, 'halves'), blob };
});

/** Shades the half of the page that is cut away. */
function CutShade({ direction, keep }: { direction: Options['direction']; keep: Half }) {
  const side =
    direction === 'vertical'
      ? keep === 'a'
        ? 'top-0 right-0 bottom-0 left-1/2'
        : 'top-0 right-1/2 bottom-0 left-0'
      : keep === 'a'
        ? 'top-1/2 right-0 bottom-0 left-0'
        : 'top-0 right-0 bottom-1/2 left-0';
  return (
    <>
      <span className={`absolute ${side} bg-black/45`} />
      <span
        className={
          direction === 'vertical'
            ? 'absolute top-0 bottom-0 left-1/2 border-l border-dashed border-primary'
            : 'absolute top-1/2 right-0 left-0 border-t border-dashed border-primary'
        }
      />
    </>
  );
}

export default function SplitPdfInHalf({ tool }: ToolProps) {
  const [opts, setOpts] = useState<Omit<Options, 'total'>>({
    mode: 'cut',
    direction: 'vertical',
    reverse: false,
    keepCovers: false,
  });
  const [total, setTotal] = useState(0);
  const wb = useWorkbench({ job, options: { ...opts, total }, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  const count = doc.status === 'ready' ? doc.pageCount : 0;
  if (count !== total) setTotal(count);
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOpts((o) => ({ ...o, [key]: value }));

  const plan = useMemo(() => (opts.mode === 'cut' ? cutPlan(total, opts) : []), [total, opts]);
  const pages: GridPage[] = useMemo(() => {
    if (opts.mode === 'files') {
      const mid = Math.ceil(total / 2);
      const starts = partStarts([{ pages: [0] }, { pages: [mid] }]);
      return docPages(doc.preview, total, (i) => ({ badge: total > 1 ? starts.get(i) : undefined }));
    }
    const names: Record<Half, string> =
      opts.direction === 'vertical' ? { a: 'left', b: 'right' } : { a: 'top', b: 'bottom' };
    return plan.map(({ page, half }) => ({
      key: `${page}${half ?? ''}`,
      preview: doc.preview,
      index: page,
      label: half ? `${page + 1} ${names[half]}` : `${page + 1}`,
    }));
  }, [opts.mode, opts.direction, plan, doc.preview, total]);

  const outputs = opts.mode === 'cut' ? plan.length : 2;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel={opts.mode === 'cut' ? 'Cut pages' : 'Split into 2 files'}
      disabledReason={opts.mode === 'files' && total < 2 ? 'A one-page PDF cannot be split into two files.' : null}
      zipName={input ? outputName(input.file, 'halves').replace(/\.pdf$/, '.zip') : undefined}
      pagesDescription={
        opts.mode === 'cut'
          ? `${total} pages → ${outputs} pages · the shaded half is cut away`
          : `${total} pages → 2 files`
      }
      optionsPanel={
        <>
          <OptionField
            label="Split"
            hint={
              opts.mode === 'cut'
                ? 'Each page becomes two pages, for scanned spreads and booklets.'
                : 'The first half of the pages and the second half, as two PDFs.'
            }
          >
            <Segmented
              label="Split"
              value={opts.mode}
              options={[
                { value: 'cut', label: 'Cut every page' },
                { value: 'files', label: 'Two files' },
              ]}
              onChange={(v) => set('mode', v)}
            />
          </OptionField>
          {opts.mode === 'cut' ? (
            <>
              <OptionField label="Cut">
                <Segmented
                  label="Cut"
                  value={opts.direction}
                  options={[
                    { value: 'vertical', label: 'Left | right' },
                    { value: 'horizontal', label: 'Top / bottom' },
                  ]}
                  onChange={(v) => set('direction', v)}
                />
              </OptionField>
              <SwitchRow
                label={opts.direction === 'vertical' ? 'Right half first' : 'Bottom half first'}
                hint={opts.direction === 'vertical' ? 'For books read right to left.' : undefined}
                checked={opts.reverse}
                onChange={(v) => set('reverse', v)}
              />
              <SwitchRow
                label="Keep first and last pages whole"
                hint="For scans whose covers are single pages."
                checked={opts.keepCovers}
                onChange={(v) => set('keepCovers', v)}
              />
              <p className="text-[0.7rem]/relaxed text-muted-foreground">
                Halves are made by cropping, so text and drawings stay sharp and selectable. The hidden half is still
                stored in the file.
              </p>
            </>
          ) : null}
        </>
      }
    >
      {doc.preview ? (
        <PageGrid
          pages={pages}
          aria-label="Output pages"
          disabled={wb.running}
          overlay={
            opts.mode === 'cut'
              ? (page) => {
                  const half = page.key.slice(-1);
                  return half === 'a' || half === 'b' ? <CutShade direction={opts.direction} keep={half} /> : null;
                }
              : undefined
          }
        />
      ) : null}
    </PageToolLayout>
  );
}
