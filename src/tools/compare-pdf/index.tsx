'use client';

import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { Remote } from 'comlink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { EngineNote, PasswordInput, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { defineJob, OptionField, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { documentCss, pageGeometry, typesetEngine } from '@/engines/typeset';
import { abortError, WorkerHost } from '@/engines/worker-host';
import { baseName } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import type { CompareWorkerApi } from './compare.worker';
import { SwitchRow } from '@/components/pdf-stage';
import type { Change, CompareOptions, CompareResult, PageMarks, Side, VisualDiff } from './types';

const host = new WorkerHost<CompareWorkerApi>(() => new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' }));

type Outcome = { result: CompareResult; visual: { a: number; b: number; fraction: number }[]; names: [string, string]; token: number };
type Options = {
  passwordA: string;
  passwordB: string;
  ignore: CompareOptions;
  onOutcome: (o: Outcome) => void;
  onNotes: (n: ResultNote[]) => void;
};

/** Every page pair is compared pixel by pixel (small, one at a time; only the fraction is kept). */
const VISUAL_SUMMARY_PAGES = 5000;
/** The report is written in parts of this many changed page pairs, then joined: memory stays at about one part. */
const REPORT_PART_PAGES = 12;
let runToken = 0;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const pagesWith = (marks: PageMarks[]) => new Set(marks.filter((m) => m.boxes.length).map((m) => m.page));

const job = defineJob<Options>({
  mode: 'batch',
  async run(inputs, o, ctx) {
    const [a, b] = inputs;
    if (!a || !b || inputs.length !== 2) throw new Error('Add exactly two PDFs: the original first, then the changed version.');
    const call = <R,>(fn: (api: Remote<CompareWorkerApi>) => Promise<R>) => host.call(fn, ctx.signal);
    ctx.onProgress(0.02, 'Reading both files');
    await call((api) => api.open(a.file, b.file, o.passwordA || undefined, o.passwordB || undefined));
    ctx.onProgress(0.2, 'Comparing the text');
    const result = await call((api) => Promise.resolve(api.compare(o.ignore)));

    // Pixel comparison of each page with its partner, small, for the summary.
    const visual: Outcome['visual'] = [];
    const pairs = result.pairOfA.map((pb, pa) => [pa, pb] as const).filter((p): p is readonly [number, number] => p[1] !== null);
    const checked = pairs.slice(0, VISUAL_SUMMARY_PAGES);
    for (const [k, [pa, pb]] of checked.entries()) {
      if (ctx.signal.aborted) throw abortError();
      ctx.onProgress(0.25 + (0.45 * k) / Math.max(1, checked.length), `Comparing page images ${k + 1} of ${checked.length}`);
      const v = await call((api) => api.visual(pa, pb, 240));
      visual.push({ a: pa, b: pb, fraction: v.changedFraction });
    }

    // Report: summary, every change, and the changed pages side by side.
    ctx.onProgress(0.72, 'Writing the report');
    const changedA = pagesWith(result.marksA);
    const changedB = pagesWith(result.marksB);
    const visuallyChanged = visual.filter((v) => v.fraction > 0.0005);
    const reportPairs = [...new Map(result.changes.map((c) => [`${c.pageA}:${c.pageB}`, [c.pageA, c.pageB] as const])).values()];
    for (const v of visuallyChanged) if (!reportPairs.some(([x, y]) => x === v.a && y === v.b)) reportPairs.push([v.a, v.b]);
    const s = result.stats;
    const ignored = [o.ignore.ignoreCase ? 'case' : '', o.ignore.ignorePunctuation ? 'punctuation' : '', o.ignore.ignoreWhitespace ? 'spacing and word breaks' : ''].filter(Boolean);
    const html = [
      `<h1>Comparison report</h1>`,
      `<table><tr><th></th><th>Original</th><th>Changed</th></tr>`,
      `<tr><td>File</td><td>${esc(a.file.name)}</td><td>${esc(b.file.name)}</td></tr>`,
      `<tr><td>Pages</td><td>${result.pagesA.length}</td><td>${result.pagesB.length}</td></tr>`,
      `<tr><td>Words</td><td>${s.wordsA}</td><td>${s.wordsB}</td></tr>`,
      `<tr><td>Pages with text changes</td><td>${[...changedA].map((p) => p + 1).join(', ') || 'none'}</td><td>${[...changedB].map((p) => p + 1).join(', ') || 'none'}</td></tr></table>`,
      `<p>${result.changes.length} ${result.changes.length === 1 ? 'change' : 'changes'}: ${s.removed} ${s.removed === 1 ? 'word' : 'words'} removed, ${s.added} added. `,
      `${visuallyChanged.length} of ${visual.length} page pairs look different when compared pixel by pixel${pairs.length > visual.length ? ` (the first ${visual.length} pairs were checked)` : ''}.`,
      ignored.length ? ` Differences in ${ignored.join(', ')} were ignored.` : '',
      `</p>`,
    ].join('');
    const css = `${documentCss({ fontSize: 9.5, font: 'sans' })}
table{border-collapse:collapse;width:100%;margin:0 0 1em}
td,th{border:0.5pt solid #d0d7de;padding:3pt 5pt;vertical-align:top;text-align:left}
.del{color:#b42318;text-decoration:line-through}.ins{color:#067647}
table.pair td{width:50%;border:0.5pt solid #d0d7de;padding:2pt}
h3.pair-title{page-break-before:always}`;
    // The changed pages side by side, a few pairs per part, so only one part's pictures are in memory at a time.
    const page = pageGeometry('a4', 'portrait', 'narrow');
    const pairImages = async (from: number): Promise<string> => {
      const images: string[] = [];
      for (const [pa, pb] of reportPairs.slice(from, from + REPORT_PART_PAGES)) {
        if (ctx.signal.aborted) throw abortError();
        ctx.onProgress(0.72 + (0.18 * (from + images.length)) / Math.max(1, reportPairs.length), `Writing the report: page ${from + images.length + 1} of ${reportPairs.length}`);
        const boxesA = result.marksA.find((m) => m.page === pa)?.boxes.map((x) => x.box) ?? [];
        const boxesB = result.marksB.find((m) => m.page === pb)?.boxes.map((x) => x.box) ?? [];
        const ia = await call((api) => api.markedImage('a', pa, 0.9, boxesA));
        const ib = await call((api) => api.markedImage('b', pb, 0.9, boxesB));
        images.push(
          `<h3 class="pair-title">Original page ${pa + 1} · changed page ${pb + 1}</h3><table class="pair"><tr><td><img src="data:image/jpeg;base64,${base64(ia.jpeg)}" style="width:100%"></td><td><img src="data:image/jpeg;base64,${base64(ib.jpeg)}" style="width:100%"></td></tr></table>`,
        );
      }
      return images.join('');
    };
    // Part 1: the summary, every change (a table the layout engine pages itself; thousands of rows are fine) and the first pages.
    const parts: { name: string; blob: Blob }[] = [];
    const firstImages = reportPairs.length
      ? `<h2>Changed pages</h2><p>Original on the left (removed text in red), changed version on the right (added text in green).</p>${await pairImages(0)}`
      : '';
    const first = await typesetEngine.render(
      {
        blocks: [
          { kind: 'html', html },
          ...(result.changes.length
            ? [
                {
                  kind: 'table' as const,
                  title: 'Text changes',
                  header: ['#', 'Page', 'Removed', 'Added'],
                  rows: result.changes.map((c) => [String(c.id + 1), `${c.pageA + 1} → ${c.pageB + 1}`, c.removed, c.added]),
                  align: ['right' as const, 'left' as const, 'left' as const, 'left' as const],
                  repeatHeader: true,
                },
              ]
            : []),
          ...(firstImages ? [{ kind: 'html' as const, html: firstImages }] : []),
        ],
        css,
        page,
        fontSize: 9.5,
        outline: true,
        pageNumbers: true,
        title: 'Comparison report',
      },
      { signal: ctx.signal },
    );
    parts.push({ name: 'summary.pdf', blob: first.blob });
    for (let from = REPORT_PART_PAGES; from < reportPairs.length; from += REPORT_PART_PAGES) {
      const part = await typesetEngine.render(
        {
          blocks: [{ kind: 'html', html: await pairImages(from) }],
          css: `${css}\nh3.pair-title:first-child{page-break-before:auto}`,
          page,
          fontSize: 9.5,
          outline: false,
          pageNumbers: false,
          title: 'Comparison report',
        },
        { signal: ctx.signal },
      );
      parts.push({ name: `pages-${from}.pdf`, blob: part.blob });
    }
    const report = { blob: parts.length > 1 ? await ctx.engines.pdf.merge(parts, { signal: ctx.signal }) : first.blob };
    ctx.onProgress(0.92, 'Marking the changes');
    const marked = await call((api) => api.highlighted('b', result.marksB));
    const markedOld = await call((api) => api.highlighted('a', result.marksA));
    runToken += 1;
    o.onOutcome({ result, visual, names: [a.file.name, b.file.name], token: runToken });
    o.onNotes([
      {
        kind: result.changes.length || visuallyChanged.length ? 'warn' : 'ok',
        text: result.changes.length
          ? `${result.changes.length} text ${result.changes.length === 1 ? 'change' : 'changes'} (${s.removed} words removed, ${s.added} added) on ${changedB.size || changedA.size} ${(changedB.size || changedA.size) === 1 ? 'page' : 'pages'}.`
          : visuallyChanged.length
            ? 'The text is identical, but some pages look different.'
            : 'No differences: the text is identical and the pages look the same.',
      },
      ...(s.wordsA === 0 && s.wordsB === 0
        ? [{ kind: 'info' as const, text: 'Neither file has text (scans?): only the page images were compared. Run OCR first to compare the words.' }]
        : []),
    ]);
    return [
      { name: 'comparison-report.pdf', blob: report.blob },
      { name: `${baseName(b.file.name)}-changes-marked.pdf`, blob: marked },
      { name: `${baseName(a.file.name)}-removals-marked.pdf`, blob: markedOld },
    ];
  },
});

// ── Viewer ────────────────────────────────────────────────────────────────

function PageImage({ side, page, scale, token }: { side: Side; page: number; scale: number; token: number }) {
  const ref = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let made: string | null = null;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || made) return;
        io.disconnect();
        host
          .call((api) => api.render(side, page, scale))
          .then((blob) => {
            if (cancelled) return;
            made = URL.createObjectURL(blob);
            setUrl(made);
          })
          .catch(() => undefined);
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (made) URL.revokeObjectURL(made);
    };
  }, [side, page, scale, token]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={url ?? undefined} alt="" className="absolute inset-0 size-full" draggable={false} />;
}

