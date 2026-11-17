'use client';

import { Cancel01Icon, Delete02Icon, Loading03Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { PdfStage, type StageView, SwitchRow } from '@/components/pdf-stage';
import { EngineNote, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES, type MupdfSession, mupdfEngine, type RedactionCheck } from '@/engines/mupdf';
import { isAbortError } from '@/engines/worker-host';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { boundsOf, invert, type Mark, markId, quadToUserBox } from './marks';

type Options = {
  marks: Mark[];
  fillBlack: boolean;
  stripHidden: boolean;
  onReport: (id: string, notes: ResultNote[]) => void;
};

const quote = (s: string) => `“${s.length > 60 ? `${s.slice(0, 57)}…` : s}”`;

function checkNotes(check: RedactionCheck, boxes: number, stripHidden: boolean): ResultNote[] {
  const notes: ResultNote[] = [];
  if (check.passed) {
    notes.push({
      kind: 'ok',
      text: `Verified: the output was reopened and no text can be extracted under ${
        boxes === 1 ? 'the redacted area' : `any of the ${boxes} redacted areas`
      }, including form fields and comments.`,
    });
  } else {
    for (const left of check.leftInBoxes) {
      notes.push({ kind: 'error', text: `Page ${left.page + 1}: text is still extractable under a box: ${quote(left.text)}` });
    }
  }
  const removed = [...new Set(check.removed.map((r) => r.text))];
  if (removed.length) {
    notes.push({
      kind: 'info',
      text: `Removed text: ${removed.slice(0, 8).map(quote).join(', ')}${removed.length > 8 ? ` and ${removed.length - 8} more` : ''}.`,
    });
  } else {
    notes.push({ kind: 'info', text: 'The areas held no text; images and drawings under them were removed.' });
  }
  for (const e of check.elsewhere) {
    notes.push({
      kind: 'warn',
      text: `${quote(e.text)} still appears ${e.count} ${e.count === 1 ? 'time' : 'times'} elsewhere in the document. Search for it to redact every occurrence.`,
    });
  }
  if (stripHidden) {
    notes.push({ kind: 'info', text: 'Metadata, attachments and scripts were removed too.' });
  }
  return notes;
}

const job = perFile<Options>(async (input, o, ctx) => {
  const { file } = input;
  const regions = o.marks.map((m) => ({ page: m.page, box: m.box, space: 'user' as const }));
  const { blob, check } = await mupdfEngine.redact(
    file,
    regions,
    { fillBlack: o.fillBlack, stripHidden: o.stripHidden },
    {
      signal: ctx.signal,
      onProgress: (done, total, note) => ctx.onProgress(done / Math.max(1, total), note),
    },
  );
  o.onReport(input.id, checkNotes(check, regions.length, o.stripHidden));
  if (!check.passed) {
    throw new Error('Verification failed: some text under the boxes could still be extracted, so no file was produced.');
  }
  return { name: `${baseName(file.name)}-redacted.pdf`, blob };
});

/** Drag to draw a box; existing boxes on this page with a remove button. */
function DrawLayer({
  view,
  marks,
  onAdd,
  onRemove,
}: {
  view: StageView;
  marks: Mark[];
  onAdd: (box: Mark['box']) => void;
  onRemove: (id: string) => void;
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const local = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.min(Math.max(0, e.clientX - r.left), view.width),
      Math.min(Math.max(0, e.clientY - r.top), view.height),
    ] as const;
  };
  return (
    <div
      className="absolute inset-0 cursor-crosshair touch-none select-none"
      data-redact-layer=""
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const [x, y] = local(e);
        setDrag({ x0: x, y0: y, x1: x, y1: y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const [x, y] = local(e);
        setDrag({ ...drag, x1: x, y1: y });
      }}
      onPointerUp={() => {
        if (!drag) return;
        setDrag(null);
        if (Math.abs(drag.x1 - drag.x0) < 4 || Math.abs(drag.y1 - drag.y0) < 4) return;
        onAdd(boundsOf([view.toUser(drag.x0, drag.y0), view.toUser(drag.x1, drag.y1)]));
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {marks.map((m) => {
        const [x0, y0, x1, y1] = boundsOf([view.toView(m.box[0], m.box[1]), view.toView(m.box[2], m.box[3])]);
        return (
          <div
            key={m.id}
            data-redact-mark=""
            className="group absolute bg-black/75 ring-2 ring-destructive"
            style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
            title={m.term ? `Search: ${m.term}` : 'Drawn area'}
          >
            <button
              type="button"
              aria-label="Remove this area"
              onClick={() => onRemove(m.id)}
              className="absolute -top-2.5 -right-2.5 grid size-5 place-items-center rounded-full bg-destructive text-white opacity-0 shadow focus-visible:opacity-100 group-hover:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-3" />
            </button>
          </div>
        );
      })}
      {drag ? (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-destructive bg-destructive/20"
          style={{
            left: Math.min(drag.x0, drag.x1),
            top: Math.min(drag.y0, drag.y1),
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
          }}
        />
      ) : null}
    </div>
  );
}

type SearchState = { busy: boolean; message: string | null; error: boolean };

export default function RedactPdf({ tool }: ToolProps) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [page, setPage] = useState(0);
  const [fillBlack, setFillBlack] = useState(true);
  const [stripHidden, setStripHidden] = useState(true);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState<SearchState>({ busy: false, message: null, error: false });
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);
  const options = useMemo<Options>(
    () => ({ marks, fillBlack, stripHidden, onReport }),
    [marks, fillBlack, stripHidden, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept, multiple: false });
  const input = wb.files[0] ?? null;

  // A new file starts with no marks.
  const [markedFile, setMarkedFile] = useState<string | null>(null);
  if ((input?.id ?? null) !== markedFile) {
    setMarkedFile(input?.id ?? null);
    setMarks([]);
    setPage(0);
    setSearch({ busy: false, message: null, error: false });
  }

  // One MuPDF session per file, opened on the first search.
  const session = useRef<{ fileId: string; open: Promise<MupdfSession> } | null>(null);
  useEffect(() => {
    return () => {
      const s = session.current;
      session.current = null;
      void s?.open.then((x) => x.close()).catch(() => undefined);
    };
  }, [input]);

  const runSearch = async () => {
    const needle = term.trim();
    if (!input || !needle) return;
    setSearch({ busy: true, message: null, error: false });
    try {
      if (session.current?.fileId !== input.id) {
        session.current = { fileId: input.id, open: mupdfEngine.openSession(input.file) };
      }
      const s = await session.current.open;
      const hits = await s.search(needle);
      const transforms = new Map<number, ReturnType<typeof invert>>();
      const added: Mark[] = [];
      for (const hit of hits) {
        let inv = transforms.get(hit.page);
        if (!inv) {
          inv = invert(await s.pageTransform(hit.page));
          transforms.set(hit.page, inv);
        }
        for (const quad of hit.quads) added.push({ id: markId(), page: hit.page, box: quadToUserBox(quad, inv), term: needle });
      }
      setMarks((prev) => [...prev, ...added]);
      const pages = new Set(hits.map((h) => h.page));
      const firstHit = hits[0];
      if (firstHit && !hits.some((h) => h.page === page)) setPage(firstHit.page);
      setSearch({
        busy: false,
        error: false,
        message: hits.length
          ? `Marked ${hits.length} ${hits.length === 1 ? 'match' : 'matches'} of ${quote(needle)} on ${pages.size} ${pages.size === 1 ? 'page' : 'pages'}.`
          : `No matches for ${quote(needle)}.`,
      });
    } catch (err) {
      if (isAbortError(err)) return;
      setSearch({ busy: false, error: true, message: err instanceof Error ? err.message : 'The search failed.' });
    }
  };

  const byPage = new Map<number, number>();
  for (const m of marks) byPage.set(m.page, (byPage.get(m.page) ?? 0) + 1);

  const stage = input ? (
    <SectionCard
      title="Mark what to remove"
      description="Drag on the page to draw a box, or find text below. Hover a box to remove it."
      contentClassName="flex flex-col gap-3"
    >
      <PdfStage
        file={input.file}
        page={page}
        onPageChange={setPage}
        overlay={(view) => (
          <DrawLayer
            view={view}
            marks={marks.filter((m) => m.page === page)}
            onAdd={(box) => setMarks((prev) => [...prev, { id: markId(), page, box, term: null }])}
            onRemove={(id) => setMarks((prev) => prev.filter((m) => m.id !== id))}
          />
        )}
      />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <Input
          id="rd-search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Find text to redact, e.g. a name or account number"
          disabled={wb.running}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!term.trim() || search.busy || wb.running}>
          <HugeiconsIcon
            icon={search.busy ? Loading03Icon : Search01Icon}
            strokeWidth={2}
            className={search.busy ? 'animate-spin' : undefined}
          />
          Find and mark
        </Button>
      </form>
      {search.message ? (
        <p data-search-message="" className={search.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {search.message}
        </p>
      ) : null}
      {marks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-marks-summary="">
          <span className="font-medium">
            {marks.length} {marks.length === 1 ? 'area' : 'areas'} on {byPage.size} {byPage.size === 1 ? 'page' : 'pages'}:
          </span>
          {[...byPage.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([p, n]) => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className="rounded-md border px-1.5 py-0.5 font-mono tabular-nums hover:bg-muted aria-pressed:bg-muted"
                aria-pressed={p === page}
              >
                p.{p + 1} · {n}
              </button>
            ))}
          <Button size="sm" variant="ghost" onClick={() => setMarks([])} disabled={wb.running}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Clear all
          </Button>
        </div>
      ) : null}
    </SectionCard>
  ) : null;

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      multiple={false}
      runLabel="Redact"
      disabledReason={marks.length ? null : 'Draw a box over what to remove, or find text to mark.'}
      aside={stage}
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            Redaction deletes the text, image pixels and drawings under each box from the file itself; it is not a cover-up
            that can be lifted.
          </p>
          <SwitchRow
            id="rd-black"
            label="Black boxes"
            hint="Off leaves the redacted areas blank (white)."
            checked={fillBlack}
            onChange={setFillBlack}
          />
          <SwitchRow
            id="rd-hidden"
            label="Remove hidden data"
            hint="Metadata (title, author, XMP), attachments and scripts. Comments and form fields over the boxes are always removed."
            checked={stripHidden}
            onChange={setStripHidden}
          />
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows
        results={wb.results}
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])}
      />
      {input && !wb.running && wb.statuses[input.id]?.state === 'error' && reports[input.id] ? (
        <SectionCard title="Verification">
          <div className="flex flex-col gap-1.5">
            {reports[input.id]?.map((n, i) => (
              <p key={i} className="text-xs/relaxed text-destructive">
                {n.text}
              </p>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
