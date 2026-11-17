'use client';

import { Copy01Icon, Delete02Icon, Download04Icon, Loading03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AnswerModePanel, answerWith, useAnswerer } from '@/components/ai/answer-mode';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { Button } from '@/components/ui/button';
import { Dropzone, OptionField, RunBar } from '@/components/workbench';
import { isAbortError } from '@/engines/worker-host';
import { DocumentError, loadDocument, type LoadedDoc } from '@/lib/ai/documents';
import { chaptersOf, type SummaryStyle, summarize } from '@/lib/ai/summarize';
import { baseName, downloadBlob, newId } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type DocState =
  | { state: 'loading'; file: File }
  | { state: 'ready'; file: File; doc: LoadedDoc; outline: { title: string; level: number; page: number }[] | null }
  | { state: 'error'; file: File; error: string; scanned: boolean };

const STYLES: { value: SummaryStyle; label: string; hint: string }[] = [
  { value: 'short', label: 'Short', hint: 'One paragraph.' },
  { value: 'detailed', label: 'Detailed', hint: 'An overview and every main point, with key numbers.' },
  { value: 'bullets', label: 'Bullets', hint: '5–10 key points, most important first.' },
  { value: 'chapters', label: 'Per chapter', hint: 'A few sentences per chapter (from the PDF bookmarks, or groups of pages).' },
];

async function toPdf(markdown: string, title: string): Promise<Blob> {
  const [{ markdownToHtml }, { prepareHtml }, typeset] = await Promise.all([
    import('@/components/doc-tools/markdown'),
    import('@/components/doc-tools/html'),
    import('@/engines/typeset'),
  ]);
  const md = await markdownToHtml(`# ${title}\n\n${markdown}`);
  const html = await prepareHtml(md.html, { resources: new Map(), keepStyles: true });
  const result = await typeset.typesetEngine.render({
    blocks: [{ kind: 'html', html: html.body }],
    css: `${typeset.documentCss({ fontSize: 10.5, font: 'sans' })}\n${html.css}`,
    page: typeset.pageGeometry(typeset.defaultPageSize(), 'portrait', 'normal'),
    fontSize: 10.5,
    outline: true,
    pageNumbers: true,
    title,
  });
  return result.blob;
}

