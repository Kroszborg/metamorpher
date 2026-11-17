'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  docPages,
  named,
  NumberInput,
  outputName,
  PageGrid,
  PageToolLayout,
  SwitchRow,
  usePdfPreview,
} from '@/components/pdf-pages';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect, perFile, useWorkbench } from '@/components/workbench';
import { isAbortError } from '@/engines';
import { PAGE_SIZES, type PageMargins, type PageSpec, type PdfPreview, type PreviewPageInfo } from '@/engines/pdf';
import type { ToolProps } from '@/tools/types';
import { type Detected, detectMargins } from './detect';

const MM = 72 / 25.4;
type SizeKey = keyof typeof PAGE_SIZES;
type Sides = { top: number; right: number; bottom: number; left: number };

type Resize = { size: SizeKey; orientation: 'auto' | 'portrait' | 'landscape'; fit: boolean };
type Options = {
  total: number;
  /** Fraction margins per page (auto crop), or one margin set in points for every page, or none. */
  crop: { perPage: (PageMargins | null)[] } | { all: PageMargins } | null;
  resize: Resize | null;
};

/** The displayed width/height of a page after cropping, for picking portrait or landscape. */
function croppedShape(info: PreviewPageInfo, m: PageMargins | null | undefined): { w: number; h: number } {
  if (!m) return { w: info.width, h: info.height };
  const k = m.unit === 'pt' ? { x: 1, y: 1 } : { x: info.width, y: info.height };
  return { w: info.width - (m.left + m.right) * k.x, h: info.height - (m.top + m.bottom) * k.y };
}

const job = perFile<Options>(async ({ file }, { total, crop, resize }, ctx) => {
  const marginsOf = (page: number): PageMargins | undefined =>
    crop === null ? undefined : 'all' in crop ? crop.all : (crop.perPage[page] ?? undefined);
  let shapes: { w: number; h: number }[] | null = null;
  if (resize && resize.orientation === 'auto') {
    // Pick portrait or landscape per page, from the page as it will look after cropping.
    ctx.onProgress(0.02, 'Measuring pages');
    const preview: PdfPreview = await ctx.engines.pdf.open(file, { signal: ctx.signal, name: file.name });
    try {
      shapes = [];
      for (let i = 0; i < total; i += 1) {
        if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        shapes.push(croppedShape(await preview.pageInfo(i), marginsOf(i)));
        if (i % 25 === 0) ctx.onProgress(0.02 + (0.3 * i) / total, `Measuring page ${i + 1} of ${total}`);
      }
    } finally {
      preview.close();
    }
  }
  const specs: PageSpec[] = Array.from({ length: total }, (_, page) => {
    const spec: PageSpec = { page, crop: marginsOf(page) };
    if (resize) {
      const base = PAGE_SIZES[resize.size];
      const short = Math.min(base.width, base.height);
      const long = Math.max(base.width, base.height);
      const shape = shapes?.[page];
      const landscape = resize.orientation === 'landscape' || (resize.orientation === 'auto' && !!shape && shape.w > shape.h);
      spec.resize = { width: landscape ? long : short, height: landscape ? short : long, fit: resize.fit };
    }
    return spec;
  });
  ctx.onProgress(0.4, 'Writing pages');
  const blob = await ctx.engines.pdf.pages.rewrite(named(file), specs, { signal: ctx.signal });
  const what = [crop ? 'cropped' : '', resize ? PAGE_SIZES[resize.size].label : ''].filter(Boolean).join('_');
  return { name: outputName(file, what || 'pages'), blob };
});

