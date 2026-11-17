'use client';

import { useMemo, useState } from 'react';
import {
  buildParts,
  docPages,
  formatPageRanges,
  outputName,
  PageGrid,
  type Part,
  PageToolLayout,
  partOfPage,
  SwitchRow,
  usePdfPreview,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { OutlineEntry } from '@/engines/pdf';
import type { ToolProps } from '@/tools/types';

type Planned = Part & { title: string };

const job = perFile<{ parts: Planned[] }>(async ({ file }, { parts }, ctx) => buildParts(ctx, file, parts));

/**
 * One part per bookmark at `depth` levels or above, from its page to the page
 * before the next one. Bookmarks on the same page share a part (the first
 * title wins); pages before the first bookmark become a "front matter" part.
 */
function plan(
  file: File | undefined,
  outline: readonly OutlineEntry[],
  total: number,
  depth: number,
  front: boolean,
): Planned[] {
  if (!file || total === 0) return [];
  const starts = new Map<number, string>();
  for (const e of outline) {
    if (e.level >= depth || e.page === null || e.page < 0 || e.page >= total) continue;
    if (!starts.has(e.page)) starts.set(e.page, e.title.trim() || `Page ${e.page + 1}`);
  }
  const sorted = [...starts.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) return [];
  const ranges: { title: string; start: number; end: number }[] = [];
  const first = sorted[0]?.[0] ?? 0;
  if (first > 0 && front) ranges.push({ title: 'Front matter', start: 0, end: first - 1 });
  sorted.forEach(([start, title], i) => {
    const next = sorted[i + 1]?.[0] ?? total;
    ranges.push({ title, start, end: next - 1 });
  });
  const width = String(ranges.length).length;
  return ranges.map((r, i) => ({
    title: r.title,
    pages: Array.from({ length: r.end - r.start + 1 }, (_, k) => r.start + k),
    name: outputName(file, `${String(i + 1).padStart(Math.max(2, width), '0')} ${r.title}`),
  }));
}

export default function SplitPdfByBookmarks({ tool }: ToolProps) {
  const [depth, setDepth] = useState(1);
  const [front, setFront] = useState(true);
  const [source, setSource] = useState<{ file?: File; outline: readonly OutlineEntry[]; total: number }>({
    outline: [],
    total: 0,
  });
  const parts = useMemo(
    () => plan(source.file, source.outline, source.total, depth, front),
    [source, depth, front],
  );
  const wb = useWorkbench({ job, options: { parts }, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  const ready = doc.status === 'ready' ? input : undefined;
  if (ready?.file !== source.file) {
    setSource({ file: ready?.file, outline: ready ? doc.outline : [], total: ready ? doc.pageCount : 0 });
  }

  const levels = useMemo(() => Math.min(4, 1 + Math.max(-1, ...source.outline.map((e) => e.level))), [source.outline]);
  const owner = useMemo(() => partOfPage(parts), [parts]);
  const badges = useMemo(() => new Map(parts.map((p) => [p.pages[0] ?? -1, p.title])), [parts]);
  const pages = useMemo(
    () =>
      docPages(doc.preview, doc.pageCount, (i) => ({
        badge: badges.get(i),
        tone: owner.has(i) ? 'default' : 'muted',
      })),
    [doc.preview, doc.pageCount, badges, owner],
  );
  const hasOutline = source.outline.length > 0;
  const firstStart = useMemo(() => {
    const starts = source.outline.filter((e) => e.level < depth && e.page !== null).map((e) => e.page ?? 0);
    return starts.length > 0 ? Math.min(...starts) : 0;
  }, [source.outline, depth]);

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel={parts.length > 1 ? `Split into ${parts.length} files` : 'Split PDF'}
      disabledReason={
        !hasOutline
          ? 'This PDF has no bookmarks. Use Split PDF to split it by page ranges.'
          : parts.length === 0
            ? 'No bookmark points at a page in this PDF.'
            : null
      }
      zipName={input ? outputName(input.file, 'chapters').replace(/\.pdf$/, '.zip') : undefined}
      pagesDescription={
        hasOutline
          ? `${doc.pageCount} pages · ${parts.length} ${parts.length === 1 ? 'file' : 'files'}`
          : `${doc.pageCount} pages · no bookmarks`
      }
      optionsPanel={
        hasOutline ? (
          <>
            {levels > 1 ? (
              <OptionField label="Split at" hint="Deeper levels make more, smaller files.">
                <Segmented
                  label="Split at"
                  value={Math.min(depth, levels)}
                  options={Array.from({ length: levels }, (_, i) => ({
                    value: i + 1,
                    label: i === 0 ? 'Top level' : `Level ${i + 1}`,
                  }))}
                  onChange={setDepth}
                />
              </OptionField>
            ) : null}
            {firstStart > 0 ? (
              <SwitchRow
                label={`Keep ${firstStart === 1 ? 'page 1' : `pages 1-${firstStart}`} (before the first bookmark)`}
                checked={front}
                onChange={setFront}
              />
            ) : null}
            <OptionField label={`${parts.length} ${parts.length === 1 ? 'file' : 'files'}`}>
              <ol className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border p-1 text-xs">
                {parts.map((p) => (
                  <li key={p.name} className="flex items-baseline gap-2 rounded px-1.5 py-0.5">
                    <span className="min-w-0 flex-1 truncate" title={p.title}>
                      {p.title}
                    </span>
                    <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground tabular-nums">
                      {formatPageRanges(p.pages)}
                    </span>
                  </li>
                ))}
              </ol>
            </OptionField>
            <p className="text-[0.7rem]/relaxed text-muted-foreground">
              Each file keeps the bookmarks and links that point inside it.
            </p>
          </>
        ) : null
      }
    >
      {doc.preview ? <PageGrid pages={pages} aria-label="Pages" disabled={wb.running} /> : null}
    </PageToolLayout>
  );
}
