'use client';

import {
  FlipHorizontalIcon,
  FlipVerticalIcon,
  RefreshIcon,
  RotateLeft01Icon,
  RotateRight01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CropCanvas,
  centredRect,
  ImageWorkbench,
  isHexColor,
  type NameClaimer,
  type Note,
  type NormRect,
  NumberField,
  OutputOptions,
  type OutputSettings,
  type Reporter,
  resolveOutput,
  RunNotes,
  sourceNotes,
  useImagePreview,
  useRunNotes,
  withDecodeFallback,
} from '@/components/image';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import { FORMAT_EXT } from '@/engines/image';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Turn = 0 | 90 | 180 | 270;
/**
 * One crop for every image. `rect` is in fractions of the image it was drawn
 * on, whose size (after the rotation) is `ref`; other images get the same
 * area relative to their own size (see `rectFor`). `ref` is null until the
 * first image has loaded.
 */
type Geometry = {
  rotate: Turn;
  flipHorizontal: boolean;
  flipVertical: boolean;
  rect: NormRect;
  ref: { w: number; h: number } | null;
};
/** Displayed size (orientation applied, before the tool's rotation) of the image on the stage. */
type Dims = { fileKey: string; W: number; H: number };

type Options = { geometry: Geometry; ratio: string; output: OutputSettings; report?: Reporter; claim?: NameClaimer };

const FULL: NormRect = { x: 0, y: 0, width: 1, height: 1 };
const FRESH: Geometry = { rotate: 0, flipHorizontal: false, flipVertical: false, rect: FULL, ref: null };
const keyOf = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
const turned = (w: number, h: number, r: Turn) => (r === 90 || r === 270 ? { w: h, h: w } : { w, h });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const RATIOS: { value: string; label: string; ratio: number | null | 'original' }[] = [
  { value: 'free', label: 'Free', ratio: null },
  { value: 'original', label: 'Original shape', ratio: 'original' },
  { value: '1:1', label: 'Square (1:1)', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '2:3', label: '2:3', ratio: 2 / 3 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '4:5', label: '4:5 (portrait post)', ratio: 4 / 5 },
  { value: '5:4', label: '5:4', ratio: 5 / 4 },
  { value: '1.91:1', label: '1.91:1 (link preview)', ratio: 1.91 },
  { value: '3:1', label: '3:1 (banner)', ratio: 3 },
];

/** The ratio's width/height for an image shaped w×h (after rotation), or null for free. */
function ratioValue(value: string, w: number, h: number): number | null {
  const r = RATIOS.find((x) => x.value === value)?.ratio ?? null;
  return r === 'original' ? w / h : r;
}

/** The largest centred box at `value` for a W×H image under `g`'s rotation (the whole image when free). */
function recentre(value: string, g: Geometry, W: number, H: number): Geometry {
  const { w, h } = turned(W, H, g.rotate);
  return { ...g, rect: centredRect(ratioValue(value, w, h), w / h), ref: { w, h } };
}

/**
 * The crop for an image shaped w×h (after rotation). Free and "original
 * shape" crops take the same fractions of every image. A fixed aspect ratio
 * stays exact: the box has that ratio, the same size relative to the largest
 * box of that ratio, and the same centre (moved inside the image if needed).
 */
function rectFor(g: Geometry, ratio: string, w: number, h: number): NormRect {
  const aspect = ratioValue(ratio, w, h);
  if (!g.ref || !aspect || ratio === 'original' || Math.abs(g.ref.w / g.ref.h - w / h) < 1e-6) return g.rect;
  const refBig = centredRect(aspect, g.ref.w / g.ref.h);
  const big = centredRect(aspect, w / h);
  const s = clamp(g.rect.width / refBig.width, 0, 1);
  const width = big.width * s;
  const height = big.height * s;
  const cx = g.rect.x + g.rect.width / 2;
  const cy = g.rect.y + g.rect.height / 2;
  return { x: clamp(cx - width / 2, 0, 1 - width), y: clamp(cy - height / 2, 0, 1 - height), width, height };
}