export default function SummarizePdf({ tool }: ToolProps) {
  const [entry, setEntry] = useState<(DocState & { id: string }) | null>(null);
  const [style, setStyle] = useState<SummaryStyle>('short');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string | undefined>();
  const [summary, setSummary] = useState<{ text: string; via: string; style: SummaryStyle; done: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const answerer = useAnswerer('summarize-pdf');

  useEffect(() => () => ctrl.current?.abort(), []);

  const addFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const id = newId('d');
    setEntry({ id, state: 'loading', file });
    setSummary(null);
    setError(null);
    loadDocument(file, id).then(
      async (doc) => {
        let outline: { title: string; level: number; page: number }[] | null = null;
        if (doc.kind === 'pdf') {
          const { pdfEngine } = await import('@/engines/pdf');
          outline = await pdfEngine.pages.inspect({ name: file.name, blob: file }).then(
            (i) => i.outline.flatMap((o) => (o.page === null ? [] : [{ title: o.title, level: o.level, page: o.page }])),
            () => null,
          );
        }
        setEntry((e) => (e?.id === id ? { id, state: 'ready', file, doc, outline } : e));
      },
      (err: unknown) =>
        setEntry((e) =>
          e?.id === id
            ? {
                id,
                state: 'error',
                file,
                error: err instanceof Error ? err.message : 'This file could not be read.',
                scanned: err instanceof DocumentError && err.scanned,
              }
            : e,
        ),
    );
  };

  const budget = answerer.mode === 'cloud' ? 24_000 : answerer.local.plan?.device === 'webgpu' ? 3_500 : 2_000;
  const doc = entry?.state === 'ready' ? entry.doc : null;
  const chapters = doc && style === 'chapters' ? chaptersOf(doc.pages, entry?.state === 'ready' ? entry.outline : null, doc.unit) : null;

  const run = async () => {
    if (!doc || answerer.blocked) return;
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setProgress(0);
    setNote('Starting');
    setError(null);
    const via = answerer.label;
    setSummary({ text: '', via, style, done: false });
    try {
      const text = await summarize(
        { title: baseName(doc.name), pages: doc.pages, unit: doc.unit, sections: chapters },
        style,
        {
          budget,
          signal: c.signal,
          complete: (messages, { maxTokens, onText }) =>
            answerWith(answerer, messages, {
              signal: c.signal,
              maxTokens: answerer.mode === 'cloud' ? maxTokens * 2 : maxTokens,
              onText: onText ? (_d, full) => onText(full) : undefined,
            }),
          onProgress: (done, total, n) => {
            setProgress(Math.min(0.99, done / Math.max(1, total)));
            setNote(n);
          },
          onText: (full) => setSummary({ text: full, via, style, done: false }),
        },
      );
      setSummary({ text, via, style, done: true });
      setProgress(1);
    } catch (err) {
      if (isAbortError(err)) {
        setSummary(null);
        setNote('Cancelled');
      } else {
        setError(err instanceof Error ? err.message : 'Summarising failed.');
        setSummary((s) => (s?.text ? { ...s, done: true } : null));
      }
    } finally {
      setRunning(false);
      ctrl.current = null;
    }
  };

  const name = entry ? baseName(entry.file.name) : 'summary';
  const reason = !entry
    ? 'Add a document to start.'
    : entry.state === 'loading'
      ? 'Reading the document…'
      : entry.state === 'error'
        ? 'This document cannot be summarised.'
        : answerer.blocked;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title="Document"
            description="PDF, Word, Markdown or text. The text is read on this device."
            action={
              entry ? (
                <Button variant="ghost" size="sm" disabled={running} onClick={() => setEntry(null)}>
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  Clear
                </Button>
              ) : null
            }
            contentClassName="flex flex-col gap-3"
          >
            {entry ? (
              <div className="text-xs" data-doc-state={entry.state}>
                <p className="truncate font-medium">{entry.file.name}</p>
                {entry.state === 'loading' ? <p className="text-muted-foreground">Reading text…</p> : null}
                {entry.state === 'ready' ? (
                  <p className="text-muted-foreground">
                    {entry.doc.pages.length} {entry.doc.unit === 'page' ? 'pages' : 'sections'} ·{' '}
                    {entry.doc.chars.toLocaleString()} characters
                    {entry.outline?.length ? ` · ${entry.outline.length} bookmarks` : ''}
                  </p>
                ) : null}
                {entry.state === 'error' ? (
                  <p role="alert" className="text-destructive">
                    {entry.error}{' '}
                    {entry.scanned ? (
                      <Link href="/tools/ocr-pdf" className="text-primary underline">
                        Open OCR
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}
            <Dropzone accept={tool.accept} multiple={false} compact={!!entry} onFiles={addFiles} disabled={running} />
          </SectionCard>

          {summary ? (
            <SectionCard
              title={summary.done ? 'Summary' : 'Summarising…'}
              description={summary.via}
              action={
                summary.done && summary.text ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(summary.text).then(() => toast.success('Copied'))}
                    >
                      <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-action="download-md"
                      onClick={() =>
                        downloadBlob(
                          new Blob([`# ${name}\n\n${summary.text}\n`], { type: 'text/markdown;charset=utf-8' }),
                          `${name}-summary.md`,
                        )
                      }
                    >
                      <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                      Markdown
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pdfBusy}
                      data-action="download-pdf"
                      onClick={async () => {
                        setPdfBusy(true);
                        try {
                          downloadBlob(await toPdf(summary.text, `Summary of ${name}`), `${name}-summary.pdf`);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'The PDF could not be made.');
                        } finally {
                          setPdfBusy(false);
                        }
                      }}
                    >
                      {pdfBusy ? (
                        <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
                      ) : (
                        <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                      )}
                      PDF
                    </Button>
                  </div>
                ) : null
              }
            >
              <div data-summary={summary.done ? 'done' : 'running'} className="whitespace-pre-wrap text-sm/relaxed">
                {summary.text || <span className="text-muted-foreground">Waiting for the model…</span>}
              </div>
            </SectionCard>
          ) : null}
          {error ? (
            <p role="alert" data-summary-error className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs/relaxed text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-0">
          <SectionCard title="Options" contentClassName="flex flex-col gap-4">
            <fieldset disabled={running} className="flex min-w-0 flex-col gap-4">
              <OptionField label="Summary" hint={STYLES.find((s) => s.value === style)?.hint}>
                <Segmented<SummaryStyle>
                  label="Summary"
                  value={style}
                  options={STYLES.map(({ value, label }) => ({ value, label }))}
                  onChange={setStyle}
                />
              </OptionField>
              {chapters ? (
                <p className="text-[0.7rem]/relaxed text-muted-foreground">
                  {chapters.length} chapter{chapters.length === 1 ? '' : 's'}:{' '}
                  {chapters.slice(0, 6).map((c) => c.title).join(' · ')}
                  {chapters.length > 6 ? ' …' : ''}
                </p>
              ) : null}
              <AnswerModePanel
                answerer={answerer}
                idPrefix="sum"
                sends={`the document's text in parts of up to ${budget.toLocaleString()} characters (${
                  doc ? `about ${Math.max(1, Math.ceil(doc.chars / budget))} request${doc.chars > budget ? 's' : ''} for this document, plus a few to combine the notes` : 'one request per part'
                })`}
              />
              {doc && answerer.mode === 'device' && doc.chars > budget * 8 ? (
                <p className="text-[0.7rem]/relaxed text-warning">
                  This is a long document for an on-device model: about {Math.ceil(doc.chars / budget)} passes. It may
                  take several minutes.
                </p>
              ) : null}
            </fieldset>
          </SectionCard>
          <RunBar
            label="Summarise"
            running={running}
            progress={progress}
            note={note}
            disabledReason={reason}
            onRun={run}
            onCancel={() => ctrl.current?.abort()}
          />
        </div>
      </div>
    </div>
  );
}