/** Shades what the crop removes, over a thumbnail. */
function CropShade({
  preview,
  index,
  margins,
}: {
  preview: PdfPreview | null;
  index: number;
  margins: PageMargins | null | undefined;
}) {
  const [info, setInfo] = useState<{ key: string; value: PreviewPageInfo } | null>(null);
  const needInfo = margins?.unit === 'pt';
  const key = `${index}`;
  useEffect(() => {
    if (!needInfo || !preview) return;
    let live = true;
    preview.pageInfo(index).then(
      (value) => live && setInfo({ key, value }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [needInfo, preview, index, key]);
  if (!margins) return null;
  let f = margins;
  if (margins.unit === 'pt') {
    const v = info?.key === key ? info.value : null;
    if (!v) return null;
    f = { left: margins.left / v.width, right: margins.right / v.width, top: margins.top / v.height, bottom: margins.bottom / v.height };
  }
  const pct = (n: number) => `${Math.max(0, Math.min(1, n)) * 100}%`;
  return (
    <span
      className="absolute rounded-[1px] outline outline-[100vmax] outline-black/45 ring-1 ring-primary"
      style={{ left: pct(f.left), top: pct(f.top), right: pct(f.right), bottom: pct(f.bottom) }}
    />
  );
}

/** Finished margin detection per open document. */
const finished = new WeakMap<PdfPreview, Detected[]>();

const SIZES = (Object.keys(PAGE_SIZES) as SizeKey[]).map((k) => ({ value: k, label: PAGE_SIZES[k].label }));

export default function CropPdf({ tool }: ToolProps) {
  const [cropOn, setCropOn] = useState(true);
  const [source, setSource] = useState<'manual' | 'auto'>('auto');
  const [mm, setMm] = useState<Sides>({ top: 10, right: 10, bottom: 10, left: 10 });
  const [padMm, setPadMm] = useState(3);
  const [uniform, setUniform] = useState(false);
  const [resizeOn, setResizeOn] = useState(false);
  const [resize, setResize] = useState<Resize>({ size: 'a4', orientation: 'auto', fit: true });
  // Detection results arrive once, at the end; `done` only counts progress, so the
  // page grid does not re-render while hundreds of pages are measured.
  const [found, setFound] = useState<{ preview: PdfPreview | null; pages: Detected[]; done: number; error: string | null }>({
    preview: null,
    pages: [],
    done: 0,
    error: null,
  });
  const [total, setTotal] = useState(0);

  // Per-page crop margins from detection, padded, as fractions of each page.
  const autoCrops = useMemo(() => {
    if (found.pages.length === 0) return [];
    const pad = padMm * MM;
    const perPage = found.pages.map((d): PageMargins | null =>
      d.margins
        ? {
            left: Math.max(0, d.margins.left - pad / d.width),
            right: Math.max(0, d.margins.right - pad / d.width),
            top: Math.max(0, d.margins.top - pad / d.height),
            bottom: Math.max(0, d.margins.bottom - pad / d.height),
          }
        : null,
    );
    if (!uniform) return perPage;
    // One crop for every page: the smallest margin on each side, in points.
    const pts = found.pages
      .map((d, i) => {
        const m = perPage[i];
        return m ? { left: m.left * d.width, right: m.right * d.width, top: m.top * d.height, bottom: m.bottom * d.height } : null;
      })
      .filter((m) => m !== null);
    if (pts.length === 0) return perPage.map(() => null);
    const all: PageMargins = {
      unit: 'pt',
      left: Math.min(...pts.map((m) => m.left)),
      right: Math.min(...pts.map((m) => m.right)),
      top: Math.min(...pts.map((m) => m.top)),
      bottom: Math.min(...pts.map((m) => m.bottom)),
    };
    return perPage.map(() => all);
  }, [found.pages, padMm, uniform]);

  const crop = useMemo((): Options['crop'] => {
    if (!cropOn) return null;
    if (source === 'manual') {
      return { all: { unit: 'pt', top: mm.top * MM, right: mm.right * MM, bottom: mm.bottom * MM, left: mm.left * MM } };
    }
    return { perPage: autoCrops };
  }, [cropOn, source, mm, autoCrops]);
  const wb = useWorkbench({
    job,
    options: { total, crop, resize: resizeOn ? resize : null },
    accept: tool.accept,
    multiple: false,
  });
  const input = wb.files[0];
  const doc = usePdfPreview(input);
  const count = doc.status === 'ready' ? doc.pageCount : 0;
  if (count !== total) setTotal(count);

  // Detect white margins once per document (finished results are cached), when auto crop is wanted.
  const preview = doc.preview;
  const detectOn = cropOn && source === 'auto';
  useEffect(() => {
    if (!detectOn || !preview || finished.has(preview)) return;
    const controller = new AbortController();
    const pages: Detected[] = [];
    let last = 0;
    detectMargins(preview, controller.signal, (i, d) => {
      pages[i] = d;
      const now = performance.now();
      if (now - last > 400) {
        last = now;
        setFound({ preview, pages: [], done: i + 1, error: null });
      }
    }).then(
      () => {
        finished.set(preview, pages);
        setFound({ preview, pages, done: pages.length, error: null });
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setFound({ preview, pages: [], done: 0, error: err instanceof Error ? err.message : 'Margins could not be detected.' });
      },
    );
    return () => controller.abort();
  }, [detectOn, preview]);

  const detecting = detectOn && preview !== null && !finished.has(preview);
  const ownResults = found.preview === preview && !detecting;
  const pages = useMemo(() => docPages(preview, total), [preview, total]);
  const grid = useMemo(() => {
    if (!preview) return null;
    const marginsFor = (i: number): PageMargins | null =>
      crop === null ? null : 'all' in crop ? crop.all : ownResults ? (crop.perPage[i] ?? null) : null;
    return (
      <PageGrid
        pages={pages}
        aria-label="Pages"
        disabled={wb.running}
        overlay={crop ? (page) => <CropShade preview={preview} index={page.index} margins={marginsFor(page.index)} /> : undefined}
      />
    );
  }, [preview, pages, wb.running, crop, ownResults]);
  const blank = found.preview === preview ? found.pages.filter((d) => d && !d.margins).length : 0;

  const reason = !cropOn && !resizeOn
    ? 'Turn on cropping, resizing or both.'
    : found.error && source === 'auto' && cropOn
      ? found.error
      : detecting
        ? `Finding margins… page ${found.preview === preview ? found.done : 0} of ${total}`
        : null;

  const setSide = (side: keyof Sides) => (v: number) => setMm((m) => ({ ...m, [side]: v }));

  return (
    <PageToolLayout
      wb={wb}
      accept={tool.accept}
      docs={input ? [doc] : []}
      runLabel={cropOn && resizeOn ? 'Crop and resize' : resizeOn ? 'Resize pages' : 'Crop PDF'}
      disabledReason={reason}
      pagesDescription={
        cropOn
          ? `${total} pages · the shaded area is cut away${blank > 0 ? ` · ${blank} blank ${blank === 1 ? 'page is' : 'pages are'} left as they are` : ''}`
          : `${total} pages`
      }
      optionsPanel={
        <>
          <SwitchRow label="Crop margins" checked={cropOn} onChange={setCropOn} />
          {cropOn ? (
            <>
              <Segmented
                label="Crop"
                value={source}
                options={[
                  { value: 'auto', label: 'Remove white margins' },
                  { value: 'manual', label: 'Set margins' },
                ]}
                onChange={setSource}
              />
              {source === 'auto' ? (
                <>
                  <OptionField label="Keep a border of" htmlFor="cp-pad">
                    <NumberInput id="cp-pad" value={padMm} onChange={setPadMm} min={0} max={50} suffix="mm" />
                  </OptionField>
                  <SwitchRow
                    label="Same crop for every page"
                    hint={uniform ? 'Crops no page past its content.' : 'Each page is cropped to its own content.'}
                    checked={uniform}
                    onChange={setUniform}
                  />
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                    <OptionField key={side} label={side[0]?.toUpperCase() + side.slice(1)} htmlFor={`cp-${side}`}>
                      <NumberInput id={`cp-${side}`} value={mm[side]} onChange={setSide(side)} min={0} max={500} suffix="mm" decimals />
                    </OptionField>
                  ))}
                </div>
              )}
            </>
          ) : null}
          <SwitchRow label="Change page size" checked={resizeOn} onChange={setResizeOn} />
          {resizeOn ? (
            <>
              <OptionField label="Page size" htmlFor="cp-size">
                <OptionSelect id="cp-size" value={resize.size} options={SIZES} onChange={(size) => setResize((r) => ({ ...r, size }))} />
              </OptionField>
              <OptionField label="Orientation">
                <Segmented
                  label="Orientation"
                  value={resize.orientation}
                  options={[
                    { value: 'auto', label: 'Match page' },
                    { value: 'portrait', label: 'Portrait' },
                    { value: 'landscape', label: 'Landscape' },
                  ]}
                  onChange={(orientation) => setResize((r) => ({ ...r, orientation }))}
                />
              </OptionField>
              <OptionField
                label="Content"
                hint={resize.fit ? 'Scaled up or down to fit, keeping its proportions.' : 'Kept at 100%, centred; may be clipped.'}
              >
                <Segmented
                  label="Content"
                  value={resize.fit ? 'fit' : 'keep'}
                  options={[
                    { value: 'fit', label: 'Scale to fit' },
                    { value: 'keep', label: 'Actual size' },
                  ]}
                  onChange={(v) => setResize((r) => ({ ...r, fit: v === 'fit' }))}
                />
              </OptionField>
            </>
          ) : null}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Cropping sets the visible area of each page; text and drawings stay vector, and the trimmed parts are hidden
            rather than deleted.
          </p>
        </>
      }
    >
      {grid}
    </PageToolLayout>
  );
}