/** The crop in pixels of the rotated image (whole pixels, inside the image). */
function pixelRect(rect: NormRect, W: number, H: number) {
  const x = Math.max(0, Math.min(W - 1, Math.round(rect.x * W)));
  const y = Math.max(0, Math.min(H - 1, Math.round(rect.y * H)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(W - x, Math.round(rect.width * W))),
    height: Math.max(1, Math.min(H - y, Math.round(rect.height * H))),
  };
}

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  const { image } = ctx.engines;
  const g = o.geometry;
  const r = await withDecodeFallback(file, ctx, async (src) => {
    const probe = await image.probe(src, ctx.signal);
    const dims = probe.width && probe.height ? probe : await image.dimensions(src, ctx.signal);
    const { w, h } = turned(dims.width, dims.height, g.rotate);
    const format = resolveOutput(o.output.format, probe.format);
    ctx.onProgress(0.3, 'Cropping');
    const result = await image.process(
      src,
      {
        rotate: g.rotate,
        flipHorizontal: g.flipHorizontal,
        flipVertical: g.flipVertical,
        crop: pixelRect(rectFor(g, o.ratio, w, h), w, h),
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
  const notes: Note[] = [{ text: `Saved at ${r.width} × ${r.height}.` }, ...sourceNotes(r)];
  if (r.flattened) notes.push({ text: `Transparent areas were filled with ${o.output.background} (JPG has no transparency).` });
  o.report?.({ id, name: file.name }, notes);
  const name = `${baseName(file.name)}-cropped.${FORMAT_EXT[r.format]}`;
  return { name: o.claim?.(name) ?? name, blob: r.blob };
});

export default function CropImage({ tool }: ToolProps) {
  const [geometry, setGeometry] = useState<Geometry>(FRESH);
  const [dims, setDims] = useState<Dims | null>(null);
  const [ratio, setRatio] = useState('free');
  const [pick, setPick] = useState(0);
  const [output, setOutput] = useState<OutputSettings>({ format: 'keep', quality: 0.92, background: '#ffffff' });
  const notes = useRunNotes();
  const options = useMemo<Options>(
    () => ({ geometry, ratio, output, report: notes.report, claim: notes.claim }),
    [geometry, ratio, output, notes.report, notes.claim],
  );

  // The stage reports its image's size once the preview loads; the first image sets up the crop.
  const onReady = useCallback(
    (fileKey: string, W: number, H: number) => {
      setDims((d) => (d?.fileKey === fileKey && d.W === W && d.H === H ? d : { fileKey, W, H }));
      setGeometry((g) => (g.ref ? g : recentre(ratio, FRESH, W, H)));
    },
    [ratio],
  );
  const reset = useCallback(() => setGeometry(FRESH), []);

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Crop"
      zipName="cropped-images.zip"
      onRun={notes.clear}
      below={<RunNotes entries={notes.entries} />}
      validate={(files) =>
        !isHexColor(output.background)
          ? 'Enter a background colour as #rrggbb.'
          : files.length && !geometry.ref
            ? 'Loading the image…'
            : null
      }
      preview={(wb) => {
        const files = wb.files.map((f) => f.file);
        const index = Math.min(pick, files.length - 1);
        const file = files[index];
        return file ? (
          <CropStage
            file={file}
            files={files}
            index={index}
            onPick={setPick}
            geometry={geometry}
            ratio={ratio}
            onReady={onReady}
            onGeometry={setGeometry}
            disabled={wb.running}
          />
        ) : null;
      }}
      optionsPanel={(wb) => {
        const file = wb.files[Math.min(pick, wb.files.length - 1)]?.file ?? null;
        const d = file && dims?.fileKey === keyOf(file) ? dims : null;
        return (
          <>
            <ResetWhenEmpty count={wb.files.length} onEmpty={reset} />
            <OptionField label="Aspect ratio" htmlFor="cr-ratio">
              <OptionSelect
                id="cr-ratio"
                value={ratio}
                options={RATIOS.map((r) => ({ value: r.value, label: r.label }))}
                onChange={(v) => {
                  setRatio(v);
                  if (d && geometry.ref && v !== 'free') setGeometry(recentre(v, geometry, d.W, d.H));
                }}
              />
            </OptionField>
            {d && geometry.ref ? (
              <CropNumbers dims={d} geometry={geometry} ratio={ratio} onGeometry={setGeometry} />
            ) : null}
            {wb.files.length > 1 ? (
              <p className="text-[0.7rem]/relaxed text-muted-foreground">
                The crop applies to every image, as the same area relative to each image’s size. With a fixed aspect
                ratio, each image gets a box of exactly that ratio at the same place and relative size.
              </p>
            ) : null}
            <OutputOptions idPrefix="cr-out" value={output} onChange={setOutput} />
            <p className="text-[0.7rem]/relaxed text-muted-foreground">
              Rotating and flipping are exact. The image is re-encoded once at the chosen quality; EXIF data is removed
              and the orientation applied.
            </p>
          </>
        );
      }}
    />
  );
}

/** Starts the crop over once every file has been removed. */
function ResetWhenEmpty({ count, onEmpty }: { count: number; onEmpty: () => void }) {
  useEffect(() => {
    if (count === 0) onEmpty();
  }, [count, onEmpty]);
  return null;
}

function CropStage({
  file,
  files,
  index,
  onPick,
  geometry: g,
  ratio,
  onReady,
  onGeometry,
  disabled,
}: {
  file: File;
  files: File[];
  index: number;
  onPick: (i: number) => void;
  geometry: Geometry;
  ratio: string;
  onReady: (fileKey: string, W: number, H: number) => void;
  onGeometry: (g: Geometry) => void;
  disabled: boolean;
}) {
  const { preview, error } = useImagePreview(file);
  const W = preview?.width ?? 0;
  const H = preview?.height ?? 0;
  const key = keyOf(file);
  useEffect(() => {
    if (W && H) onReady(key, W, H);
  }, [key, W, H, onReady]);
  const { w, h } = turned(W, H, g.rotate);
  const aspect = W && H ? ratioValue(ratio, w, h) : null;
  const rect = W && H ? rectFor(g, ratio, w, h) : g.rect;
  // Edits are made on this image, which becomes the crop's reference.
  const set = (next: Omit<Geometry, 'ref'>) => onGeometry({ ...next, ref: turned(W, H, next.rotate) });
  const px = W && H ? pixelRect(rect, w, h) : null;
  const ready = !!W && !!g.ref;

  const turn = (by: 90 | -90) =>
    onGeometry(recentre(ratio, { ...g, rotate: ((((g.rotate + by) % 360) + 360) % 360) as Turn }, W, H));
  const tool = (label: string, icon: typeof RefreshIcon, onClick: () => void, pressed?: boolean) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled || !ready}
      onClick={onClick}
      className={pressed ? 'text-primary' : undefined}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} />
    </Button>
  );

  return (
    <SectionCard
      title="Crop"
      description={
        px ? (
          <span className="font-mono tabular-nums">
            {px.width} × {px.height} px at {px.x}, {px.y} · of {w} × {h}
          </span>
        ) : (
          'Drag the box or its handles; drag outside it to draw a new one.'
        )
      }
      action={
        <div className="flex items-center gap-0.5">
          {tool('Rotate left', RotateLeft01Icon, () => turn(-90))}
          {tool('Rotate right', RotateRight01Icon, () => turn(90))}
          {tool(
            'Flip horizontally',
            FlipHorizontalIcon,
            () => set({ ...g, flipHorizontal: !g.flipHorizontal, rect: { ...rect, x: 1 - rect.x - rect.width } }),
            g.flipHorizontal,
          )}
          {tool(
            'Flip vertically',
            FlipVerticalIcon,
            () => set({ ...g, flipVertical: !g.flipVertical, rect: { ...rect, y: 1 - rect.y - rect.height } }),
            g.flipVertical,
          )}
          {tool('Reset', RefreshIcon, () => onGeometry(recentre(ratio, FRESH, W, H)))}
        </div>
      }
      contentClassName="flex flex-col gap-3"
    >
      {files.length > 1 ? (
        <OptionSelect
          id="cr-preview-file"
          value={String(index)}
          options={files.map((f, i) => ({ value: String(i), label: f.name }))}
          onChange={(v) => onPick(Number(v))}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs/relaxed text-destructive">
          {error}
        </p>
      ) : preview ? (
        <fieldset disabled={disabled} className="min-w-0">
          <CropCanvas
            src={preview.url}
            width={w}
            height={h}
            rect={rect}
            aspect={aspect}
            rotate={g.rotate}
            flipHorizontal={g.flipHorizontal}
            flipVertical={g.flipVertical}
            onChange={(next) => set({ ...g, rect: next })}
          />
        </fieldset>
      ) : (
        <div className="aspect-video animate-pulse rounded-lg border bg-muted" />
      )}
    </SectionCard>
  );
}

