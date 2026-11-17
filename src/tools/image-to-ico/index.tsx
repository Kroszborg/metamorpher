'use client';

/* eslint-disable @next/next/no-img-element -- object URLs of local files, not optimisable */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHECKERBOARD,
  ColorField,
  ImageWorkbench,
  isHexColor,
  type Note,
  type Reporter,
  RunNotes,
  useImagePreview,
  useRunNotes,
} from '@/components/image';
import { CopyButton } from '@/components/kit/copy-button';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { Input } from '@/components/ui/input';
import { OptionField, perFile } from '@/components/workbench';
import { encodeIcoMulti, type RenditionSpec } from '@/engines/image';
import { extensionOf } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';
import { prepareSvg, rasterise } from '../svg-to-png/render';

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
type IcoSize = (typeof ICO_SIZES)[number];

type Options = {
  sizes: IcoSize[];
  fit: 'contain' | 'cover';
  touchBackground: string;
  name: string;
  report?: Reporter;
};

/** PNGs that go next to the ICO, with their file names. */
const PNGS: { name: string; size: number; opaque?: boolean }[] = [
  { name: 'favicon-16x16.png', size: 16 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180, opaque: true },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 },
];

const SNIPPET = `<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">`;

function manifest(name: string, background: string): string {
  return `${JSON.stringify(
    {
      name,
      short_name: name,
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: background,
      background_color: background,
      display: 'standalone',
    },
    null,
    2,
  )}\n`;
}

const README = (sizes: readonly number[]) => `Favicons made with Metamorpher (on your device).

Put these files in the root of your site and add the tags from favicon-snippet.html to <head>.

favicon.ico contains ${sizes.map((s) => `${s}×${s}`).join(', ')}.
`;

/** SVG logos are rendered on the main thread first (workers cannot decode SVG). */
async function sourceFor(file: File, signal: AbortSignal): Promise<Blob> {
  if (extensionOf(file.name) !== 'svg' && file.type !== 'image/svg+xml') return file;
  const svg = prepareSvg(await file.text());
  const scale = 1024 / Math.max(svg.width, svg.height);
  const pixels = await rasterise(svg, Math.round(svg.width * scale), Math.round(svg.height * scale), null, signal);
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  const { image, archive } = ctx.engines;
  ctx.onProgress(0.1, 'Reading the image');
  const source = await sourceFor(file, ctx.signal);
  const probe = await image.dimensions(source, ctx.signal);
  const sizes = [...o.sizes].sort((a, b) => a - b);
  const specs: RenditionSpec[] = [
    ...sizes.map((s) => ({ width: s, height: s, fit: o.fit, output: { format: 'png' as const } })),
    ...PNGS.map((p) => ({
      width: p.size,
      height: p.size,
      fit: o.fit,
      output: { format: 'png' as const },
      background: p.opaque ? o.touchBackground : undefined,
    })),
  ];
  ctx.onProgress(0.3, 'Resizing');
  const out = await image.renditions(source, specs, ctx.signal);
  ctx.onProgress(0.8, 'Packing');
  const icoParts = await Promise.all(
    out.slice(0, sizes.length).map(async (r) => ({ png: new Uint8Array(await r.blob.arrayBuffer()), width: r.width, height: r.height })),
  );
  const ico = new Blob([encodeIcoMulti(icoParts) as Uint8Array<ArrayBuffer>], { type: 'image/x-icon' });
  const pngs = out.slice(sizes.length).map((r, i) => ({ name: PNGS[i]?.name ?? `icon-${i}.png`, blob: r.blob }));
  const text = (s: string, type: string) => new Blob([s], { type });
  const zip = await archive.zip(
    [
      { name: 'favicon.ico', blob: ico },
      ...pngs,
      { name: 'site.webmanifest', blob: text(manifest(o.name.trim() || 'My site', o.touchBackground), 'application/manifest+json') },
      { name: 'favicon-snippet.html', blob: text(`${SNIPPET}\n`, 'text/html') },
      { name: 'README.txt', blob: text(README(sizes), 'text/plain') },
    ],
    ctx.signal,
  );
  const notes: Note[] = [{ text: `favicon.ico holds ${sizes.map((s) => `${s} px`).join(', ')}; the ZIP adds ${PNGS.length} PNGs, a web manifest and the <link> tags.` }];
  const side = Math.min(probe.width, probe.height);
  if (side < 512) notes.push({ text: `The image is ${probe.width} × ${probe.height}; the larger icons are enlarged from it and may look soft. Use 512 px or more (or an SVG) for sharp results.`, tone: 'warn' });
  if (probe.width !== probe.height) {
    notes.push({ text: o.fit === 'contain' ? 'Not square: it was centred with transparent space around it.' : 'Not square: the centre was cropped.' });
  }
  o.report?.({ id, name: file.name }, notes);
  return [
    { name: 'favicons.zip', blob: zip },
    { name: 'favicon.ico', blob: ico },
  ];
});

