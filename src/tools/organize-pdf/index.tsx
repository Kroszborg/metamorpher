'use client';

import {
  ArrowDataTransferHorizontalIcon,
  Copy01Icon,
  Delete02Icon,
  RotateLeft01Icon,
  RotateRight01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMemo, useState } from 'react';
import {
  type GridPage,
  named,
  outputName,
  PageGrid,
  PageToolLayout,
  TileAction,
  usePdfPreviews,
} from '@/components/pdf-pages';
import { Button } from '@/components/ui/button';
import { defineJob, OptionField, useWorkbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

/** One page of the output: which file and page it comes from and its extra rotation. */
type Item = { key: string; fileId: string; page: number; turn: number };
type State = {
  items: readonly Item[];
  /** Files whose pages have been added (so a removed page is not added back). */
  known: readonly string[];
  selected: ReadonlySet<string>;
  serial: number;
};

const norm = (deg: number) => ((deg % 360) + 360) % 360;
const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `F${i + 1}`);

const job = defineJob<{ items: readonly Item[] }>({
  mode: 'batch',
  async run(inputs, { items }, ctx) {
    if (items.length === 0) throw new Error('There are no pages left.');
    const index = new Map(inputs.map((input, i) => [input.id, i]));
    const specs = items.map((it) => {
      const file = index.get(it.fileId);
      if (file === undefined) throw new Error('A page refers to a file that was removed.');
      return { file, page: it.page, rotate: norm(it.turn) };
    });
    const used = [...new Set(specs.map((s) => s.file))];
    const first = inputs[used[0] ?? 0]?.file;
    const name = first ? outputName(first, 'organized') : 'organized.pdf';
    ctx.onProgress(0.1, 'Arranging pages');
    let blob: Blob;
    if (used.length === 1 && first) {
      // One source: rewrite it in place, keeping forms, tags, layers and attachments.
      blob = await ctx.engines.pdf.pages.rewrite(
        named(first),
        specs.map(({ page, rotate }) => ({ page, rotate })),
        { signal: ctx.signal },
      );
    } else {
      const [out] = await ctx.engines.pdf.pages.assemble(
        inputs.map((i) => named(i.file)),
        [specs],
        { signal: ctx.signal },
      );
      if (!out) throw new Error('Nothing was produced.');
      blob = out;
    }
    return [{ name, blob }];
  },
});

const EMPTY: State = { items: [], known: [], selected: new Set(), serial: 0 };