/** Exact crop size and position in pixels, on the image shown on the stage. */
function CropNumbers({
  dims,
  geometry: g,
  ratio,
  onGeometry,
}: {
  dims: Dims;
  geometry: Geometry;
  ratio: string;
  onGeometry: (g: Geometry) => void;
}) {
  const { w, h } = turned(dims.W, dims.H, g.rotate);
  const px = pixelRect(rectFor(g, ratio, w, h), w, h);
  const aspect = ratioValue(ratio, w, h);
  const commit = (next: { x: number; y: number; width: number; height: number }) => {
    const width = Math.min(next.width, w);
    const height = Math.min(next.height, h);
    const x = Math.min(Math.max(0, next.x), w - width);
    const y = Math.min(Math.max(0, next.y), h - height);
    onGeometry({ ...g, rect: { x: x / w, y: y / h, width: width / w, height: height / h }, ref: { w, h } });
  };
  const fitAspect = (width: number, height: number, lead: 'w' | 'h') => {
    if (!aspect) return { width, height };
    let nw = lead === 'w' ? width : Math.round(height * aspect);
    let nh = lead === 'w' ? Math.round(width / aspect) : height;
    if (nw > w) {
      nw = w;
      nh = Math.round(w / aspect);
    }
    if (nh > h) {
      nh = h;
      nw = Math.round(h * aspect);
    }
    return { width: nw, height: nh };
  };
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-3">
      <NumberField
        id="cr-w"
        label="Width"
        value={px.width}
        min={1}
        max={w}
        onCommit={(v) => commit({ ...px, ...fitAspect(v, px.height, 'w') })}
      />
      <NumberField
        id="cr-h"
        label="Height"
        value={px.height}
        min={1}
        max={h}
        onCommit={(v) => commit({ ...px, ...fitAspect(px.width, v, 'h') })}
      />
      <NumberField id="cr-x" label="Left" value={px.x} min={0} max={w - 1} onCommit={(v) => commit({ ...px, x: v })} />
      <NumberField id="cr-y" label="Top" value={px.y} min={0} max={h - 1} onCommit={(v) => commit({ ...px, y: v })} />
    </div>
  );
}
