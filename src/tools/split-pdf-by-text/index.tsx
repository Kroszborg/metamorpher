'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  buildParts,
  containsPhrase,
  docPages,
  outputName,
  PageGrid,
  type Part,
  PageToolLayout,
  partLabel,
  partStarts,
  SwitchRow,
  usePageTexts,
  usePdfPreview,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { Input } from '@/components/ui/input';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import type { ToolProps } from '@/tools/types';

type Where = 'starts' | 'ends';

const job = perFile<{ parts: Part[] }>(async ({ file }, { parts }, ctx) => {
  if (parts.length < 2) throw new Error('The phrase does not split this PDF.');
  return buildParts(ctx, file, parts);
});

/** Consecutive parts cut before (or after) each matching page. */
function plan(file: File | undefined, total: number, matches: readonly number[], where: Where): Part[] {
  if (!file || total === 0 || matches.length === 0) return [];
  const cuts = new Set<number>(); // a part starts at each cut
  for (const m of matches) {
    const at = where === 'starts' ? m : m + 1;
    if (at > 0 && at < total) cuts.add(at);
  }
  const bounds = [0, ...[...cuts].sort((a, b) => a - b), total];
  const ranges: number[][] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const s = bounds[i] ?? 0;
    const e = bounds[i + 1] ?? total;
    ranges.push(Array.from({ length: e - s }, (_, k) => s + k));
  }
  return ranges.map((pages, i) => ({ pages, name: outputName(file, partLabel(pages, i, ranges.length, true)) }));
}

export default function SplitPdfByText({ tool }: ToolProps) {
  const [phrase, setPhrase] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [where, setWhere] = useState<Where>('starts');
  const [source, setSource] = useState<{ file?: File; total: number; matches: readonly number[] }>({
    total: 0,
    matches: [],
  });
  const parts = useMemo(() => plan(source.file, source.total, source.matches, where), [source, where]);
  const wb = useWorkbench({ job, options: { parts }, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  const text = usePageTexts(doc.preview);
  const query = useDeferredValue(phrase);

  const matches = useMemo(() => {
    if (query.trim() === '') return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < text.done; i += 1) if (containsPhrase(text.texts[i] ?? '', query, matchCase)) out.push(i);
    return out;
    // `text.texts` is filled in place; `text.done` says how far.
  }, [text.texts, text.done, query, matchCase]);

  const finished = doc.status === 'ready' && text.done === text.total;
  const file = finished ? input?.file : undefined;
  if (file !== source.file || (file && (source.matches !== matches || source.total !== doc.pageCount))) {
    setSource({ file, total: file ? doc.pageCount : 0, matches: file ? matches : [] });
  }

  const matched = useMemo(() => new Set(matches), [matches]);
  const starts = useMemo(() => partStarts(parts), [parts]);
  const pages = useMemo(
    () =>
      docPages(doc.preview, doc.pageCount, (i) => ({
        badge: starts.get(i),
        label: matched.has(i) ? `${i + 1} · match` : undefined,
      })),
    [doc.preview, doc.pageCount, starts, matched],
  );

  const reading = doc.status === 'ready' && text.done < text.total;
  const noText = finished && text.texts.every((t) => t.trim() === '');
  const reason = text.error
    ? text.error
    : reading
      ? `Reading the text… page ${text.done} of ${text.total}`
      : noText
        ? 'This PDF has no text layer (it may be a scan), so there is nothing to search.'
        : query.trim() === ''
          ? 'Type the phrase that marks a new file.'
          : matches.length === 0
            ? `No page contains “${query.trim()}”.`
            : parts.length < 2
              ? 'The phrase only appears where a file would start anyway, so nothing is split.'
              : null;

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel={parts.length > 1 ? `Split into ${parts.length} files` : 'Split PDF'}
      disabledReason={reason}
      zipName={input ? outputName(input.file, 'split').replace(/\.pdf$/, '.zip') : undefined}
      pagesDescription={
        reading
          ? `${doc.pageCount} pages · reading text ${text.done} of ${text.total}`
          : `${doc.pageCount} pages · ${matches.length} ${matches.length === 1 ? 'page matches' : 'pages match'} · ${parts.length} ${parts.length === 1 ? 'file' : 'files'}`
      }
      optionsPanel={
        <>
          <OptionField label="Phrase" htmlFor="st-phrase" hint="For example “Invoice number” or a heading that begins each section.">
            <Input
              id="st-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="Invoice number"
              autoComplete="off"
            />
          </OptionField>
          <SwitchRow label="Match case" checked={matchCase} onChange={setMatchCase} />
          <OptionField label="A page with the phrase">
            <Segmented
              label="A page with the phrase"
              value={where}
              options={[
                { value: 'starts', label: 'Starts a file' },
                { value: 'ends', label: 'Ends a file' },
              ]}
              onChange={setWhere}
            />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Searches the PDF&rsquo;s text layer on this device. Scanned pages need OCR first.
          </p>
        </>
      }
    >
      {doc.preview ? <PageGrid pages={pages} aria-label="Pages" disabled={wb.running} /> : null}
    </PageToolLayout>
  );
}
