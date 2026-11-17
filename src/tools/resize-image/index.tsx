'use client';

import { useMemo, useState } from 'react';
import {
  DimensionInputs,
  ImageWorkbench,
  isHexColor,
  type NameClaimer,
  type Note,
  NumberField,
  OutputOptions,
  type OutputSettings,
  type Reporter,
  resolveOutput,
  RunNotes,
  SwitchField,
  sourceNotes,
  useImageProbe,
  useRunNotes,
  withDecodeFallback,
} from '@/components/image';
import { ColorField } from '@/components/image/color-field';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import { FORMAT_EXT, MAX_PIXELS, type ResizeSpec } from '@/engines/image';
import { replaceExtension } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Mode = 'percent' | 'pixels' | 'longest';
/** How a W×H box is met when an image's shape differs. */
type Fit = 'inside' | 'cover' | 'pad' | 'stretch';

type Options = {
  mode: Mode;
  percent: number;
  width: number;
  height: number;
  locked: boolean;
  fit: Fit;
  longest: number;
  noEnlarge: boolean;
  padColor: string;
  output: OutputSettings;
  report?: Reporter;
  claim?: NameClaimer;
};

const MAX_SIDE = 30000;

/** The resize for a W×H source, or null to keep its size. */
function plan(o: Options, W: number, H: number): ResizeSpec | null {
  let spec: ResizeSpec;
  if (o.mode === 'percent') {
    spec = { width: Math.round((W * o.percent) / 100), height: Math.round((H * o.percent) / 100) };
  } else if (o.mode === 'longest') {
    const s = o.longest / Math.max(W, H);
    spec = { width: Math.round(W * s), height: Math.round(H * s) };
  } else {
    const fit: Fit = o.locked ? 'inside' : o.fit;
    if (fit === 'inside') {
      const s = Math.min(o.width / W, o.height / H);
      spec = { width: Math.round(W * s), height: Math.round(H * s) };
    } else {
      spec = {
        width: o.width,
        height: o.height,
        fit: fit === 'pad' ? 'contain' : fit,
        padColor: fit === 'pad' && o.padColor !== 'transparent' ? o.padColor : undefined,
      };
    }
  }
  spec.width = Math.max(1, spec.width);
  spec.height = Math.max(1, spec.height);
  // Exact sizes (fill, pad, stretch) are always met; scaling modes respect "don't enlarge".
  if (o.noEnlarge && !spec.fit && (spec.width > W || spec.height > H)) return null;
  if (spec.width === W && spec.height === H && !spec.fit) return null;
  return spec;
}

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  const { image } = ctx.engines;
  const notes: Note[] = [];
  const r = await withDecodeFallback(file, ctx, async (src) => {
    const probe = await image.probe(src, ctx.signal);
    const dims = probe.width && probe.height ? probe : await image.dimensions(src, ctx.signal);
    const spec = plan(o, dims.width, dims.height);
    if (!spec) {
      const why = o.noEnlarge ? ' (smaller images are not enlarged)' : '';
      notes.push({ text: `Kept at ${dims.width} × ${dims.height}${why}.` });
    }
    if (spec && spec.width * spec.height > MAX_PIXELS) {
      throw new Error(`${spec.width} × ${spec.height} is larger than the ${MAX_PIXELS / 1e6} megapixels the browser can handle.`);
    }
    const format = resolveOutput(o.output.format, probe.format);
    // Nothing to do: hand back the original bytes rather than re-encoding them.
    if (!spec && format === probe.format && src === file) return null;
    ctx.onProgress(0.3, 'Resizing');
    const result = await image.process(
      src,
      {
        resize: spec ?? undefined,
        output: {
          format,
          quality: o.output.quality,
          background: o.output.background,
          effort: o.output.effort === 'smallest' ? 'smallest' : undefined,
        },
      },
      ctx.signal,
      (f, note) => ctx.onProgress(0.3 + 0.7 * f, note),
    );
    return { ...result, format };
  });
  if (!r) {
    notes.push({ text: 'The original file is kept as it is.' });
    o.report?.({ id, name: file.name }, notes);
    return { name: o.claim?.(file.name) ?? file.name, blob: file };
  }
  notes.push(...sourceNotes(r));
  if (r.flattened) notes.push({ text: `Transparent areas were filled with ${o.output.background} (JPG has no transparency).` });
  o.report?.({ id, name: file.name }, notes);
  const name = replaceExtension(file.name, FORMAT_EXT[r.format]);
  return { name: o.claim?.(name) ?? name, blob: r.blob };
});