function Pane({
  side,
  outcome,
  width,
  selected,
  onSelect,
  paneRef,
  onScroll,
}: {
  side: Side;
  outcome: Outcome;
  width: number;
  selected: number | null;
  onSelect: (id: number) => void;
  paneRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  const pages = side === 'a' ? outcome.result.pagesA : outcome.result.pagesB;
  const marks = side === 'a' ? outcome.result.marksA : outcome.result.marksB;
  const byPage = new Map(marks.map((m) => [m.page, m]));
  return (
    <div ref={paneRef} onScroll={onScroll} className="relative h-[70vh] overflow-auto rounded-lg border bg-muted/30 p-3" data-pane={side}>
      <div className="flex flex-col items-center gap-3">
        {pages.map((p, i) => {
          const scale = width / p.width;
          return (
            <div key={i} data-page={i} className="relative shrink-0 bg-white shadow-sm" style={{ width, height: p.height * scale }}>
              <PageImage side={side} page={i} scale={Math.min(3, scale * 1.5)} token={outcome.token} />
              {byPage.get(i)?.boxes.map((b, k) => (
                <button
                  key={k}
                  type="button"
                  title={side === 'a' ? 'Removed' : 'Added'}
                  data-mark={b.change}
                  onClick={() => onSelect(b.change)}
                  className={cn(
                    'absolute rounded-[2px] mix-blend-multiply',
                    side === 'a' ? 'bg-red-500/35' : 'bg-green-500/35',
                    selected === b.change && 'ring-2 ring-primary',
                  )}
                  style={{
                    left: (b.box[0] - 1) * scale,
                    top: (b.box[1] - 1) * scale,
                    width: (b.box[2] - b.box[0] + 2) * scale,
                    height: (b.box[3] - b.box[1] + 2) * scale,
                  }}
                />
              ))}
              <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 font-mono text-[0.6rem] text-white">{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TextView({ outcome }: { outcome: Outcome }) {
  const { result } = outcome;
  const refA = useRef<HTMLDivElement>(null);
  const refB = useRef<HTMLDivElement>(null);
  const syncing = useRef<Side | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(360);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, Math.min(560, (el.clientWidth - 48) / 2))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageEl = (pane: HTMLDivElement, i: number) => pane.querySelector<HTMLElement>(`[data-page="${i}"]`);

  // Keep the other pane on the partner page, at the same position within it.
  const sync = (from: Side) => {
    if (syncing.current && syncing.current !== from) return;
    const src = from === 'a' ? refA.current : refB.current;
    const dst = from === 'a' ? refB.current : refA.current;
    if (!src || !dst) return;
    const els = [...src.querySelectorAll<HTMLElement>('[data-page]')];
    const top = src.scrollTop + 12;
    let idx = 0;
    for (let i = 0; i < els.length; i += 1) if ((els[i]?.offsetTop ?? 0) <= top) idx = i;
    const el = els[idx];
    if (!el) return;
    const frac = Math.min(1, Math.max(0, (top - el.offsetTop) / el.offsetHeight));
    const pair = (from === 'a' ? result.pairOfA : result.pairOfB)[idx] ?? Math.min(idx, (from === 'a' ? result.pagesB : result.pagesA).length - 1);
    const target = pageEl(dst, pair);
    if (!target) return;
    syncing.current = from;
    dst.scrollTop = target.offsetTop + frac * target.offsetHeight - 12;
    window.setTimeout(() => {
      if (syncing.current === from) syncing.current = null;
    }, 80);
  };

  const goTo = (c: Change) => {
    setSelected(c.id);
    for (const [pane, page, marks] of [
      [refA.current, c.pageA, result.marksA],
      [refB.current, c.pageB, result.marksB],
    ] as const) {
      if (!pane) continue;
      const el = pageEl(pane, page);
      if (!el) continue;
      const box = marks.find((m) => m.page === page)?.boxes.find((b) => b.change === c.id)?.box;
      const size = pane === refA.current ? result.pagesA[page] : result.pagesB[page];
      const y = box && size ? (box[1] / size.height) * el.offsetHeight : 0;
      syncing.current = 'a';
      pane.scrollTop = el.offsetTop + y - 80;
    }
    window.setTimeout(() => (syncing.current = null), 120);
  };

  return (
    <div className="flex flex-col gap-3" ref={wrap}>
      <div className="grid grid-cols-2 gap-3 text-xs font-medium">
        <p className="truncate">
          Original: <span className="text-muted-foreground">{outcome.names[0]}</span> <span className="text-red-500">removed</span>
        </p>
        <p className="truncate">
          Changed: <span className="text-muted-foreground">{outcome.names[1]}</span> <span className="text-green-600">added</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Pane side="a" outcome={outcome} width={width} selected={selected} onSelect={setSelected} paneRef={refA} onScroll={() => sync('a')} />
        <Pane side="b" outcome={outcome} width={width} selected={selected} onSelect={setSelected} paneRef={refB} onScroll={() => sync('b')} />
      </div>
      {result.changes.length ? (
        <ol className="flex max-h-72 flex-col gap-1 overflow-auto text-xs" data-change-list="">
          {result.changes.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => goTo(c)}
                className={cn('w-full rounded-md border px-2 py-1 text-left hover:bg-muted', selected === c.id && 'border-primary')}
              >
                <span className="font-mono text-muted-foreground">
                  p.{c.pageA + 1}→{c.pageB + 1}
                </span>{' '}
                {c.removed ? <del className="text-red-500">{c.removed}</del> : null} {c.added ? <ins className="text-green-600 no-underline">{c.added}</ins> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">The text of both files is identical.</p>
      )}
    </div>
  );
}

type VisualMode = 'overlay' | 'difference' | 'side';

function VisualView({ outcome }: { outcome: Outcome }) {
  const { result } = outcome;
  const pairs = result.pairOfA.map((b, a) => ({ a, b })).filter((p): p is { a: number; b: number } => p.b !== null);
  const fraction = new Map(outcome.visual.map((v) => [`${v.a}:${v.b}`, v.fraction]));
  const [pick, setPick] = useState(() => {
    const first = outcome.visual.find((v) => v.fraction > 0.0005);
    return first ? pairs.findIndex((p) => p.a === first.a) : 0;
  });
  const [mode, setMode] = useState<VisualMode>('overlay');
  const [loaded, setDiff] = useState<{ key: string; v: VisualDiff; overlay: string; difference: string; a: string; b: string } | null>(null);
  const [failed, setError] = useState<{ key: string; message: string } | null>(null);
  const pair = pairs[Math.max(0, pick)];
  const pa = pair?.a ?? -1;
  const pb = pair?.b ?? -1;
  const diff = loaded?.key === `${pa}:${pb}` ? loaded : null;
  const error = failed?.key === `${pa}:${pb}` ? failed.message : null;

  useEffect(() => {
    if (pa < 0 || pb < 0) return;
    let alive = true;
    const urls: string[] = [];
    const size = result.pagesA[pa];
    const scale = size ? 900 / size.width : 1.5;
    Promise.all([
      host.call((api) => api.visual(pa, pb, 900)),
      host.call((api) => api.render('a', pa, scale)),
      host.call((api) => api.render('b', pb, scale)),
    ])
      .then(([v, a, b]) => {
        const make = (blob: Blob) => {
          const u = URL.createObjectURL(blob);
          urls.push(u);
          return u;
        };
        if (alive) setDiff({ key: `${pa}:${pb}`, v, overlay: make(v.overlay), difference: make(v.difference), a: make(a), b: make(b) });
      })
      .catch((err: unknown) => {
        if (alive) setError({ key: `${pa}:${pb}`, message: err instanceof Error ? err.message : 'Could not compare the pages.' });
      });
    return () => {
      alive = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [pa, pb, result.pagesA]);

  if (!pair) return <p className="text-xs text-muted-foreground">There are no pages to compare.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          Page
          <select
            className="rounded-md border bg-background px-2 py-1 text-xs"
            value={pick}
            onChange={(e) => setPick(Number(e.target.value))}
            data-visual-page=""
          >
            {pairs.map((p, i) => {
              const f = fraction.get(`${p.a}:${p.b}`);
              return (
                <option key={i} value={i}>
                  {p.a + 1} ↔ {p.b + 1}
                  {f === undefined ? '' : f > 0.0005 ? ` · ${(f * 100).toFixed(1)}% changed` : ' · same'}
                </option>
              );
            })}
          </select>
        </label>
        <Segmented<VisualMode>
          label="View"
          value={mode}
          options={[
            { value: 'overlay', label: 'Overlay' },
            { value: 'difference', label: 'Difference' },
            { value: 'side', label: 'Side by side' },
          ]}
          onChange={setMode}
        />
        {diff ? (
          <span className="text-xs text-muted-foreground" data-visual-fraction={diff.v.changedFraction}>
            {(diff.v.changedFraction * 100).toFixed(2)}% of pixels differ
          </span>
        ) : null}
      </div>
      <p className="text-[0.7rem] text-muted-foreground">
        {mode === 'overlay'
          ? 'Grey: the same in both. Red: only in the original. Cyan: only in the changed version.'
          : mode === 'difference'
            ? 'Changed pixels in magenta over the original, with boxes around changed areas.'
            : 'Original left, changed version right.'}
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {diff ? (
        mode === 'side' ? (
          <div className="grid grid-cols-2 gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={diff.a} alt="Original page" className="w-full border bg-white" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={diff.b} alt="Changed page" className="w-full border bg-white" />
          </div>
        ) : (
          <div className="relative mx-auto w-full max-w-3xl border bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mode === 'overlay' ? diff.overlay : diff.difference} alt="Page difference" className="w-full" data-visual-image={mode} />
            {mode === 'difference'
              ? diff.v.regions.map((r, i) => (
                  <span
                    key={i}
                    className="absolute border-2 border-fuchsia-600"
                    style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${(r[2] - r[0]) * 100}%`, height: `${(r[3] - r[1]) * 100}%` }}
                  />
                ))
              : null}
          </div>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Comparing…</p>
      )}
    </div>
  );
}

function Summary({ outcome }: { outcome: Outcome }) {
  const { result, visual } = outcome;
  const changedA = pagesWith(result.marksA);
  const changedB = pagesWith(result.marksB);
  const looks = visual.filter((v) => v.fraction > 0.0005);
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-4" data-compare-summary="">
      <div className="rounded-lg border p-2">
        <p className="text-muted-foreground">Text changes</p>
        <p className="font-mono text-base">{result.changes.length}</p>
      </div>
      <div className="rounded-lg border p-2">
        <p className="text-muted-foreground">Words removed / added</p>
        <p className="font-mono text-base">
          <span className="text-red-500">−{result.stats.removed}</span> <span className="text-green-600">+{result.stats.added}</span>
        </p>
      </div>
      <div className="rounded-lg border p-2">
        <p className="text-muted-foreground">Pages with text changes</p>
        <p className="font-mono text-sm">
          {changedA.size || changedB.size ? `${[...changedB].map((p) => p + 1).join(', ') || [...changedA].map((p) => p + 1).join(', ')}` : 'none'}
        </p>
      </div>
      <div className="rounded-lg border p-2">
        <p className="text-muted-foreground">Pages that look different</p>
        <p className="font-mono text-sm">{looks.length ? looks.map((v) => v.b + 1).join(', ') : 'none'}</p>
      </div>
      {result.pagesA.length !== result.pagesB.length ? (
        <p className="sm:col-span-4">
          Page count changed: {result.pagesA.length} → {result.pagesB.length}.
        </p>
      ) : null}
    </div>
  );
}

export default function ComparePdf({ tool }: ToolProps) {
  const [passwordA, setPasswordA] = useState('');
  const [passwordB, setPasswordB] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState<ResultNote[]>([]);
  const [view, setView] = useState<'text' | 'visual'>('text');
  const onOutcome = useCallback((o: Outcome) => setOutcome(o), []);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignorePunctuation, setIgnorePunctuation] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const ignore = useMemo<CompareOptions>(() => ({ ignoreCase, ignorePunctuation, ignoreWhitespace }), [ignoreCase, ignorePunctuation, ignoreWhitespace]);
  const options = useMemo<Options>(() => ({ passwordA, passwordB, ignore, onOutcome, onNotes: setNotes }), [passwordA, passwordB, ignore, onOutcome]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  const files = wb.files;

  // A different pair of files invalidates the comparison (the worker holds the open files).
  const key = files.map((f) => f.id).join('|');
  const [seen, setSeen] = useState(key);
  if (key !== seen) {
    setSeen(key);
    setOutcome(null);
    setNotes([]);
  }
  useEffect(() => () => host.terminate(), []);

  const aside =
    files.length === 2 ? (
      <SectionCard
        title="Order"
        description="The first file is the original, the second the changed version."
        action={
          <Button size="sm" variant="outline" onClick={() => wb.moveFile(1, 0)} disabled={wb.running}>
            <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} strokeWidth={2} />
            Swap
          </Button>
        }
      >
        <p className="text-xs" data-order="">
          <span className="text-muted-foreground">Original:</span> {files[0]?.file.name}
          <br />
          <span className="text-muted-foreground">Changed:</span> {files[1]?.file.name}
        </p>
      </SectionCard>
    ) : null;

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Compare"
      disabledReason={files.length === 2 ? null : files.length < 2 ? 'Add two PDFs: the original, then the changed version.' : 'Compare works on exactly two files; remove the extra ones.'}
      aside={aside}
      optionsPanel={
        <>
          <SwitchRow id="cmp-case" label="Ignore upper and lower case" checked={ignoreCase} onChange={setIgnoreCase} />
          <SwitchRow id="cmp-punct" label="Ignore punctuation" hint="Commas, quotes, dashes and other symbols." checked={ignorePunctuation} onChange={setIgnorePunctuation} />
          <SwitchRow
            id="cmp-space"
            label="Ignore spacing and line breaks"
            hint="Also words split or joined differently, such as “data base” and “database”."
            checked={ignoreWhitespace}
            onChange={setIgnoreWhitespace}
          />
          <OptionField label="Original's password" htmlFor="cmp-pw-a" hint="Only if it needs one to open.">
            <PasswordInput id="cmp-pw-a" value={passwordA} onChange={setPasswordA} placeholder="Not protected" />
          </OptionField>
          <OptionField label="Changed version's password" htmlFor="cmp-pw-b">
            <PasswordInput id="cmp-pw-b" value={passwordB} onChange={setPasswordB} placeholder="Not protected" />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Text is compared word by word across the whole documents, so moved paragraphs and added pages line up. Page images are compared
            pixel by pixel. Scans without a text layer can only be compared as images.
          </p>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} zipName="comparison.zip" notesFor={(r) => (r.name === 'comparison-report.pdf' ? notes : [])} />
      {outcome && !wb.running ? (
        <SectionCard
          title="Differences"
          action={
            <Segmented<'text' | 'visual'>
              label="Compare"
              value={view}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'visual', label: 'Visual' },
              ]}
              onChange={setView}
            />
          }
          contentClassName="flex flex-col gap-4"
        >
          <Summary outcome={outcome} />
          {view === 'text' ? <TextView outcome={outcome} /> : <VisualView outcome={outcome} />}
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}