function SizeToggles({ value, onChange }: { value: IcoSize[]; onChange: (v: IcoSize[]) => void }) {
  return (
    <fieldset className="flex flex-wrap gap-1 rounded-lg border bg-background p-1">
      <legend className="sr-only">Sizes in the ICO</legend>
      {ICO_SIZES.map((s) => {
        const on = value.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== s) : [...value, s])}
            className={cn(
              'rounded-md px-2.5 py-1 font-mono text-xs font-medium tabular-nums transition-colors',
              on ? 'bg-muted text-foreground ring-1 ring-border' : 'text-muted-foreground',
            )}
          >
            {s}
          </button>
        );
      })}
    </fieldset>
  );
}

function IconPreview({ file, fit, background }: { file: File; fit: 'contain' | 'cover'; background: string }) {
  const isSvg = extensionOf(file.name) === 'svg' || file.type === 'image/svg+xml';
  const { preview, error } = useImagePreview(isSvg ? null : file, 1024);
  const box = useRef<HTMLDivElement>(null);
  // An SVG is shown by the browser directly (as an image: no scripts, no external loads).
  useEffect(() => {
    if (!isSvg || !box.current) return;
    const u = URL.createObjectURL(file);
    for (const img of Array.from(box.current.querySelectorAll('img'))) img.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file, isSvg]);
  return (
    <SectionCard title="Preview" description="Approximate: the files are resampled with Lanczos3, not by the browser.">
      {error ? (
        <p role="alert" className="text-xs/relaxed text-destructive">
          {error}
        </p>
      ) : isSvg || preview ? (
        <div ref={box} className="flex flex-wrap items-end gap-5">
          {[16, 32, 48, 180, 192].map((s) => (
            <figure key={s} className="flex flex-col items-center gap-1.5">
              <div
                className="grid place-items-center overflow-hidden rounded-md border"
                style={{
                  width: Math.min(s, 96) + 8,
                  height: Math.min(s, 96) + 8,
                  ...(s === 180 ? { backgroundColor: background } : CHECKERBOARD),
                }}
              >
                <img
                  src={preview?.url}
                  alt=""
                  style={{ width: Math.min(s, 96), height: Math.min(s, 96), objectFit: fit }}
                  className={s === 180 ? 'rounded-[22%]' : undefined}
                />
              </div>
              <figcaption className="font-mono text-[0.65rem] text-muted-foreground">
                {s === 180 ? 'apple 180' : s}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="h-24 animate-pulse rounded-lg border bg-muted" />
      )}
    </SectionCard>
  );
}

export default function ImageToIco({ tool }: ToolProps) {
  const [sizes, setSizes] = useState<IcoSize[]>([16, 32, 48]);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [touchBackground, setTouchBackground] = useState('#ffffff');
  const [name, setName] = useState('');
  const notes = useRunNotes();
  const options = useMemo<Options>(
    () => ({ sizes, fit, touchBackground, name, report: notes.report }),
    [sizes, fit, touchBackground, name, notes.report],
  );

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      multiple={false}
      runLabel="Make favicons"
      onRun={notes.clear}
      validate={() =>
        sizes.length === 0
          ? 'Choose at least one size for the ICO.'
          : !isHexColor(touchBackground)
            ? 'Enter a background colour as #rrggbb.'
            : null
      }
      preview={(wb) =>
        wb.files[0] ? <IconPreview key={wb.files[0].id} file={wb.files[0].file} fit={fit} background={touchBackground} /> : null
      }
      below={
        <>
          <RunNotes entries={notes.entries} />
          <SectionCard
            title="HTML for your site"
            description="Also in the ZIP as favicon-snippet.html. Paste it into <head>."
            action={<CopyButton value={SNIPPET} label="Copy the tags" showLabel />}
          >
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[0.7rem]/relaxed">{SNIPPET}</pre>
          </SectionCard>
        </>
      }
      optionsPanel={
        <>
          <OptionField label="Sizes in favicon.ico" hint="16, 32 and 48 cover browsers and Windows; add 256 for desktop shortcuts.">
            <SizeToggles value={sizes} onChange={setSizes} />
          </OptionField>
          <OptionField label="Not square?">
            <Segmented
              label="Not square?"
              value={fit}
              options={[
                { value: 'contain', label: 'Fit inside' },
                { value: 'cover', label: 'Crop the centre' },
              ]}
              onChange={setFit}
            />
          </OptionField>
          <OptionField
            label="Apple touch icon background"
            htmlFor="ico-bg"
            hint="iOS shows transparent areas as black, so this icon is made opaque. Also the manifest’s theme colour."
          >
            <ColorField id="ico-bg" value={touchBackground} onChange={setTouchBackground} />
          </OptionField>
          <OptionField label="Site name (for the manifest)" htmlFor="ico-name">
            <Input id="ico-name" value={name} placeholder="My site" onChange={(e) => setName(e.target.value)} />
          </OptionField>
        </>
      }
    />
  );
}