const PRESETS: { value: string; label: string; width: number; height: number; fit: Fit }[] = [
  { value: 'fhd', label: 'Full HD (1920 × 1080)', width: 1920, height: 1080, fit: 'inside' },
  { value: 'hd', label: 'HD (1280 × 720)', width: 1280, height: 720, fit: 'inside' },
  { value: '4k', label: '4K UHD (3840 × 2160)', width: 3840, height: 2160, fit: 'inside' },
  { value: 'square', label: 'Square post (1080 × 1080)', width: 1080, height: 1080, fit: 'cover' },
  { value: 'portrait', label: 'Portrait post (1080 × 1350)', width: 1080, height: 1350, fit: 'cover' },
  { value: 'story', label: 'Story (1080 × 1920)', width: 1080, height: 1920, fit: 'cover' },
  { value: 'og', label: 'Link preview (1200 × 630)', width: 1200, height: 630, fit: 'cover' },
  { value: 'thumb', label: 'Video thumbnail (1280 × 720)', width: 1280, height: 720, fit: 'cover' },
  { value: 'header', label: 'Banner (1500 × 500)', width: 1500, height: 500, fit: 'cover' },
];

const FITS: { value: Fit; label: string }[] = [
  { value: 'inside', label: 'Fit inside (keep the shape)' },
  { value: 'cover', label: 'Fill and crop the overflow' },
  { value: 'pad', label: 'Fit and pad to the exact size' },
  { value: 'stretch', label: 'Stretch to the exact size' },
];

export default function ResizeImage({ tool }: ToolProps) {
  const [mode, setMode] = useState<Mode>('percent');
  const [percent, setPercent] = useState(50);
  const [size, setSize] = useState({ width: 1920, height: 1080 });
  const [locked, setLocked] = useState(true);
  const [fit, setFit] = useState<Fit>('inside');
  const [longest, setLongest] = useState(1920);
  const [noEnlarge, setNoEnlarge] = useState(true);
  const [padColor, setPadColor] = useState('#ffffff');
  const [output, setOutput] = useState<OutputSettings>({ format: 'keep', quality: 0.9, background: '#ffffff' });
  const [preset, setPreset] = useState('custom');
  const notes = useRunNotes();
  const options = useMemo<Options>(
    () => ({
      mode,
      percent,
      width: size.width,
      height: size.height,
      locked,
      fit,
      longest,
      noEnlarge,
      padColor,
      output,
      report: notes.report,
      claim: notes.claim,
    }),
    [mode, percent, size, locked, fit, longest, noEnlarge, padColor, output, notes.report, notes.claim],
  );

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Resize"
      zipName="resized-images.zip"
      onRun={notes.clear}
      below={<RunNotes entries={notes.entries} />}
      validate={() =>
        !isHexColor(output.background) || (mode === 'pixels' && fit === 'pad' && !locked && padColor !== 'transparent' && !isHexColor(padColor))
          ? 'Enter colours as #rrggbb.'
          : null
      }
      optionsPanel={(wb) => (
        <ResizePanel
          first={wb.files[0]?.file ?? null}
          options={options}
          preset={preset}
          setPreset={(value) => {
            setPreset(value);
            const p = PRESETS.find((x) => x.value === value);
            if (!p) return;
            setMode('pixels');
            setSize({ width: p.width, height: p.height });
            setLocked(p.fit === 'inside');
            setFit(p.fit);
          }}
          setMode={setMode}
          setPercent={setPercent}
          setSize={(s) => {
            setPreset('custom');
            setSize(s);
          }}
          setLocked={setLocked}
          setFit={(f) => {
            setPreset('custom');
            setFit(f);
          }}
          setLongest={setLongest}
          setNoEnlarge={setNoEnlarge}
          setPadColor={setPadColor}
          setOutput={setOutput}
        />
      )}
    />
  );
}