export default function OrganizePdf({ tool }: ToolProps) {
  const [state, setState] = useState<State>(EMPTY);
  const wb = useWorkbench({ job, options: { items: state.items }, accept: tool.accept });
  const docs = usePdfPreviews(wb.files);

  // Bring the page list in line with the file list: add pages of newly opened
  // files at the end, drop pages of removed files.
  const ids = wb.files.map((f) => f.id);
  const readyNew = wb.files.filter((f) => !state.known.includes(f.id) && docs[f.id]?.status === 'ready');
  const gone = state.known.filter((id) => !ids.includes(id));
  if (readyNew.length > 0 || gone.length > 0) {
    const added: Item[] = readyNew.flatMap((f) =>
      Array.from({ length: docs[f.id]?.pageCount ?? 0 }, (_, page) => ({
        key: `${f.id}:${page}`,
        fileId: f.id,
        page,
        turn: 0,
      })),
    );
    const items = [...state.items.filter((it) => !gone.includes(it.fileId)), ...added];
    const keys = new Set(items.map((it) => it.key));
    setState({
      items,
      known: [...state.known.filter((id) => !gone.includes(id)), ...readyNew.map((f) => f.id)],
      selected: new Set([...state.selected].filter((k) => keys.has(k))),
      serial: state.serial,
    });
  }

  const { items, selected } = state;
  const multi = wb.files.length > 1;
  const letters = useMemo(() => new Map(wb.files.map((f, i) => [f.id, letter(i)])), [wb.files]);
  const pages: GridPage[] = useMemo(
    () =>
      items.map((it) => ({
        key: it.key,
        preview: docs[it.fileId]?.preview ?? null,
        index: it.page,
        rotation: it.turn,
        label: multi ? `${letters.get(it.fileId) ?? '?'}${it.page + 1}` : it.page + 1,
      })),
    [items, docs, multi, letters],
  );

  const update = (fn: (s: State) => Partial<State>) => setState((s) => ({ ...s, ...fn(s) }));
  const targets = (s: State, key?: string) => (key ? new Set([key]) : s.selected);
  const rotate = (by: number, key?: string) =>
    update((s) => {
      const t = targets(s, key);
      return { items: s.items.map((it) => (t.has(it.key) ? { ...it, turn: norm(it.turn + by) } : it)) };
    });
  const remove = (key?: string) =>
    update((s) => {
      const t = targets(s, key);
      return { items: s.items.filter((it) => !t.has(it.key)), selected: new Set([...s.selected].filter((k) => !t.has(k))) };
    });
  const duplicate = (key?: string) =>
    update((s) => {
      const t = targets(s, key);
      let serial = s.serial;
      const out: Item[] = [];
      for (const it of s.items) {
        out.push(it);
        if (t.has(it.key)) out.push({ ...it, key: `dup${(serial += 1)}` });
      }
      return { items: out, serial };
    });
  const move = (from: number, to: number) =>
    update((s) => {
      const next = [...s.items];
      const [it] = next.splice(from, 1);
      if (it) next.splice(to, 0, it);
      return { items: next };
    });
  const reverse = () => update((s) => ({ items: [...s.items].reverse() }));
  const resetPages = () => setState({ ...EMPTY, serial: state.serial });

  const sources = wb.files.map((f) => docs[f.id]).filter((d) => d?.status === 'ready');
  const original = sources.reduce((sum, d) => sum + (d?.pageCount ?? 0), 0);
  const n = selected.size;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={wb.files.map((f) => docs[f.id]).filter((d) => d !== undefined)}
      multiple
      runLabel="Save PDF"
      disabledReason={items.length === 0 ? 'There are no pages left. Use Reset to start over.' : null}
      pagesDescription={`${items.length} pages${original !== items.length ? ` (from ${original})` : ''} · drag to reorder, hover a page for actions`}
      pagesAction={
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={reverse} disabled={wb.running || items.length < 2}>
            <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} strokeWidth={2} />
            Reverse
          </Button>
          <Button variant="ghost" size="sm" onClick={resetPages} disabled={wb.running}>
            Reset
          </Button>
        </div>
      }
      optionsPanel={
        <>
          <OptionField
            label={n > 0 ? `${n} selected ${n === 1 ? 'page' : 'pages'}` : 'Selected pages'}
            hint={n > 0 ? undefined : 'Click pages to select them, Shift-click for a range, Ctrl+A for all.'}
          >
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="outline" size="sm" disabled={n === 0} onClick={() => rotate(-90)}>
                <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} />
                Left
              </Button>
              <Button variant="outline" size="sm" disabled={n === 0} onClick={() => rotate(90)}>
                <HugeiconsIcon icon={RotateRight01Icon} strokeWidth={2} />
                Right
              </Button>
              <Button variant="outline" size="sm" disabled={n === 0} onClick={() => duplicate()}>
                <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                Duplicate
              </Button>
              <Button variant="outline" size="sm" disabled={n === 0} onClick={() => remove()}>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                Delete
              </Button>
            </div>
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            {multi
              ? 'Pages are labelled by file (A, B …) and page number. Files added later are appended. Bookmarks and links are kept for pages that stay.'
              : 'Forms, bookmarks and links are kept for the pages that stay. Add more PDFs to combine them.'}
          </p>
        </>
      }
    >
      <PageGrid
        pages={pages}
        selected={selected}
        onSelectedChange={(next) => update(() => ({ selected: next }))}
        onMove={move}
        actions={(page) => (
          <>
            <TileAction icon={RotateRight01Icon} label="Rotate right" onClick={() => rotate(90, page.key)} />
            <TileAction icon={Copy01Icon} label="Duplicate" onClick={() => duplicate(page.key)} />
            <TileAction icon={Delete02Icon} label="Delete" tone="danger" onClick={() => remove(page.key)} />
          </>
        )}
        disabled={wb.running}
        aria-label="Pages"
      />
    </PageToolLayout>
  );
}
