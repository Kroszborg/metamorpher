'use client';

import { ArrowLeft01Icon, ArrowRight01Icon, ShuffleIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/business/form-bits';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { RangeField, SwitchRow } from '@/components/pdf-stage';
import { type ResultNote, ResultRows } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { type ResultFile, RunBar } from '@/components/workbench';
import { newId } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import { type HandId, HANDS, handFamily, loadHand, unsupported } from './fonts';
import { drawPage, type HandOptions, layout, measurer, PAGE, type PageLayout, type Paper, type PaperSize } from './render';

const INKS = [
  { value: '#1b3a8c', label: 'Blue' },
  { value: '#1c1c1c', label: 'Black' },
  { value: '#0d5c3a', label: 'Green' },
  { value: '#a31d1d', label: 'Red' },
];

const SAMPLE = `Dear Asha,

Thank you for the lovely notebook! I have already filled the first ten pages with notes from the trip — the hills, the tea gardens and that tiny café by the lake.

See you on Sunday.
Love, Meera`;

type Output = 'pdf' | 'png' | 'both';
type Dpi = 150 | 300;

export default function TextToHandwriting(_props: ToolProps) {
  const [text, setText] = useState(SAMPLE);
  const [opts, setOpts] = useState<HandOptions>({
    hand: 'caveat',
    ink: INKS[0]!.value,
    paper: 'ruled',
    size: 'a4',
    fontSize: 17,
    lineGap: 24,
    margin: 18,
    marginLine: true,
    jitter: 0.55,
    slant: 3,
    seed: 7,
    cream: true,
  });
  const [ready, setReady] = useState<HandId | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [output, setOutput] = useState<Output>('both');
  const [dpi, setDpi] = useState<Dpi>(150);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ResultFile[]>([]);
  const [notes, setNotes] = useState<ResultNote[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const cancel = useRef(false);

  const set = (p: Partial<HandOptions>) => setOpts((o) => ({ ...o, ...p }));

  // The picker shows every hand in its own letters.
  useEffect(() => {
    for (const h of HANDS) void loadHand(h.id).catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    loadHand(opts.hand)
      .then(() => live && setReady(opts.hand))
      .catch(() => live && toast.error('The handwriting font could not be loaded.'));
    return () => {
      live = false;
    };
  }, [opts.hand]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const urls = results.map((r) => r.url);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [results]);

  const pages: PageLayout[] = useMemo(
    () => (ready === opts.hand && typeof document !== 'undefined' ? layout(text, opts, measurer(opts)) : []),
    [text, opts, ready],
  );
  const shownPage = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const missing = useMemo(() => unsupported(text, opts.hand), [text, opts.hand]);

  // Live preview of one page.
  useEffect(() => {
    const c = canvas.current;
    const p = pages[shownPage];
    if (!c || !p || !boxWidth) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const scale = (boxWidth / PAGE[opts.size].w) * ratio;
    c.width = Math.round(PAGE[opts.size].w * scale);
    c.height = Math.round(PAGE[opts.size].h * scale);
    c.style.width = `${boxWidth}px`;
    const ctx = c.getContext('2d');
    if (ctx) drawPage(ctx, p, opts, scale);
  }, [pages, shownPage, opts, boxWidth]);

  async function create() {
    cancel.current = false;
    setRunning(true);
    setProgress(0);
    setResults([]);
    setNotes([]);
    try {
      await loadHand(opts.hand);
      const scale = dpi / 72;
      const page = PAGE[opts.size];
      const c = document.createElement('canvas');
      c.width = Math.round(page.w * scale);
      c.height = Math.round(page.h * scale);
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available.');
      const out: ResultFile[] = [];
      const jpegs: Uint8Array[] = [];
      for (let i = 0; i < pages.length; i++) {
        if (cancel.current) throw new DOMException('Cancelled', 'AbortError');
        drawPage(ctx, pages[i] as PageLayout, opts, scale);
        if (output !== 'pdf') {
          const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
          out.push({ id: newId('r'), name: `handwriting-page-${i + 1}.png`, blob: png, url: URL.createObjectURL(png) });
        }
        if (output !== 'png') {
          const jpg = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('JPEG failed'))), 'image/jpeg', 0.88));
          jpegs.push(new Uint8Array(await jpg.arrayBuffer()));
        }
        setProgress((i + 1) / (pages.length + 1));
        await new Promise((r) => setTimeout(r, 0));
      }
      if (jpegs.length) {
        const { PDFDocument } = await import('@cantoo/pdf-lib');
        const pdf = await PDFDocument.create();
        pdf.setTitle('Handwritten pages');
        pdf.setProducer('Metamorpher');
        for (const bytes of jpegs) {
          const img = await pdf.embedJpg(bytes);
          const p = pdf.addPage([page.w, page.h]);
          p.drawImage(img, { x: 0, y: 0, width: page.w, height: page.h });
        }
        const blob = new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
        out.unshift({ id: newId('r'), name: 'handwriting.pdf', blob, url: URL.createObjectURL(blob) });
      }
      setResults(out);
      setNotes([
        { kind: 'ok', text: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} at ${dpi} dpi in ${HANDS.find((h) => h.id === opts.hand)?.label}.` },
        { kind: 'info', text: 'The pages are pictures of handwriting: the PDF has no selectable text.' },
      ]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') toast.info('Cancelled.');
      else toast.error(err instanceof Error ? err.message : 'Could not draw the pages.');
    } finally {
      setRunning(false);
      setProgress(1);
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <fieldset disabled={running} className="flex min-w-0 flex-col gap-4">
        <SectionCard title="Text" description="Typed here, written out by hand on the right. Nothing leaves this device." contentClassName="flex flex-col gap-2">
          <Textarea
            aria-label="Text to write"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            maxLength={60000}
            className="min-h-64 text-sm"
          />
          <p className="text-[0.7rem] text-muted-foreground">
            {text.trim() ? `${text.trim().split(/\s+/).length} words` : 'Empty'} · {pages.length} {pages.length === 1 ? 'page' : 'pages'}
          </p>
          {missing.length ? (
            <p className="text-[0.7rem] text-warning" data-missing>
              {HANDS.find((h) => h.id === opts.hand)?.label} has no letters for: {missing.join(' ')}. Kalam writes Hindi and Marathi; Caveat writes Cyrillic.
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="Hand and ink" contentClassName="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Handwriting">
            {HANDS.map((h) => (
              <button
                key={h.id}
                type="button"
                role="radio"
                aria-checked={opts.hand === h.id}
                onClick={() => set({ hand: h.id })}
                className={cn(
                  'flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors',
                  opts.hand === h.id ? 'border-primary bg-primary/10' : 'hover:border-primary/50',
                )}
              >
                <span className="text-xl leading-tight" style={{ fontFamily: `"${handFamily(h.id)}", cursive`, color: opts.ink }}>
                  {h.label}
                </span>
                <span className="text-[0.65rem] text-muted-foreground">{h.note}</span>
              </button>
            ))}
          </div>
          <Field label="Ink">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="Ink" value={INKS.some((i) => i.value === opts.ink) ? opts.ink : ''} options={INKS} onChange={(ink) => set({ ink })} />
              <input type="color" aria-label="Custom ink colour" value={opts.ink} onChange={(e) => set({ ink: e.currentTarget.value })} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" />
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Letter size" htmlFor="hw-size">
              <RangeField id="hw-size" min={10} max={30} step={0.5} value={opts.fontSize} onChange={(fontSize) => set({ fontSize, lineGap: Math.max(opts.lineGap, Math.round(fontSize * 1.2)) })} format={(v) => `${v} pt`} />
            </Field>
            <Field label="Line spacing" htmlFor="hw-gap">
              <RangeField id="hw-gap" min={14} max={44} value={opts.lineGap} onChange={(lineGap) => set({ lineGap })} format={(v) => `${v} pt`} />
            </Field>
            <Field label="Messiness" htmlFor="hw-jitter" hint="How much words wobble, tilt and change size.">
              <RangeField id="hw-jitter" min={0} max={1} step={0.05} value={opts.jitter} onChange={(jitter) => set({ jitter })} format={(v) => `${Math.round(v * 100)}%`} />
            </Field>
            <Field label="Slant" htmlFor="hw-slant">
              <RangeField id="hw-slant" min={-8} max={14} value={opts.slant} onChange={(slant) => set({ slant })} format={(v) => `${v}°`} />
            </Field>
          </div>
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => set({ seed: Math.floor(Math.random() * 1e9) })}>
            <HugeiconsIcon icon={ShuffleIcon} strokeWidth={2} />
            Write it again differently
          </Button>
        </SectionCard>

        <SectionCard title="Paper" contentClassName="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Paper>
              label="Paper"
              value={opts.paper}
              options={[
                { value: 'ruled', label: 'Ruled' },
                { value: 'plain', label: 'Plain' },
                { value: 'grid', label: 'Grid' },
                { value: 'dotted', label: 'Dotted' },
              ]}
              onChange={(paper) => set({ paper })}
            />
            <Segmented<PaperSize>
              label="Paper size"
              value={opts.size}
              options={[
                { value: 'a4', label: 'A4' },
                { value: 'letter', label: 'Letter' },
              ]}
              onChange={(size) => set({ size })}
            />
          </div>
          <Field label="Margins" htmlFor="hw-margin">
            <RangeField id="hw-margin" min={8} max={40} value={opts.margin} onChange={(margin) => set({ margin })} format={(v) => `${v} mm`} />
          </Field>
          {opts.paper === 'ruled' ? <SwitchRow id="hw-mline" label="Red margin line" checked={opts.marginLine} onChange={(marginLine) => set({ marginLine })} /> : null}
          <SwitchRow id="hw-cream" label="Cream paper" checked={opts.cream} onChange={(cream) => set({ cream })} />
        </SectionCard>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        <SectionCard
          title="Preview"
          description={pages.length ? `Page ${shownPage + 1} of ${pages.length}` : 'Loading the handwriting…'}
          contentClassName="flex flex-col gap-3"
          action={
            pages.length > 1 ? (
              <div className="flex gap-1">
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Previous page" disabled={shownPage === 0} onClick={() => setPageIndex(shownPage - 1)}>
                  <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Next page" disabled={shownPage >= pages.length - 1} onClick={() => setPageIndex(shownPage + 1)}>
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                </Button>
              </div>
            ) : null
          }
        >
          <div ref={box} className="overflow-hidden rounded-md border shadow-sm">
            <canvas ref={canvas} aria-label="Handwritten page preview" className="block" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<Output>
              label="Output"
              value={output}
              options={[
                { value: 'both', label: 'PDF + PNG' },
                { value: 'pdf', label: 'PDF' },
                { value: 'png', label: 'PNG' },
              ]}
              onChange={setOutput}
            />
            <Segmented<Dpi>
              label="Resolution"
              value={dpi}
              options={[
                { value: 150, label: '150 dpi' },
                { value: 300, label: '300 dpi' },
              ]}
              onChange={setDpi}
            />
          </div>
        </SectionCard>
        <RunBar
          label="Write pages"
          running={running}
          progress={progress}
          note="Drawing pages"
          disabledReason={text.trim() ? (pages.length ? null : 'Loading the handwriting…') : 'Type some text first.'}
          onRun={create}
          onCancel={() => (cancel.current = true)}
        />
        {results.length ? <ResultRows results={results} notesFor={(r) => (r.name.endsWith('.pdf') || results.length === 1 ? notes : [])} zipName="handwriting.zip" /> : null}
      </div>
    </div>
  );
}
