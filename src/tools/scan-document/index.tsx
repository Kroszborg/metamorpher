'use client';

import { CropIcon, Maximize01Icon, RotateLeft01Icon, RotateRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { defineJob, OptionField, OptionSelect, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES } from '@/engines/mupdf';
import { OCR_LANGUAGES, OcrDocument, ocrDownloadBytes, ocrEngine, type PageSheet, toPageLines } from '@/engines/ocr';
import { abortError, WorkerHost } from '@/engines/worker-host';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import { CameraCapture } from './camera';
import type { Filter, Point, Quad } from './process';
import type { ScanWorkerApi } from './scan.worker';

const host = new WorkerHost<ScanWorkerApi>(() => new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' }));

type Quarter = 0 | 1 | 2 | 3;
type PageState = { quad: Quad; found: boolean; width: number; height: number; preview: string; quarter: Quarter; auto: Quad };
type SheetId = 'fit' | 'a4' | 'letter';
const SHEETS: Record<Exclude<SheetId, 'fit'>, PageSheet> = {
  a4: { width: 595.28, height: 841.89, margin: 18 },
  letter: { width: 612, height: 792, margin: 18 },
};

type Options = {
  pages: Record<string, PageState>;
  filter: Filter;
  sheet: SheetId;
  ocr: boolean;
  lang: string;
  onNotes: (n: ResultNote[]) => void;
};

const job = defineJob<Options>({
  mode: 'batch',
  async run(inputs, o, ctx) {
    const images: Uint8Array[] = [];
    for (const [i, input] of inputs.entries()) {
      if (ctx.signal.aborted) throw abortError();
      ctx.onProgress((0.5 * i) / inputs.length, `Flattening page ${i + 1} of ${inputs.length}`);
      const st = o.pages[input.id];
      if (!st) throw new Error(`${input.file.name} is still being prepared. Wait a moment and try again.`);
      const { blob } = await host.call((api) => api.process(input.file, st.quad, o.filter, st.quarter), ctx.signal);
      images.push(new Uint8Array(await blob.arrayBuffer()));
    }
    ctx.onProgress(0.5, 'Making the PDF');
    const doc = await OcrDocument.fromImages(images, { signal: ctx.signal, sheet: o.sheet === 'fit' ? undefined : SHEETS[o.sheet] });
    let words = 0;
    let conf = 0;
    try {
      if (o.ocr) {
        for (let i = 0; i < doc.pageCount; i += 1) {
          if (ctx.signal.aborted) throw abortError();
          const base = 0.55 + (0.4 * i) / doc.pageCount;
          const render = await doc.render(i, 300);
          const result = await ocrEngine.recognize(render.image, {
            langs: o.lang,
            dpi: (render.width / render.pageWidth) * 72,
            signal: ctx.signal,
            onProgress: (f, note) => ctx.onProgress(base + (0.4 / doc.pageCount) * f, `Page ${i + 1}: ${note.toLowerCase()}`),
          });
          const lines = toPageLines(result, render.pageWidth, render.pageHeight);
          const n = lines.reduce((s, l) => s + l.words.length, 0);
          words += n;
          conf += result.confidence * n;
          if (n) await doc.addTextLayer(i, lines);
        }
      }
      ctx.onProgress(0.97, 'Writing the PDF');
      const blob = await doc.save();
      const notes: ResultNote[] = [{ kind: 'ok', text: `${inputs.length} ${inputs.length === 1 ? 'page' : 'pages'} flattened and cleaned.` }];
      if (o.ocr) {
        notes.push(
          words
            ? { kind: 'ok', text: `Text recognised: ${words.toLocaleString()} words (average confidence ${Math.round(conf / words)}%). The PDF is searchable.` }
            : { kind: 'warn', text: 'No text was recognised. Check the language, or whether the pages hold text.' },
        );
      }
      o.onNotes(notes);
      const stamp = new Date().toISOString().slice(0, 10);
      return [{ name: `scan-${stamp}.pdf`, blob }];
    } finally {
      doc.close();
    }
  },
});

const CORNER_LABELS = ['top left', 'top right', 'bottom right', 'bottom left'];

/** The photo with the page outline; drag the corners to fit the page edges. */
function CornerEditor({ page, onChange }: { page: PageState; onChange: (q: Quad) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = size.w ? size.w / page.width : 0;
  const pts = page.quad.map(([x, y]) => [x * k, y * k] as const);
  const move = (e: React.PointerEvent, i: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !k) return;
    const x = Math.min(page.width, Math.max(0, (e.clientX - r.left) / k));
    const y = Math.min(page.height, Math.max(0, (e.clientY - r.top) / k));
    const next = [...page.quad] as Quad;
    next[i] = [Math.round(x), Math.round(y)] as Point;
    onChange(next);
  };
  return (
    <div ref={box} className="relative w-full touch-none select-none" style={{ aspectRatio: `${page.width} / ${page.height}` }} data-corner-editor="" data-quad={JSON.stringify(page.quad)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.preview} alt="Photo" className="absolute inset-0 size-full rounded-md" draggable={false} />
      {k ? (
        <svg className="absolute inset-0 size-full overflow-visible" viewBox={`0 0 ${size.w} ${size.h}`}>
          <path
            d={`M0 0H${size.w}V${size.h}H0Z M${pts.map((p) => p.join(' ')).join(' L')} Z`}
            fillRule="evenodd"
            className="fill-black/45"
          />
          <polygon points={pts.map((p) => p.join(',')).join(' ')} className="fill-none stroke-primary" strokeWidth={2} />
          {pts.map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={drag === i ? 14 : 11}
              data-corner={i}
              aria-label={`Move the ${CORNER_LABELS[i]} corner`}
              className="cursor-grab fill-primary/30 stroke-primary"
              strokeWidth={3}
              onPointerDown={(e) => {
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                setDrag(i);
              }}
              onPointerMove={(e) => drag === i && move(e, i)}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}

/** The cleaned page as it will be saved (small copy, refreshed after edits). */
function ResultPreview({ file, page, filter }: { file: File; page: PageState; filter: Filter }) {
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  const key = `${page.quad.flat().join(',')}|${page.quarter}|${filter}`;
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    const t = window.setTimeout(() => {
      host
        .call((api) => api.preview(file, page.quad, filter, page.quarter))
        .then((blob) => {
          if (!alive) return;
          made = URL.createObjectURL(blob);
          setUrl({ key, url: made });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
      if (made) URL.revokeObjectURL(made);
    };
  }, [file, page.quad, page.quarter, filter, key]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url.url} alt="Cleaned page" className={cn('w-full rounded-md border bg-white', url.key !== key && 'opacity-60')} data-result-preview="" />
  ) : (
    <p className="text-xs text-muted-foreground">Preparing…</p>
  );
}

export default function ScanDocument({ tool }: ToolProps) {
  const [pages, setPages] = useState<Record<string, PageState>>({});
  const [filter, setFilter] = useState<Filter>('enhance');
  const [sheet, setSheet] = useState<SheetId>('a4');
  const [ocr, setOcr] = useState(false);
  const [lang, setLang] = useState('eng');
  const [notes, setNotes] = useState<ResultNote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const options = useMemo<Options>(() => ({ pages, filter, sheet, ocr, lang, onNotes: setNotes }), [pages, filter, sheet, ocr, lang]);
  const wb = useWorkbench({ job, options, accept: tool.accept });
  const files = wb.files;

  // Detect the page in every new photo.
  const started = useRef(new Set<string>());
  useEffect(() => {
    for (const f of files) {
      if (started.current.has(f.id)) continue;
      started.current.add(f.id);
      host
        .call((api) => api.detect(f.file))
        .then((d) => {
          const preview = URL.createObjectURL(d.preview);
          setPages((p) => ({ ...p, [f.id]: { quad: d.quad, auto: d.quad, found: d.found, width: d.width, height: d.height, preview, quarter: 0 } }));
        })
        .catch((err: unknown) => setProblems((p) => ({ ...p, [f.id]: err instanceof Error ? err.message : 'This image could not be read.' })));
    }
  }, [files]);
  // Previews of removed photos are released (their state entries are simply ignored).
  const revoked = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(files.map((f) => f.id));
    for (const [id, p] of Object.entries(pages)) {
      if (live.has(id) || revoked.current.has(id)) continue;
      revoked.current.add(id);
      URL.revokeObjectURL(p.preview);
    }
  }, [files, pages]);
  const current = files.find((f) => f.id === selected) ?? files[files.length - 1] ?? null;
  const state = current ? pages[current.id] : undefined;
  const update = useCallback((id: string, patch: Partial<PageState>) => setPages((p) => (p[id] ? { ...p, [id]: { ...p[id], ...patch } } : p)), []);

  const waiting = files.some((f) => !pages[f.id] && !problems[f.id]);
  const broken = files.filter((f) => problems[f.id]);

  const editor = (
    <SectionCard title="Pages" description="Add photos or use the camera. Check each page's corners; drag them onto the page edges if needed." contentClassName="flex flex-col gap-4">
      <CameraCapture onCapture={(file) => wb.addFiles([file])} disabled={wb.running} />
      {files.length ? (
        <div className="flex flex-wrap gap-2" data-page-strip="">
          {files.map((f, i) => {
            const p = pages[f.id];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelected(f.id)}
                className={cn('relative h-20 w-16 overflow-hidden rounded-md border bg-muted', current?.id === f.id && 'ring-2 ring-primary')}
                title={f.file.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p ? <img src={p.preview} alt="" className="size-full object-cover" /> : null}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[0.6rem] text-white">{i + 1}</span>
                {p && !p.found ? <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-warning" title="Edges not found" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {current && state ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-2">
            <CornerEditor page={state} onChange={(quad) => update(current.id, { quad })} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => update(current.id, { quad: state.auto })}>
                <HugeiconsIcon icon={CropIcon} strokeWidth={2} />
                Detected edges
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  update(current.id, {
                    quad: [
                      [0, 0],
                      [state.width, 0],
                      [state.width, state.height],
                      [0, state.height],
                    ],
                  })
                }
              >
                <HugeiconsIcon icon={Maximize01Icon} strokeWidth={2} />
                Whole photo
              </Button>
              <Button size="sm" variant="outline" aria-label="Rotate left" onClick={() => update(current.id, { quarter: ((state.quarter + 3) % 4) as Quarter })}>
                <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} />
              </Button>
              <Button size="sm" variant="outline" aria-label="Rotate right" onClick={() => update(current.id, { quarter: ((state.quarter + 1) % 4) as Quarter })}>
                <HugeiconsIcon icon={RotateRight01Icon} strokeWidth={2} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" data-detect-note="">
              {state.found ? 'Page edges found automatically.' : 'No clear page edges were found, so the whole photo is used. Drag the corners onto the page.'}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">Result</p>
            <ResultPreview file={current.file} page={state} filter={filter} />
          </div>
        </div>
      ) : current && problems[current.id] ? (
        <p className="text-xs text-destructive">{problems[current.id]}</p>
      ) : current ? (
        <p className="text-xs text-muted-foreground">Finding the page…</p>
      ) : null}
    </SectionCard>
  );

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Make PDF"
      disabledReason={broken.length ? `Remove ${broken.map((f) => f.file.name).join(', ')}: it could not be read.` : waiting ? 'Finding the pages…' : files.length ? null : 'Add photos of the pages, or use the camera.'}
      aside={editor}
      optionsPanel={
        <>
          <OptionField label="Look">
            <Segmented<Filter>
              label="Look"
              value={filter}
              options={[
                { value: 'enhance', label: 'Colour' },
                { value: 'gray', label: 'Grey' },
                { value: 'bw', label: 'B&W' },
                { value: 'original', label: 'Photo' },
              ]}
              onChange={setFilter}
            />
          </OptionField>
          <OptionField label="Page size" htmlFor="scan-sheet">
            <OptionSelect<SheetId>
              id="scan-sheet"
              value={sheet}
              options={[
                { value: 'a4', label: 'A4' },
                { value: 'letter', label: 'US Letter' },
                { value: 'fit', label: 'Same as the page' },
              ]}
              onChange={setSheet}
            />
          </OptionField>
          <SwitchRow id="scan-ocr" label="Make text searchable (OCR)" hint="Recognises the text on this device and adds it invisibly, so you can search and copy it." checked={ocr} onChange={setOcr} />
          {ocr ? (
            <OptionField label="Language" htmlFor="scan-lang">
              <OptionSelect id="scan-lang" value={lang} options={OCR_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onChange={setLang} />
            </OptionField>
          ) : null}
          <EngineNote bytes={ocr ? ocrDownloadBytes([lang]) + MUPDF_DOWNLOAD_BYTES : MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      <ResultRows results={wb.results} notesFor={() => notes} />
    </ToolFrame>
  );
}
