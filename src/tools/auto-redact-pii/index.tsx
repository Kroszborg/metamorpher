'use client';

import { Loading03Icon, ScanImageIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { PdfStage, type StageView, SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { isPasswordError, MUPDF_DOWNLOAD_BYTES, mupdfEngine, type RedactionCheck } from '@/engines/mupdf';
import { OCR_LANGUAGES, OcrDocument, ocrEngine, toPageLines } from '@/engines/ocr';
import {
  charsFromWords,
  compilePattern,
  locatePii,
  PII_CATEGORIES,
  type PiiCategory,
  type PiiHit,
  type PiiPage,
  pageBoxToUser,
  piiEngine,
} from '@/engines/pii';
import { abortError, isAbortError } from '@/engines/worker-host';
import { baseName } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';

type Options = {
  hits: PiiHit[];
  fillBlack: boolean;
  stripHidden: boolean;
  password: string;
  onReport: (id: string, notes: ResultNote[]) => void;
};

const ALL_BUILT_IN = PII_CATEGORIES.map((c) => c.id).filter((c) => c !== 'custom');
const LABEL = Object.fromEntries(PII_CATEGORIES.map((c) => [c.id, c.label])) as Record<PiiCategory, string>;
const COLOUR: Record<PiiCategory, string> = {
  email: 'ring-sky-500',
  phone: 'ring-emerald-500',
  card: 'ring-amber-500',
  iban: 'ring-orange-500',
  aadhaar: 'ring-fuchsia-500',
  pan: 'ring-violet-500',
  ssn: 'ring-rose-500',
  ip: 'ring-cyan-500',
  dob: 'ring-lime-500',
  name: 'ring-teal-500',
  address: 'ring-indigo-500',
  custom: 'ring-primary',
};
/** Found but not selected until you tick them: label-based guesses are less certain than checksums. */
const OPT_IN = new Set<PiiCategory>(['name', 'address']);
/** Pages with fewer visible characters than this and a picture are treated as scanned. */
const SCANNED_BELOW = 10;
const quote = (s: string) => `“${s.length > 60 ? `${s.slice(0, 57)}…` : s}”`;

function checkNotes(check: RedactionCheck, hits: PiiHit[], stripHidden: boolean): ResultNote[] {
  const notes: ResultNote[] = [];
  if (check.passed) {
    notes.push({
      kind: 'ok',
      text: `Verified: the output was reopened and none of the ${hits.length} redacted ${hits.length === 1 ? 'item' : 'items'} can be extracted from under its box.`,
    });
  } else {
    for (const left of check.leftInBoxes) {
      notes.push({ kind: 'error', text: `Page ${left.page + 1}: text is still extractable under a box: ${quote(left.text)}` });
    }
  }
  const counts = new Map<PiiCategory, number>();
  for (const h of hits) counts.set(h.category, (counts.get(h.category) ?? 0) + 1);
  notes.push({
    kind: 'info',
    text: `Removed ${[...counts].map(([c, n]) => `${n} × ${LABEL[c].toLowerCase()}`).join(', ')}.`,
  });
  for (const e of check.elsewhere) {
    notes.push({
      kind: 'warn',
      text: `${quote(e.text)} still appears ${e.count} ${e.count === 1 ? 'time' : 'times'} elsewhere in the document (not selected, or not recognised as personal data).`,
    });
  }
  if (stripHidden) notes.push({ kind: 'info', text: 'Metadata, attachments and scripts were removed too.' });
  return notes;
}

const job = perFile<Options>(async (input, o, ctx) => {
  if (o.hits.length === 0) throw new Error('Nothing is selected to redact.');
  const regions = o.hits.flatMap((h) => h.boxes.map((box) => ({ page: h.page, box })));
  ctx.onProgress(0, 'Preparing the pages');
  // Same drawing, text as plain Tj strings: keeps the rest of each line in place when MuPDF removes text.
  const prepared = await piiEngine.prepareRedaction(input.file, [...new Set(o.hits.map((h) => h.page))], {
    signal: ctx.signal,
    password: o.password || undefined,
  });
  const { blob, check } = await mupdfEngine.redact(
    prepared ?? input.file,
    regions,
    { fillBlack: o.fillBlack, stripHidden: o.stripHidden },
    {
      signal: ctx.signal,
      password: prepared ? undefined : o.password || undefined,
      onProgress: (done, total, note) => ctx.onProgress(0.1 + (0.9 * done) / Math.max(1, total), note),
    },
  );
  o.onReport(input.id, checkNotes(check, o.hits, o.stripHidden));
  if (!check.passed) {
    throw new Error('Verification failed: some text under the boxes could still be extracted, so no file was produced.');
  }
  return { name: `${baseName(input.file.name)}-redacted.pdf`, blob };
});

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

type Scan = { state: 'idle' | 'scanning' | 'done' | 'error'; pages: PiiPage[]; error: string | null; progress: number };
type OcrState = { running: boolean; done: number; total: number; error: string | null; pages: number[] };

/** The hit boxes on the shown page; click one to leave it out (or put it back). */
function HitLayer({
  view,
  hits,
  transform,
  excluded,
  onToggle,
}: {
  view: StageView;
  hits: PiiHit[];
  transform: readonly number[];
  excluded: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0" data-pii-layer="">
      {hits.flatMap((h) =>
        h.boxes.map((b, i) => {
          const u = pageBoxToUser(b, transform);
          const [ax, ay] = view.toView(u[0], u[1]);
          const [bx, by] = view.toView(u[2], u[3]);
          const on = !excluded.has(h.id);
          return (
            <button
              key={`${h.id}-${i}`}
              type="button"
              data-hit-box={h.id}
              aria-pressed={on}
              title={`${LABEL[h.category]}: ${h.text}${on ? '' : ' (kept)'}. Click to ${on ? 'keep' : 'redact'} it.`}
              onClick={() => onToggle(h.id)}
              className={cn(
                'pointer-events-auto absolute rounded-[2px] ring-2',
                COLOUR[h.category],
                on ? 'bg-black/70' : 'bg-transparent opacity-70 ring-offset-0 [box-shadow:none] [outline:2px_dashed_currentColor]',
              )}
              style={{
                left: Math.min(ax, bx) - 1,
                top: Math.min(ay, by) - 1,
                width: Math.abs(bx - ax) + 2,
                height: Math.abs(by - ay) + 2,
              }}
            />
          );
        }),
      )}
    </div>
  );
}

export default function AutoRedactPii({ tool }: ToolProps) {
  const [page, setPage] = useState(0);
  const [fillBlack, setFillBlack] = useState(true);
  const [stripHidden, setStripHidden] = useState(true);
  const [password, setPassword] = useState('');
  const [wordsText, setWordsText] = useState('');
  const [patternsText, setPatternsText] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [ocrLangs, setOcrLangs] = useState<string[]>(['eng']);
  const [scan, setScan] = useState<Scan>({ state: 'idle', pages: [], error: null, progress: 0 });
  const [ocr, setOcr] = useState<OcrState>({ running: false, done: 0, total: 0, error: null, pages: [] });
  const [ocrHits, setOcrHits] = useState<PiiHit[]>([]);
  const [reports, setReports] = useState<Record<string, ResultNote[]>>({});
  const onReport = useCallback((id: string, n: ResultNote[]) => setReports((p) => ({ ...p, [id]: n })), []);

  const words = useMemo(() => lines(wordsText), [wordsText]);
  const patterns = useMemo(() => lines(patternsText), [patternsText]);
  const patternErrors = patterns.map((p) => ({ p, error: compilePattern(p).error })).filter((x) => x.error);
  const validPatterns = useMemo(() => patterns.filter((p) => !compilePattern(p).error), [patterns]);

  const allHits = useMemo(() => [...scan.pages.flatMap((p) => p.hits), ...ocrHits], [scan.pages, ocrHits]);
  const selected = useMemo(() => allHits.filter((h) => !excluded.has(h.id)), [allHits, excluded]);

  const options = useMemo<Options>(
    () => ({ hits: selected, fillBlack, stripHidden, password, onReport }),
    [selected, fillBlack, stripHidden, password, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept, multiple: false });
  const input = wb.files[0] ?? null;

  // A new file starts over.
  const [seenFile, setSeenFile] = useState<string | null>(null);
  if ((input?.id ?? null) !== seenFile) {
    setSeenFile(input?.id ?? null);
    setPage(0);
    setExcluded(new Set());
    setOcrHits([]);
    setOcr({ running: false, done: 0, total: 0, error: null, pages: [] });
    setScan({ state: 'idle', pages: [], error: null, progress: 0 });
  }

  // Scan for every built-in category plus the custom words; toggles only filter.
  const file = input?.file ?? null;
  useEffect(() => {
    if (!file) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setScan((s) => ({ ...s, state: 'scanning', error: null, progress: 0 }));
      piiEngine
        .scan(
          file,
          { categories: [...ALL_BUILT_IN, 'custom'], words, patterns: validPatterns },
          {
            signal: ctl.signal,
            password: password || undefined,
            onProgress: (done, total) => setScan((s) => ({ ...s, progress: done / Math.max(1, total) })),
          },
        )
        .then((pages) => {
          setScan({ state: 'done', pages, error: null, progress: 1 });
          const optIn = pages.flatMap((p) => p.hits).filter((h) => OPT_IN.has(h.category));
          if (optIn.length) setExcluded((prev) => new Set([...prev, ...optIn.map((h) => h.id)]));
        })
        .catch((err: unknown) => {
          if (isAbortError(err)) return;
          setScan({
            state: 'error',
            pages: [],
            progress: 0,
            error: isPasswordError(err)
              ? 'This PDF needs its password. Enter it under Options.'
              : err instanceof Error
                ? err.message
                : 'The file could not be scanned.',
          });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [file, words, validPatterns, password]);

  useEffect(() => () => piiEngine.close(), []);

  const scanned = scan.pages.filter((p) => p.textChars < SCANNED_BELOW && p.images > 0).map((p) => p.index);
  const ocrDone = new Set(ocr.pages);
  const scannedLeft = scanned.filter((p) => !ocrDone.has(p));

  const ocrCtl = useRef<AbortController | null>(null);
  const runOcr = async () => {
    if (!input) return;
    const ctl = new AbortController();
    ocrCtl.current = ctl;
    const todo = scannedLeft;
    setOcr((s) => ({ ...s, running: true, done: 0, total: todo.length, error: null }));
    let doc: OcrDocument | null = null;
    try {
      doc = await OcrDocument.fromPdf(input.file, { password: password || undefined, signal: ctl.signal });
      for (const [k, index] of todo.entries()) {
        if (ctl.signal.aborted) throw abortError();
        const render = await doc.render(index, 300);
        const result = await ocrEngine.recognize(render.image, {
          langs: ocrLangs,
          dpi: (render.width / render.pageWidth) * 72,
          signal: ctl.signal,
        });
        const chars = charsFromWords(toPageLines(result, render.pageWidth, render.pageHeight));
        const hits = locatePii(chars, index, {
          categories: new Set<PiiCategory>([...ALL_BUILT_IN, 'custom']),
          words,
          patterns: validPatterns,
        }, true).map((h) => ({ ...h, id: `ocr-${h.id}` }));
        setOcrHits((prev) => [...prev, ...hits]);
        const optIn = hits.filter((h) => OPT_IN.has(h.category));
        if (optIn.length) setExcluded((prev) => new Set([...prev, ...optIn.map((h) => h.id)]));
        setOcr((s) => ({ ...s, done: k + 1, pages: [...s.pages, index] }));
      }
      setOcr((s) => ({ ...s, running: false }));
    } catch (err) {
      setOcr((s) => ({
        ...s,
        running: false,
        error: isAbortError(err) ? null : err instanceof Error ? err.message : 'Text recognition failed.',
      }));
    } finally {
      doc?.close();
      ocrCtl.current = null;
    }
  };

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setCategory = (cat: PiiCategory, on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const h of allHits) {
        if (h.category !== cat) continue;
        if (on) next.delete(h.id);
        else next.add(h.id);
      }
      return next;
    });

  const byCategory = PII_CATEGORIES.map((c) => ({ ...c, hits: allHits.filter((h) => h.category === c.id) })).filter(
    (c) => c.hits.length > 0,
  );
  const transform = scan.pages[page]?.transform ?? [1, 0, 0, 1, 0, 0];

  const stage = input ? (
    <SectionCard
      title="Personal data found"
      description={
        scan.state === 'scanning'
          ? `Scanning… ${Math.round(scan.progress * 100)}%`
          : scan.state === 'done'
            ? `${allHits.length} ${allHits.length === 1 ? 'item' : 'items'} found, ${selected.length} selected for redaction. Click a box or untick an item to keep it.`
            : undefined
      }
      contentClassName="flex flex-col gap-4"
    >
      <PdfStage
        file={input.file}
        page={page}
        onPageChange={setPage}
        overlay={(view) => (
          <HitLayer
            view={view}
            hits={allHits.filter((h) => h.page === page)}
            transform={transform}
            excluded={excluded}
            onToggle={toggle}
          />
        )}
      />
      {scan.error ? (
        <p className="text-xs text-destructive" data-scan-error="">
          {scan.error}
        </p>
      ) : null}
      {scannedLeft.length > 0 || ocr.running ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5" data-scanned-notice="">
          <p className="text-xs/relaxed">
            {scanned.length} {scanned.length === 1 ? 'page looks' : 'pages look'} scanned (a picture with no text layer), so
            personal data on {scanned.length === 1 ? 'it' : 'them'} cannot be found by reading text. Read{' '}
            {scanned.length === 1 ? 'it' : 'them'} with OCR here (pick the languages of the document), or make the file searchable first with{' '}
            <Link href="/tools/ocr-pdf" className="underline">
              OCR
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="OCR languages">
            {OCR_LANGUAGES.map((l) => {
              const on = ocrLangs.includes(l.code);
              return (
                <button
                  key={l.code}
                  type="button"
                  aria-pressed={on}
                  data-ocr-lang={l.code}
                  disabled={ocr.running}
                  onClick={() => {
                    if (on && ocrLangs.length === 1) return;
                    setOcrLangs(on ? ocrLangs.filter((c) => c !== l.code) : [...ocrLangs, l.code]);
                  }}
                  className={`rounded-md border px-2 py-0.5 text-[0.7rem] transition-colors ${on ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {ocr.running ? (
              <Button size="sm" variant="outline" onClick={() => ocrCtl.current?.abort()}>
                <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" />
                Reading page {Math.min(ocr.done + 1, ocr.total)} of {ocr.total}… Stop
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void runOcr()} disabled={wb.running}>
                <HugeiconsIcon icon={ScanImageIcon} strokeWidth={2} />
                Read {scannedLeft.length} scanned {scannedLeft.length === 1 ? 'page' : 'pages'} with OCR
              </Button>
            )}
          </div>
          {ocr.error ? <p className="text-xs text-destructive">{ocr.error}</p> : null}
        </div>
      ) : null}
      {ocr.pages.length > 0 && !ocr.running ? (
        <p className="text-xs text-muted-foreground" data-ocr-done="">
          Read {ocr.pages.length} scanned {ocr.pages.length === 1 ? 'page' : 'pages'} with OCR: {ocrHits.length}{' '}
          {ocrHits.length === 1 ? 'item' : 'items'} found. Redaction removes the picture pixels under their boxes.
        </p>
      ) : null}
      {scan.state === 'done' && allHits.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-no-hits="">
          No personal data was found{scanned.length ? ' in the text of this file' : ''}. Add your own words or patterns under Options.
        </p>
      ) : null}
      <div className="flex flex-col gap-3" data-hit-list="">
        {byCategory.map((c) => {
          const on = c.hits.filter((h) => !excluded.has(h.id)).length;
          return (
            <div key={c.id} className="flex flex-col gap-1.5" data-cat={c.id}>
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  data-cat-toggle={c.id}
                  checked={on === c.hits.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < c.hits.length;
                  }}
                  onChange={(e) => setCategory(c.id, e.currentTarget.checked)}
                />
                <span className={cn('inline-block size-2 rounded-full ring-2', COLOUR[c.id])} />
                {c.label}
                <span className="font-mono text-muted-foreground tabular-nums">
                  {on}/{c.hits.length}
                </span>
              </label>
              <ul className="ml-5 flex flex-col gap-0.5">
                {c.hits.slice(0, 200).map((h) => (
                  <li key={h.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      data-hit={h.id}
                      checked={!excluded.has(h.id)}
                      onChange={() => toggle(h.id)}
                      aria-label={`Redact ${h.text}`}
                    />
                    <span className="min-w-0 truncate font-mono" title={h.text}>
                      {h.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage(h.page)}
                      className="shrink-0 rounded border px-1 font-mono text-[0.65rem] text-muted-foreground hover:bg-muted"
                    >
                      p.{h.page + 1}
                    </button>
                    {h.ocr ? <span className="text-[0.65rem] text-muted-foreground">OCR</span> : null}
                  </li>
                ))}
                {c.hits.length > 200 ? (
                  <li className="text-[0.7rem] text-muted-foreground">and {c.hits.length - 200} more (included)</li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </SectionCard>
  ) : null;

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      multiple={false}
      runLabel={selected.length ? `Redact ${selected.length} ${selected.length === 1 ? 'item' : 'items'}` : 'Redact'}
      disabledReason={
        scan.state === 'scanning'
          ? 'Scanning the file…'
          : ocr.running
            ? 'Reading scanned pages…'
            : selected.length
              ? null
              : 'Nothing is selected to redact.'
      }
      aside={stage}
      optionsPanel={
        <>
          <OptionField
            label="Your words"
            htmlFor="pii-words"
            hint="One per line: names, account numbers, addresses. Matched as whole words, any case."
          >
            <Textarea id="pii-words" value={wordsText} onChange={(e) => setWordsText(e.target.value)} placeholder={'Jane Doe\nProject Falcon'} rows={3} />
          </OptionField>
          <OptionField
            label="Patterns"
            htmlFor="pii-patterns"
            hint={
              patternErrors.length
                ? `Not used: ${patternErrors.map((p) => `${p.p} (${p.error})`).join('; ')}`
                : 'One regular expression per line, e.g. EMP-\\d{5}. Matched in any case.'
            }
          >
            <Textarea
              id="pii-patterns"
              value={patternsText}
              onChange={(e) => setPatternsText(e.target.value)}
              placeholder={'EMP-\\d{5}'}
              rows={2}
              aria-invalid={patternErrors.length ? true : undefined}
              className="font-mono"
            />
          </OptionField>
          <SwitchRow id="pii-black" label="Black boxes" hint="Off leaves the redacted areas blank (white)." checked={fillBlack} onChange={setFillBlack} />
          <SwitchRow
            id="pii-hidden"
            label="Remove hidden data"
            hint="Metadata (title, author, XMP), attachments and scripts."
            checked={stripHidden}
            onChange={setStripHidden}
          />
          <OptionField label="Password" htmlFor="pii-password" hint="Only for files that need a password to open.">
            <PasswordInput id="pii-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Detection is automatic and can miss things or flag harmless numbers: check the list before redacting. Redaction
            deletes the text and picture pixels under each box from the file; it is not a cover-up.
          </p>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} notesFor={(r) => (r.sourceId ? (reports[r.sourceId] ?? []) : [])} />
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