function ResizePanel({
  first,
  options: o,
  preset,
  setPreset,
  setMode,
  setPercent,
  setSize,
  setLocked,
  setFit,
  setLongest,
  setNoEnlarge,
  setPadColor,
  setOutput,
}: {
  first: File | null;
  options: Options;
  preset: string;
  setPreset: (v: string) => void;
  setMode: (m: Mode) => void;
  setPercent: (n: number) => void;
  setSize: (s: { width: number; height: number }) => void;
  setLocked: (v: boolean) => void;
  setFit: (f: Fit) => void;
  setLongest: (n: number) => void;
  setNoEnlarge: (v: boolean) => void;
  setPadColor: (c: string) => void;
  setOutput: (o: OutputSettings) => void;
}) {
  const probe = useImageProbe(first);
  const W = probe?.width ?? 0;
  const H = probe?.height ?? 0;
  const aspect = W && H ? W / H : o.width / o.height;
  const spec = W && H ? plan(o, W, H) : null;
  const summary =
    first && W && H
      ? `${first.name}: ${W} × ${H} → ${spec ? `${spec.width} × ${spec.height}` : 'unchanged'}`
      : null;

  return (
    <>
      <OptionField label="Resize by">
        <Segmented
          label="Resize by"
          value={o.mode}
          options={[
            { value: 'percent', label: 'Percent' },
            { value: 'pixels', label: 'Pixels' },
            { value: 'longest', label: 'Longest side' },
          ]}
          onChange={setMode}
        />
      </OptionField>

      {o.mode === 'percent' ? (
        <NumberField id="rs-percent" label="Scale" value={o.percent} min={1} max={1000} unit="%" onCommit={setPercent} />
      ) : null}

      {o.mode === 'longest' ? (
        <NumberField
          id="rs-longest"
          label="Longest side"
          value={o.longest}
          min={1}
          max={MAX_SIDE}
          onCommit={setLongest}
        />
      ) : null}

      {o.mode === 'pixels' ? (
        <>
          <OptionField label="Preset" htmlFor="rs-preset">
            <OptionSelect
              id="rs-preset"
              value={preset}
              options={[{ value: 'custom', label: 'Custom size' }, ...PRESETS.map((p) => ({ value: p.value, label: p.label }))]}
              onChange={setPreset}
            />
          </OptionField>
          <DimensionInputs
            idPrefix="rs"
            width={o.width}
            height={o.height}
            aspect={aspect}
            locked={o.locked}
            onLockedChange={setLocked}
            onChange={setSize}
            max={MAX_SIDE}
          />
          {o.locked ? (
            <p className="-mt-2 text-[0.7rem]/relaxed text-muted-foreground">
              Locked to the first image’s shape. Other images fit inside the same box, keeping their own shape.
            </p>
          ) : (
            <OptionField label="When the shape differs" htmlFor="rs-fit">
              <OptionSelect id="rs-fit" value={o.fit} options={FITS} onChange={setFit} />
            </OptionField>
          )}
          {!o.locked && o.fit === 'pad' ? (
            <OptionField label="Padding" htmlFor="rs-pad" hint="Transparent padding needs PNG, WebP or AVIF; JPG uses the background colour.">
              <div className="flex flex-col gap-2">
                <Segmented
                  label="Padding"
                  value={o.padColor === 'transparent' ? 'transparent' : 'colour'}
                  options={[
                    { value: 'colour', label: 'Colour' },
                    { value: 'transparent', label: 'Transparent' },
                  ]}
                  onChange={(v) => setPadColor(v === 'transparent' ? 'transparent' : '#ffffff')}
                />
                {o.padColor !== 'transparent' ? <ColorField id="rs-pad" value={o.padColor} onChange={setPadColor} /> : null}
              </div>
            </OptionField>
          ) : null}
        </>
      ) : null}

      {o.mode !== 'pixels' || o.locked || o.fit === 'inside' ? (
        <SwitchField
          id="rs-no-enlarge"
          label="Don’t enlarge smaller images"
          checked={o.noEnlarge}
          onChange={setNoEnlarge}
        />
      ) : null}

      {summary ? <p className="font-mono text-[0.7rem] text-muted-foreground tabular-nums">{summary}</p> : null}

      <OutputOptions idPrefix="rs-out" value={o.output} onChange={setOutput} />

      <p className="text-[0.7rem]/relaxed text-muted-foreground">
        Resampled with Lanczos3 in linear light, so edges stay sharp and colours do not darken. EXIF data is removed
        and the orientation applied.
      </p>
    </>
  );
}
