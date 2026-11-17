'use client';

import { RotateLeft01Icon, RotateRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMemo } from 'react';
import {
  docPages,
  indicesOf,
  keysOf,
  named,
  outputName,
  PageGrid,
  PageToolLayout,
  TileAction,
  usePdfPreview,
  useScopedState,
} from '@/components/pdf-pages';
import { Button } from '@/components/ui/button';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

/** Extra clockwise rotation per page index, normalised to 0/90/180/270 (0 is left out). */
type Turns = Readonly<Record<number, number>>;
type State = { turns: Turns; selected: ReadonlySet<number>; total: number };

const norm = (deg: number) => ((deg % 360) + 360) % 360;

const job = perFile<State>(async ({ file }, { turns, total }, ctx) => {
  if (!Object.values(turns).some((t) => norm(t) !== 0)) throw new Error('No page is rotated.');
  ctx.onProgress(0.2, 'Rotating pages');
  const blob = await ctx.engines.pdf.pages.rewrite(
    named(file),
    Array.from({ length: total }, (_, page) => ({ page, rotate: norm(turns[page] ?? 0) })),
    { signal: ctx.signal },
  );
  return { name: outputName(file, 'rotated'), blob };
});

export default function RotatePdf({ tool }: ToolProps) {
  const [state, setState, sync] = useScopedState<State>({ turns: {}, selected: new Set(), total: 0 });
  const wb = useWorkbench({ job, options: state, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  sync(doc.status === 'ready' ? input?.id : null, () => ({ turns: {}, selected: new Set(), total: doc.pageCount }));

  const { turns, selected, total } = state;
  const pages = useMemo(
    () => docPages(doc.preview, total, (i) => ({ rotation: turns[i] ?? 0 })),
    [doc.preview, total, turns],
  );

  const turn = (indices: Iterable<number>, by: number) =>
    setState((s) => {
      const next: Record<number, number> = { ...s.turns };
      for (const i of indices) {
        const v = norm((next[i] ?? 0) + by);
        if (v === 0) delete next[i];
        else next[i] = v;
      }
      return { ...s, turns: next };
    });
  const targets = () => (selected.size > 0 ? [...selected] : Array.from({ length: total }, (_, i) => i));
  const rotated = Object.keys(turns).length;
  const scope = selected.size > 0 ? `${selected.size} selected ${selected.size === 1 ? 'page' : 'pages'}` : 'all pages';

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel="Rotate PDF"
      disabledReason={rotated === 0 ? 'Rotate at least one page.' : null}
      pagesDescription={`${total} pages · ${rotated} rotated · select pages to rotate only those`}
      pagesAction={
        rotated > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setState((s) => ({ ...s, turns: {} }))} disabled={wb.running}>
            Reset
          </Button>
        ) : null
      }
      optionsPanel={
        <>
          <OptionField label={`Rotate ${scope}`} hint="Rotation is stored in the page; nothing is re-rendered.">
            <div className="grid grid-cols-3 gap-1.5">
              <Button variant="outline" size="sm" onClick={() => turn(targets(), -90)}>
                <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} />
                Left
              </Button>
              <Button variant="outline" size="sm" onClick={() => turn(targets(), 90)}>
                <HugeiconsIcon icon={RotateRight01Icon} strokeWidth={2} />
                Right
              </Button>
              <Button variant="outline" size="sm" onClick={() => turn(targets(), 180)}>
                180°
              </Button>
            </div>
          </OptionField>
          {selected.size > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => setState((s) => ({ ...s, selected: new Set() }))}
            >
              Clear selection
            </Button>
          ) : null}
        </>
      }
    >
      {doc.preview ? (
        <PageGrid
          pages={pages}
          selected={keysOf(selected)}
          onSelectedChange={(keys) => setState((s) => ({ ...s, selected: indicesOf(keys) }))}
          actions={(page) => (
            <>
              <TileAction icon={RotateLeft01Icon} label={`Rotate page ${page.index + 1} left`} onClick={() => turn([page.index], -90)} />
              <TileAction icon={RotateRight01Icon} label={`Rotate page ${page.index + 1} right`} onClick={() => turn([page.index], 90)} />
            </>
          )}
          disabled={wb.running}
          aria-label="Pages"
        />
      ) : null}
    </PageToolLayout>
  );
}
