'use client';

import {
  ArrowUp02Icon,
  Delete02Icon,
  Download04Icon,
  Loading03Icon,
  StopIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnswerModePanel, answerWith, useAnswerer } from '@/components/ai/answer-mode';
import { ModelGate } from '@/components/ai/model-gate';
import { useLocalModel } from '@/components/ai/use-local-model';
import { SectionCard } from '@/components/kit/section-card';
import { PdfStage, SwitchRow } from '@/components/pdf-stage';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dropzone } from '@/components/workbench';
import { localAi } from '@/engines/ai';
import { isAbortError } from '@/engines/worker-host';
import { clearChat, fingerprint, loadChat, saveChat, type StoredSource, type StoredTurn } from '@/lib/ai/chat-store';
import { DocumentError, loadDocument, type LoadedDoc } from '@/lib/ai/documents';
import {
  ANSWER_SYSTEM_PROMPT,
  buildIndex,
  buildPassages,
  formatExcerpts,
  type Hit,
  type Index,
  search,
  splitCitations,
} from '@/lib/ai/rag';
import type { ChatMessage } from '@/lib/ai/types';
import { baseName, downloadBlob, newId } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';

type DocEntry =
  | { id: string; file: File; state: 'loading'; progress: number }
  | { id: string; file: File; state: 'ready'; doc: LoadedDoc }
  | { id: string; file: File; state: 'error'; error: string; scanned: boolean };

type Turn = StoredTurn & { id: string; status: 'streaming' | 'done' | 'error'; error?: string };

const HISTORY_TURNS = { cloud: 3, device: 1 } as const;

function sourcesOf(used: readonly Hit[]): StoredSource[] {
  return used.map((h, i) => ({ n: i + 1, docName: h.passage.docName, unit: h.passage.unit, page: h.passage.page }));
}

/** A turn that has just been asked (module scope: reads the clock). */
function newTurn(id: string, question: string, sources: StoredSource[], via: string): Turn {
  return { id, question, answer: '', sources, via, at: Date.now(), status: 'streaming' };
}

function sourceLabel(s: StoredSource, multi: boolean): string {
  const unit = s.unit === 'page' ? 'p.' : '§';
  return multi ? `${s.docName} ${unit} ${s.page}` : `${unit} ${s.page}`;
}

function toMarkdown(names: string[], turns: readonly Turn[]): string {
  const multi = names.length > 1;
  const lines = [`# Chat about ${names.join(', ')}`, ''];
  for (const t of turns) {
    lines.push(`**Q:** ${t.question}`, '', t.answer.trim() || `_${t.error ?? 'No answer.'}_`, '');
    if (t.sources.length) {
      lines.push(`Sources: ${t.sources.map((s) => `[${s.n}] ${sourceLabel(s, multi || true)}`).join('; ')}`, '');
    }
    lines.push(`_Answered with ${t.via}, ${new Date(t.at).toLocaleString()}_`, '', '---', '');
  }
  return lines.join('\n');
}

