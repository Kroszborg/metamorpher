'use client';

import { useMemo, useState } from 'react';
import {
  buildParts,
  chunkPages,
  docPages,
  NumberInput,
  outputName,
  PageGrid,
  type Part,
  PageToolLayout,
  pagesLabel,
  parsePageRanges,
  partOfPage,
  partStarts,
  rangesToIndices,
  SwitchRow,
  usePdfPreview,
  useScopedState,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { Input } from '@/components/ui/input';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

type Mode = 'ranges' | 'every' | 'single';

const job = perFile<{ parts: Part[] }>(async ({ file }, { parts }, ctx) => buildParts(ctx, file, parts));

/** The ranges, every-N or one-per-page split of `total` pages, or a message saying what is wrong. */
function planParts(
  file: File | undefined,
  total: number,
  mode: Mode,
  text: string,
  every: number,
  rest: boolean,
): { parts: Part[]; error: string | null } {
  if (!file || total === 0) return { parts: [], error: null };
  let groups: number[][];
  if (mode === 'single') groups = Array.from({ length: total }, (_, i) => [i]);
  else if (mode === 'every') groups = chunkPages(total, every).map((r) => rangesToIndices([r]));
  else {
    const parsed = parsePageRanges(text, total);
    if (parsed.error) return { parts: [], error: parsed.error };
    groups = parsed.ranges.map((r) => rangesToIndices([r]));
    if (rest && groups.length > 0) {
      const used = new Set(groups.flat());
      const left = Array.from({ length: total }, (_, i) => i).filter((i) => !used.has(i));
      if (left.length > 0) groups.push(left);
    }
  }
  return { parts: groups.map((pages) => ({ pages, name: outputName(file, pagesLabel(pages)) })), error: null };
}

function halves(total: number): string {
  if (total < 2) return '1';
  const mid = Math.ceil(total / 2);
  return `1-${mid}, ${mid + 1}-${total}`;
}

export default function SplitPdf({ tool }: ToolProps) {
  const [mode, setMode] = useState<Mode>('ranges');
  const [every, setEvery] = useState(2);
  const [rest, setRest] = useState(false);
  const [doc0, setDoc0] = useState<{ total: number; file?: File }>({ total: 0 });
  const [text, setText, syncText] = useScopedState('');

  const plan = useMemo(
    () => planParts(doc0.file, doc0.total, mode, text, every, rest),
    [doc0, mode, text, every, rest],
  );
  const wb = useWorkbench({ job, options: { parts: plan.parts }, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  const ready = doc.status === 'ready' ? input : undefined;
  syncText(ready?.id, () => halves(doc.pageCount));
  if (ready?.file !== doc0.file) setDoc0({ total: ready ? doc.pageCount : 0, file: ready?.file });

  const total = doc.pageCount;
  const starts = useMemo(() => partStarts(plan.parts), [plan.parts]);
  const owner = useMemo(() => partOfPage(plan.parts), [plan.parts]);
  const pages = useMemo(
    () =>
      docPages(doc.preview, total, (i) => ({
        badge: starts.get(i),
        tone: owner.has(i) ? 'default' : 'muted',
      })),
    [doc.preview, total, starts, owner],
  );

  const count = plan.parts.length;
  const reason = plan.error
    ? plan.error
    : count === 0
      ? 'Type the page ranges to split into.'
      : mode === 'every' && count === 1
        ? `The PDF has only ${total} pages; choose fewer pages per file.`
        : null;
  const leftOut = total - owner.size;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel={count > 1 ? `Split into ${count} files` : 'Split PDF'}
      disabledReason={reason}
      zipName={input ? outputName(input.file, 'split').replace(/\.pdf$/, '.zip') : undefined}
      pagesDescription={`${total} pages · ${count} ${count === 1 ? 'file' : 'files'}${leftOut > 0 && count > 0 ? ` · ${leftOut} left out` : ''}`}
      optionsPanel={
        <>
          <OptionField label="Split">
            <Segmented
              label="Split"
              value={mode}
              options={[
                { value: 'ranges', label: 'By ranges' },
                { value: 'every', label: 'Every N' },
                { value: 'single', label: 'Every page' },
              ]}
              onChange={setMode}
            />
          </OptionField>
          {mode === 'ranges' ? (
            <>
              <OptionField
                label="Page ranges"
                htmlFor="sp-ranges"
                hint="Each comma-separated range becomes one file, e.g. 1-3, 4-10, 11-."
              >
                <Input
                  id="sp-ranges"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="1-3, 4-10, 11-"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={plan.error ? true : undefined}
                  className="font-mono"
                />
                {plan.error ? <p className="text-[0.7rem]/relaxed text-destructive">{plan.error}</p> : null}
              </OptionField>
              <SwitchRow
                label="Save the other pages too"
                hint="Pages not in any range go into one more file."
                checked={rest}
                onChange={setRest}
              />
            </>
          ) : null}
          {mode === 'every' ? (
            <OptionField label="Pages per file" htmlFor="sp-every">
              <NumberInput id="sp-every" value={every} onChange={setEvery} min={1} max={Math.max(1, total)} suffix="pages" />
            </OptionField>
          ) : null}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Pages are copied as they are. Bookmarks and links are kept when their target page is in the same file.
          </p>
        </>
      }
    >
      {doc.preview ? <PageGrid pages={pages} aria-label="Pages" disabled={wb.running} /> : null}
    </PageToolLayout>
  );
}
