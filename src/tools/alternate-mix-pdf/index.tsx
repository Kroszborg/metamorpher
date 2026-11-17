'use client';

import { useMemo, useState } from 'react';
import {
  type GridPage,
  named,
  NumberInput,
  outputName,
  PageGrid,
  PageToolLayout,
  usePdfPreviews,
} from '@/components/pdf-pages';
import { Switch } from '@/components/ui/switch';
import { defineJob, OptionField, useWorkbench } from '@/components/workbench';
import type { PageSpec } from '@/engines/pdf';
import type { ToolProps } from '@/tools/types';

type Source = { id: string; count: number; reverse: boolean };
type Options = { sources: readonly Source[]; take: number };

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `F${i + 1}`);

/**
 * Takes `take` pages from each file in turn (each file read backwards when
 * reversed) until every file is used up; longer files simply continue alone.
 */
function mixOrder(sources: readonly Source[], take: number): { file: number; page: number }[] {
  const queues = sources.map((s) => {
    const pages = Array.from({ length: s.count }, (_, i) => i);
    return s.reverse ? pages.reverse() : pages;
  });
  const out: { file: number; page: number }[] = [];
  const pos = queues.map(() => 0);
  const n = Math.max(1, take);
  for (let left = queues.reduce((sum, q) => sum + q.length, 0); left > 0; ) {
    queues.forEach((q, file) => {
      for (let k = 0; k < n && (pos[file] ?? 0) < q.length; k += 1) {
        out.push({ file, page: q[pos[file] ?? 0] ?? 0 });
        pos[file] = (pos[file] ?? 0) + 1;
        left -= 1;
      }
    });
  }
  return out;
}

const job = defineJob<Options>({
  mode: 'batch',
  async run(inputs, { sources, take }, ctx) {
    if (inputs.length < 2) throw new Error('Add at least two PDFs to mix.');
    const byId = new Map(sources.map((s) => [s.id, s]));
    const ordered = inputs.map((i) => {
      const s = byId.get(i.id);
      if (!s) throw new Error(`${i.file.name} is not ready yet.`);
      return s;
    });
    const specs: PageSpec[] = mixOrder(ordered, take);
    ctx.onProgress(0.1, 'Mixing pages');
    const [blob] = await ctx.engines.pdf.pages.assemble(
      inputs.map((i) => named(i.file)),
      [specs],
      { signal: ctx.signal },
    );
    if (!blob) throw new Error('Nothing was produced.');
    const first = inputs[0]?.file;
    return [{ name: first ? outputName(first, 'mixed') : 'mixed.pdf', blob }];
  },
});

export default function AlternateMixPdf({ tool }: ToolProps) {
  const [reverse, setReverse] = useState<Readonly<Record<string, boolean>>>({});
  const [take, setTake] = useState(1);
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const sources = useMemo(
    () =>
      Object.entries(counts).map(([id, count]) => ({ id, count, reverse: reverse[id] ?? false })),
    [counts, reverse],
  );
  const wb = useWorkbench({ job, options: { sources, take }, accept: tool.accept });
  const docs = usePdfPreviews(wb.files);

  // Page counts of the files that are open, keyed by id (kept in state for the job).
  const ready: Record<string, number> = {};
  for (const f of wb.files) {
    const d = docs[f.id];
    if (d?.status === 'ready') ready[f.id] = d.pageCount;
  }
  const same =
    Object.keys(ready).length === Object.keys(counts).length &&
    Object.entries(ready).every(([id, n]) => counts[id] === n);
  if (!same) setCounts(ready);

  const ordered = useMemo(
    () =>
      wb.files.flatMap((f, i) => {
        const count = counts[f.id];
        return count === undefined ? [] : [{ id: f.id, count, reverse: reverse[f.id] ?? false, letter: letter(i) }];
      }),
    [wb.files, counts, reverse],
  );
  const pages: GridPage[] = useMemo(
    () =>
      mixOrder(ordered, take).map(({ file, page }, pos) => {
        const src = ordered[file];
        return {
          key: `${pos}`,
          preview: docs[src?.id ?? '']?.preview ?? null,
          index: page,
          label: `${src?.letter ?? '?'}${page + 1}`,
        };
      }),
    [ordered, take, docs],
  );

  const lengths = new Set(ordered.map((s) => s.count));

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={wb.files.map((f) => docs[f.id]).filter((d) => d !== undefined)}
      multiple
      reorderable
      runLabel="Mix PDFs"
      disabledReason={wb.files.length < 2 ? 'Add at least two PDFs to mix.' : null}
      pagesTitle="Result"
      pagesDescription={`${pages.length} pages · labelled by file (A, B …) and page number`}
      optionsPanel={
        <>
          <OptionField
            label="Order of each file"
            hint="Reverse the backs of a stack scanned on a one-sided scanner, which come out last page first."
          >
            <ul className="flex flex-col gap-1.5">
              {wb.files.map((f, i) => (
                <li key={f.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="grid size-5 shrink-0 place-items-center rounded bg-muted font-mono text-[0.65rem] font-medium">
                    {letter(i)}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={f.file.name}>
                    {f.file.name}
                  </span>
                  <label className="flex shrink-0 items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                    Reverse
                    <Switch
                      checked={reverse[f.id] ?? false}
                      onCheckedChange={(v) => setReverse((r) => ({ ...r, [f.id]: v }))}
                      aria-label={`Reverse ${f.file.name}`}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </OptionField>
          <OptionField label="Pages from each file at a time" htmlFor="am-take">
            <NumberInput id="am-take" value={take} onChange={setTake} min={1} max={100} suffix={take === 1 ? 'page' : 'pages'} />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            {lengths.size > 1
              ? 'The files have different lengths; once a file runs out, the others continue on their own.'
              : 'Drag files in the list to change which comes first.'}{' '}
            Bookmarks and links are kept.
          </p>
        </>
      }
    >
      <PageGrid pages={pages} aria-label="Result pages" disabled={wb.running} />
    </PageToolLayout>
  );
}