export default function ChatWithPdf({ tool }: ToolProps) {
  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatKey, setChatKey] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<{ docId: string; page: number } | null>(null);
  const [remember, setRemember] = useState(true);
  const [smartSearch, setSmartSearch] = useState(false);
  const [vectors, setVectors] = useState<{ index: Index; vectors: Float32Array[] } | null>(null);
  const running = useRef<AbortController | null>(null);
  const answerer = useAnswerer('chat-with-pdf');
  const embedder = useLocalModel('embed', 'minilm-l6', 'chat-with-pdf-embed');
  const listEnd = useRef<HTMLDivElement>(null);

  const docs = entries.flatMap((e) => (e.state === 'ready' ? [e.doc] : []));
  const docKey = docs.map((d) => d.id).join('|');
  const [indexed, setIndexed] = useState<{ key: string; index: Index } | null>(null);
  if (indexed?.key !== docKey) {
    // Rebuilt during render when the document set changes (cheap: pure string work).
    setIndexed({ key: docKey, index: buildIndex(buildPassages(docs)) });
  }
  const index = indexed?.key === docKey ? indexed.index : null;
  const busy = turns.some((t) => t.status === 'streaming');
  const multi = docs.length > 1;

  // On-device embeddings for the passages, when enabled and downloaded.
  const embedPlan = embedder.plan;
  useEffect(() => {
    if (!smartSearch || embedder.status !== 'ready' || !index || index.passages.length === 0) return;
    if (!embedPlan || embedPlan.device === null) return;
    if (vectors?.index === index) return;
    let live = true;
    localAi
      .embed(
        embedder.spec,
        index.passages.map((p) => p.text),
        { device: embedPlan.device },
      )
      .then(
        (v) => live && setVectors({ index, vectors: v }),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [smartSearch, embedder.status, embedder.spec, embedPlan, index, vectors]);
  const vectorsReady = !!index && vectors?.index === index;

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [turns]);

  useEffect(() => () => running.current?.abort(), []);

  const refreshChat = async (list: DocEntry[]) => {
    const files = list.map((e) => e.file);
    if (files.length === 0) {
      setChatKey(null);
      setTurns([]);
      return;
    }
    const key = await fingerprint(files);
    setChatKey(key);
    const stored = await loadChat(key);
    setTurns(stored.map((t) => ({ ...t, id: newId('t'), status: 'done' })));
  };

  const addFiles = (files: File[]) => {
    const fresh: DocEntry[] = files.map((file) => ({ id: newId('d'), file, state: 'loading', progress: 0 }));
    const next = [...entries, ...fresh];
    setEntries(next);
    void refreshChat(next);
    for (const e of fresh) {
      loadDocument(e.file, e.id, {
        onProgress: (p) =>
          setEntries((list) => list.map((x) => (x.id === e.id && x.state === 'loading' ? { ...x, progress: p } : x))),
      }).then(
        (doc) => {
          setEntries((list) => list.map((x) => (x.id === e.id ? { id: e.id, file: e.file, state: 'ready', doc } : x)));
          setPreview((p) => p ?? { docId: doc.id, page: 1 });
        },
        (err: unknown) =>
          setEntries((list) =>
            list.map((x) =>
              x.id === e.id
                ? {
                    id: e.id,
                    file: e.file,
                    state: 'error',
                    error: err instanceof Error ? err.message : 'This file could not be read.',
                    scanned: err instanceof DocumentError && err.scanned,
                  }
                : x,
            ),
          ),
      );
    }
  };

  const removeEntry = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    if (preview?.docId === id) setPreview(null);
    void refreshChat(next);
  };

  const persist = (all: Turn[]) => {
    if (!remember || !chatKey) return;
    void saveChat(
      chatKey,
      all
        .filter((t) => t.status === 'done')
        .map(({ question: q, answer, sources, via, at }) => ({ question: q, answer, sources, via, at })),
      entries.map((e) => e.file.name).join(', '),
    );
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || !index || busy || answerer.blocked) return;
    setQuestion('');
    const controller = new AbortController();
    running.current = controller;

    let qvec: Float32Array | undefined;
    if (vectorsReady && embedPlan && embedPlan.device) {
      qvec = (await localAi.embed(embedder.spec, [q], { device: embedPlan.device }).catch(() => []))[0];
    }
    const idx: Index = vectorsReady && vectors ? { ...index, vectors: vectors.vectors } : index;
    let hits = search(idx, q, 12, qvec);
    // Nothing matched ("summarise this"): start from the beginning of the documents.
    if (hits.length === 0) hits = index.passages.slice(0, 12).map((passage) => ({ passage, score: 0 }));
    const { text: excerpts, used } = formatExcerpts(hits, answerer.budget);
    const sources = sourcesOf(used);
    const via = answerer.label;
    const id = newId('t');
    const turn = newTurn(id, q, sources, via);
    const prior = turns.filter((t) => t.status === 'done').slice(-HISTORY_TURNS[answerer.mode]);
    setTurns((all) => [...all, turn]);
    if (sources[0]) {
      const doc = docs.find((d) => d.name === sources[0]?.docName);
      if (doc) setPreview({ docId: doc.id, page: sources[0].page });
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: ANSWER_SYSTEM_PROMPT },
      ...prior.flatMap((t): ChatMessage[] => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.answer },
      ]),
      { role: 'user', content: `Excerpts:\n\n${excerpts}\n\nQuestion: ${q}` },
    ];
    const update = (patch: Partial<Turn>) =>
      setTurns((all) => {
        const next = all.map((t) => (t.id === id ? { ...t, ...patch } : t));
        if (patch.status === 'done') persist(next);
        return next;
      });
    try {
      const answer = await answerWith(answerer, messages, {
        signal: controller.signal,
        onText: (_d, full) => update({ answer: full }),
        maxTokens: answerer.mode === 'cloud' ? 2048 : 400,
      });
      update({ answer, status: 'done' });
    } catch (err) {
      if (isAbortError(err)) update({ status: 'done', answer: '' });
      else update({ status: 'error', error: err instanceof Error ? err.message : 'The answer failed.' });
    } finally {
      if (running.current === controller) running.current = null;
    }
  };

  const previewDoc = docs.find((d) => d.id === preview?.docId) ?? docs[0] ?? null;
  const previewPage = previewDoc && preview?.docId === previewDoc.id ? preview.page : 1;

  const jump = (s: StoredSource) => {
    const doc = docs.find((d) => d.name === s.docName);
    if (doc) setPreview({ docId: doc.id, page: s.page });
  };

  const chip = (s: StoredSource, key: string) => (
    <button
      key={key}
      type="button"
      data-cite-page={s.page}
      data-cite-doc={s.docName}
      onClick={() => jump(s)}
      title={`${s.docName}, ${s.unit} ${s.page}`}
      className="mx-0.5 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-px align-baseline text-[0.7rem] font-medium text-primary hover:bg-primary/20"
    >
      {sourceLabel(s, multi)}
    </button>
  );

  const loading = entries.some((e) => e.state === 'loading');
  const passages = index?.passages.length ?? 0;
  const canAsk = !!question.trim() && passages > 0 && !busy && !answerer.blocked;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title="Documents"
            description={
              entries.length === 0
                ? 'PDF, Word, Markdown or text. Read on this device; nothing is uploaded.'
                : `${docs.length} ready · ${passages} passages indexed on this device${vectorsReady ? ' · smart search on' : ''}`
            }
            contentClassName="flex flex-col gap-3"
          >
            {entries.map((e) => (
              <div key={e.id} data-doc-state={e.state} className="flex items-start gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.file.name}</p>
                  {e.state === 'loading' ? (
                    <p className="text-muted-foreground">Reading text… {Math.round(e.progress * 100)}%</p>
                  ) : e.state === 'ready' ? (
                    <p className="text-muted-foreground">
                      {e.doc.pages.length} {e.doc.unit === 'page' ? 'pages' : 'sections'} ·{' '}
                      {e.doc.chars.toLocaleString()} characters
                      {e.doc.emptyPages ? ` · ${e.doc.emptyPages} pages without text` : ''}
                    </p>
                  ) : (
                    <p role="alert" className="text-destructive">
                      {e.error}{' '}
                      {e.scanned ? (
                        <Link href="/tools/ocr-pdf" className="text-primary underline">
                          Open OCR
                        </Link>
                      ) : null}
                    </p>
                  )}
                </div>
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${e.file.name}`} onClick={() => removeEntry(e.id)}>
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
            ))}
            <Dropzone accept={tool.accept} multiple compact={entries.length > 0} onFiles={addFiles} disabled={busy} />
          </SectionCard>

          {previewDoc ? (
            <SectionCard
              title="Preview"
              description={`${previewDoc.name} · ${previewDoc.unit} ${previewPage} of ${previewDoc.pages.length}`}
              contentClassName="p-0"
            >
              {previewDoc.kind === 'pdf' ? (
                <PdfStage
                  file={previewDoc.file}
                  page={previewPage - 1}
                  onPageChange={(p) => setPreview({ docId: previewDoc.id, page: p + 1 })}
                  className="h-[34rem]"
                />
              ) : (
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={previewPage <= 1}
                      onClick={() => setPreview({ docId: previewDoc.id, page: previewPage - 1 })}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={previewPage >= previewDoc.pages.length}
                      onClick={() => setPreview({ docId: previewDoc.id, page: previewPage + 1 })}
                    >
                      Next
                    </Button>
                  </div>
                  <pre
                    data-section-preview={previewPage}
                    className="max-h-[30rem] overflow-auto whitespace-pre-wrap font-sans text-xs/relaxed text-muted-foreground"
                  >
                    {previewDoc.pages[previewPage - 1]}
                  </pre>
                </div>
              )}
            </SectionCard>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="Answer settings" contentClassName="flex flex-col gap-4">
            <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
              <AnswerModePanel
                answerer={answerer}
                idPrefix="cwp"
                sends={`your question, ${
                  HISTORY_TURNS[answerer.mode] === 1 ? 'the previous question and answer' : `the last ${HISTORY_TURNS.cloud} questions and answers`
                } and the most relevant passages from your documents (up to about ${answerer.budget.toLocaleString()} characters, listed under each answer as sources)`}
              />
              <SwitchRow
                id="cwp-smart"
                label="Smart search (on-device embeddings)"
                checked={smartSearch}
                onChange={setSmartSearch}
              />
              {smartSearch ? (
                <ModelGate model={embedder} id="cwp-embed" />
              ) : (
                <p className="-mt-2 text-[0.7rem]/relaxed text-muted-foreground">
                  Passages are found with keyword search on this device. Smart search also matches meaning (one-time
                  24 MB model). Either way, finding passages never leaves this device.
                </p>
              )}
            </fieldset>
          </SectionCard>

          <SectionCard
            title="Chat"
            description={
              remember
                ? 'Questions and answers are saved on this device for these files (not the files themselves).'
                : 'This conversation is kept in memory only.'
            }
            action={
              turns.length > 0 ? (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-action="export-chat"
                    onClick={() =>
                      downloadBlob(
                        new Blob([toMarkdown(docs.map((d) => d.name), turns)], { type: 'text/markdown;charset=utf-8' }),
                        `${docs[0] ? baseName(docs[0].name) : 'chat'}-chat.md`,
                      )
                    }
                  >
                    <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                    Markdown
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setTurns([]);
                      if (chatKey) void clearChat(chatKey);
                    }}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                    Clear
                  </Button>
                </div>
              ) : null
            }
            contentClassName="flex flex-col gap-3"
          >
            <div className="flex max-h-[32rem] min-h-40 flex-col gap-4 overflow-y-auto pr-1" data-chat-log>
              {turns.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {docs.length === 0 ? 'Add a document, then ask a question about it.' : 'Ask anything about your documents.'}
                </p>
              ) : null}
              {turns.map((t) => (
                <div key={t.id} className="flex flex-col gap-2" data-turn={t.status}>
                  <p className="self-end rounded-xl rounded-br-sm bg-primary px-3 py-1.5 text-xs/relaxed text-primary-foreground">
                    {t.question}
                  </p>
                  <div className="rounded-xl rounded-bl-sm border bg-muted/30 px-3 py-2 text-xs/relaxed">
                    {t.status === 'streaming' && !t.answer ? (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-3.5 animate-spin" />
                        Thinking…
                      </span>
                    ) : null}
                    <div className="whitespace-pre-wrap" data-answer>
                      {splitCitations(t.answer, t.sources).map((seg, i) =>
                        typeof seg === 'string' ? (
                          <span key={i}>{seg}</span>
                        ) : (
                          <span key={i}>{seg.map((c) => chip(c.hit, `${i}-${c.n}`))}</span>
                        ),
                      )}
                    </div>
                    {t.status === 'error' ? (
                      <p role="alert" className="mt-1 text-destructive" data-answer-error>
                        {t.error}
                      </p>
                    ) : null}
                    {t.sources.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-y-1 border-t pt-2 text-[0.7rem] text-muted-foreground" data-sources>
                        Sources:{t.sources.map((s) => chip(s, `src-${s.n}`))}
                      </div>
                    ) : null}
                    <p className="mt-1 text-[0.65rem] text-faint">{t.via}</p>
                  </div>
                </div>
              ))}
              <div ref={listEnd} />
            </div>

            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                placeholder={docs.length ? 'Ask a question about the document…' : 'Add a document first'}
                disabled={docs.length === 0}
                aria-label="Question"
                className="max-h-40"
              />
              <div className="flex items-center justify-between gap-2">
                <p className={cn('text-[0.7rem]/relaxed', answerer.blocked && docs.length ? 'text-warning' : 'text-muted-foreground')}>
                  {loading ? 'Reading documents…' : docs.length && answerer.blocked ? answerer.blocked : answerer.label}
                </p>
                {busy ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => running.current?.abort()}>
                    <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" size="sm" disabled={!canAsk} data-action="ask">
                    <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
                    Ask
                  </Button>
                )}
              </div>
              <label className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                Remember this chat on this device
              </label>
            </form>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
