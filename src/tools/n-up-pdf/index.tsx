'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  docPages,
  named,
  outputName,
  PageGrid,
  PageToolLayout,
  SwitchRow,
  usePdfPreview,
  withProgress,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect, perFile, useWorkbench } from '@/components/workbench';
import { type NupOptions, PAGE_SIZES, type PreviewPageInfo } from '@/engines/pdf';
import type { ToolProps } from '@/tools/types';

type SheetKey = keyof typeof PAGE_SIZES | 'same';
type Options = Omit<NupOptions, 'sheet'> & { sheetKey: SheetKey };

const SHEETS: { value: SheetKey; label: string }[] = [
  { value: 'same', label: 'Same as the pages' },
  ...(Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]).map((k) => ({ value: k, label: PAGE_SIZES[k].label })),
];

const GRIDS: Record<NupOptions['perSheet'], [number, number][]> = {
  2: [
    [2, 1],
    [1, 2],
  ],
  4: [[2, 2]],
  6: [
    [3, 2],
    [2, 3],
  ],
  9: [[3, 3]],
  16: [[4, 4]],
};

/** The same choice the engine makes: the orientation and grid that show the pages largest. */
function layout(o: Options, first: { width: number; height: number }) {
  const base = o.sheetKey === 'same' ? first : PAGE_SIZES[o.sheetKey];
  const short = Math.min(base.width, base.height);
  const long = Math.max(base.width, base.height);
  const orientations: [number, number][] =
    o.orientation === 'portrait' ? [[short, long]] : o.orientation === 'landscape' ? [[long, short]] : [[short, long], [long, short]];
  let best = { score: -1, W: short, H: long, cols: 1, rows: 1 };
  for (const [W, H] of orientations) {
    for (const [cols, rows] of GRIDS[o.perSheet]) {
      const cellW = (W - o.margin * (cols + 1)) / cols;
      const cellH = (H - o.margin * (rows + 1)) / rows;
      const score = Math.min(cellW / first.width, cellH / first.height);
      if (score > best.score) best = { score, W, H, cols, rows };
    }
  }
  return best;
}

const job = perFile<Options>(async ({ file }, { sheetKey, ...rest }, ctx) => {
  ctx.onProgress(0.05, 'Reading the PDF');
  const sheet = sheetKey === 'same' ? null : { width: PAGE_SIZES[sheetKey].width, height: PAGE_SIZES[sheetKey].height };
  const blob = await withProgress(
    ctx,
    (done, total) => [done / total, `Page ${done} of ${total}`],
    (onProgress) => ctx.engines.pdf.pages.nup(named(file), { ...rest, sheet }, { signal: ctx.signal, onProgress }),
  );
  return { name: outputName(file, `${rest.perSheet}-up`), blob };
});

function SheetSketch({ o, first, total }: { o: Options; first: PreviewPageInfo | null; total: number }) {
  if (!first) return null;
  const { W, H, cols, rows } = layout(o, first);
  const scale = 112 / Math.max(W, H);
  const per = cols * rows;
  const pad = Math.max(1.5, o.margin * scale);
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid shrink-0 rounded-sm bg-white shadow-sm ring-1 ring-black/15"
        style={{
          width: W * scale,
          height: H * scale,
          padding: pad,
          gap: pad,
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gridAutoFlow: o.order === 'rows' ? 'row' : 'column',
        }}
        aria-hidden
      >
        {Array.from({ length: per }, (_, k) => (
          <span
            key={k}
            className={`grid place-items-center rounded-[2px] bg-zinc-200 font-mono text-[0.6rem] text-zinc-600 ${o.border ? 'ring-1 ring-zinc-400' : ''}`}
          >
            {k + 1}
          </span>
        ))}
      </div>
      <p className="text-[0.7rem]/relaxed text-muted-foreground">
        {cols} × {rows} on {W > H ? 'landscape' : 'portrait'} {Math.round(W)} × {Math.round(H)} pt sheets.{' '}
        {Math.ceil(total / per)} {Math.ceil(total / per) === 1 ? 'sheet' : 'sheets'} for {total} pages.
      </p>
    </div>
  );
}

export default function NUpPdf({ tool }: ToolProps) {
  const [o, setO] = useState<Options>({
    perSheet: 2,
    sheetKey: 'a4',
    orientation: 'auto',
    order: 'rows',
    margin: 18,
    border: false,
  });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setO((p) => ({ ...p, [key]: value }));
  const wb = useWorkbench({ job, options: o, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  const pages = useMemo(() => docPages(doc.preview, doc.pageCount), [doc.preview, doc.pageCount]);

  const [first, setFirst] = useState<{ preview: unknown; info: PreviewPageInfo } | null>(null);
  useEffect(() => {
    const preview = doc.preview;
    if (!preview) return;
    let live = true;
    preview.pageInfo(0).then(
      (info) => live && setFirst({ preview, info }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [doc.preview]);
  const firstInfo = first && first.preview === doc.preview ? first.info : null;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel="Create sheets"
      pagesDescription={`${doc.pageCount} pages`}
      optionsPanel={
        <>
          <OptionField label="Pages per sheet">
            <Segmented
              label="Pages per sheet"
              value={o.perSheet}
              options={([2, 4, 6, 9, 16] as const).map((n) => ({ value: n, label: String(n) }))}
              onChange={(v) => set('perSheet', v)}
            />
          </OptionField>
          <OptionField label="Sheet size" htmlFor="nu-sheet">
            <OptionSelect id="nu-sheet" value={o.sheetKey} options={SHEETS} onChange={(v) => set('sheetKey', v)} />
          </OptionField>
          <OptionField label="Orientation">
            <Segmented
              label="Orientation"
              value={o.orientation}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onChange={(v) => set('orientation', v)}
            />
          </OptionField>
          <OptionField label="Order">
            <Segmented
              label="Order"
              value={o.order}
              options={[
                { value: 'rows', label: 'Across, then down' },
                { value: 'columns', label: 'Down, then across' },
              ]}
              onChange={(v) => set('order', v)}
            />
          </OptionField>
          <OptionField label="Margins and gaps">
            <Segmented
              label="Margins and gaps"
              value={o.margin}
              options={[
                { value: 0, label: 'None' },
                { value: 9, label: 'Small' },
                { value: 18, label: 'Medium' },
                { value: 36, label: 'Large' },
              ]}
              onChange={(v) => set('margin', v)}
            />
          </OptionField>
          <SwitchRow label="Draw a border around each page" checked={o.border} onChange={(v) => set('border', v)} />
          <SheetSketch o={o} first={firstInfo} total={doc.pageCount} />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Pages are placed as vector graphics, scaled to fit. Links and bookmarks are not carried over to the sheets.
          </p>
        </>
      }
    >
      {doc.preview ? <PageGrid pages={pages} aria-label="Pages" disabled={wb.running} /> : null}
    </PageToolLayout>
  );
}
