'use client';

import { Loading03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMemo, useState } from 'react';
import {
  ColorField,
  CompareSlider,
  ImageWorkbench,
  isHexColor,
  type NameClaimer,
  type Note,
  NumberField,
  type Reporter,
  RunNotes,
  sourceNotes,
  useImagePreview,
  useRunNotes,
  withDecodeFallback,
} from '@/components/image';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect, perFile, QualitySlider } from '@/components/workbench';
import {
  type CompressFormat,
  type CompressOptions,
  type CompressResult,
  FORMAT_EXT,
  FORMAT_LABEL,
} from '@/engines/image';
import { formatBytes, replaceExtension } from '@/lib/files';
import type { ToolProps } from '@/tools/types';
import { useCompressPreview } from './use-compress-preview';

type FormatChoice = 'keep' | 'auto' | CompressFormat;
type Mode = 'quality' | 'size';

type Options = {
  format: FormatChoice;
  mode: Mode;
  quality: number;
  targetKb: number;
  maxSide: number;
  background: string;
  report?: Reporter;
  claim?: NameClaimer;
};

function engineOptions(o: Options): CompressOptions {
  const format = o.format;
  return {
    format,
    quality: o.mode === 'quality' ? o.quality : undefined,
    targetBytes: o.mode === 'size' && format !== 'png' ? Math.max(1, Math.round(o.targetKb * 1024)) : undefined,
    maxSide: o.maxSide || undefined,
    background: o.background,
  };
}

const pct = (from: number, to: number) => Math.round((1 - to / from) * 100);

function describe(r: CompressResult): string {
  const q =
    r.format === 'gif' ? '' : r.quality !== undefined ? ` at ${Math.round(r.quality * 100)}% quality` : ' (lossless)';
  const frames = r.animationKept && r.frames ? `, ${r.frames} frames` : '';
  return `${FORMAT_LABEL[r.format]}${q}, ${r.width} × ${r.height}${frames}`;
}

const job = perFile<Options>(async ({ id, file }, o, ctx) => {
  ctx.onProgress(0.2, 'Compressing');
  const r = await withDecodeFallback(file, ctx, (src) =>
    ctx.engines.image.compress(src, engineOptions(o), ctx.signal, { onProgress: (f, note) => ctx.onProgress(0.2 + 0.8 * f, note) }),
  );
  const notes: Note[] = [];
  if (r.blob.size >= file.size) {
    notes.push({
      text: `The compressed version (${formatBytes(r.blob.size)}) was not smaller than the original (${formatBytes(file.size)}), so the original was kept unchanged.`,
      tone: 'warn',
    });
    o.report?.({ id, name: file.name }, notes);
    return { name: o.claim?.(file.name) ?? file.name, blob: file };
  }
  notes.push({
    text: `${formatBytes(file.size)} → ${formatBytes(r.blob.size)} (${pct(file.size, r.blob.size)}% smaller) as ${describe(r)}.`,
  });
  if (r.reachedTarget === false) {
    notes.push({ text: 'Even the lowest quality is larger than the target size; this is the smallest result.', tone: 'warn' });
  }
  if (r.flattened) notes.push({ text: `Transparent areas were filled with ${o.background} (JPG has no transparency).` });
  notes.push(...sourceNotes(r));
  o.report?.({ id, name: file.name }, notes);
  const name = replaceExtension(file.name, FORMAT_EXT[r.format]);
  return { name: o.claim?.(name) ?? name, blob: r.blob };
});

const FORMATS: { value: FormatChoice; label: string }[] = [
  { value: 'keep', label: 'Keep the format' },
  { value: 'auto', label: 'Smallest (JPG, WebP or PNG)' },
  { value: 'jpeg', label: 'JPG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'png', label: 'PNG (lossless)' },
];
const SIDES = [
  { value: '0', label: 'Keep the dimensions' },
  { value: '3840', label: 'At most 3840 px' },
  { value: '2560', label: 'At most 2560 px' },
  { value: '1920', label: 'At most 1920 px' },
  { value: '1280', label: 'At most 1280 px' },
  { value: '1024', label: 'At most 1024 px' },
];

function Preview({ files, options }: { files: File[]; options: Options }) {
  const [pick, setPick] = useState(0);
  const index = Math.min(pick, files.length - 1);
  const file = files[index] ?? null;
  const original = useImagePreview(file);
  const engineOpts = useMemo(() => engineOptions(options), [options]);
  const { preview, exact, error, updating, exactPending } = useCompressPreview(file, engineOpts);
  const result = exact?.result;
  const bigger = !!(result && file && result.blob.size >= file.size);

  return (
    <SectionCard
      title="Preview"
      description={
        result && file ? (
          <span className="font-mono tabular-nums">
            {formatBytes(file.size)} → {formatBytes(result.blob.size)}{' '}
            {bigger ? '(not smaller: the original will be kept)' : `(−${pct(file.size, result.blob.size)}%)`} ·{' '}
            {describe(result)}
          </span>
        ) : file && preview ? (
          'Working out the exact size…'
        ) : (
          'The result at the current settings, before and after.'
        )
      }
      action={
        updating || exactPending ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-3.5 animate-spin" />
            {updating ? 'Updating' : 'Measuring'}
          </span>
        ) : null
      }
      contentClassName="flex flex-col gap-3"
    >
      {files.length > 1 ? (
        <OptionSelect
          id="cmp-preview-file"
          value={String(index)}
          options={files.map((f, i) => ({ value: String(i), label: f.name }))}
          onChange={(v) => setPick(Number(v))}
        />
      ) : null}
      {original.error || error ? (
        <p role="alert" className="text-xs/relaxed text-destructive">
          {original.error ?? error}
        </p>
      ) : original.preview ? (
        <CompareSlider
          before={original.preview.url}
          after={preview?.url ?? null}
          width={original.preview.width}
          height={original.preview.height}
          afterLabel="Compressed"
        />
      ) : (
        <div className="aspect-video animate-pulse rounded-lg border bg-muted" />
      )}
    </SectionCard>
  );
}

export default function CompressImage({ tool }: ToolProps) {
  const [format, setFormat] = useState<FormatChoice>('keep');
  const [mode, setMode] = useState<Mode>('quality');
  const [quality, setQuality] = useState(0.75);
  const [targetKb, setTargetKb] = useState(200);
  const [maxSide, setMaxSide] = useState(0);
  const [background, setBackground] = useState('#ffffff');
  const notes = useRunNotes();
  const base = useMemo(
    () => ({ format, mode, quality, targetKb, maxSide, background }),
    [format, mode, quality, targetKb, maxSide, background],
  );
  const options = useMemo<Options>(() => ({ ...base, report: notes.report, claim: notes.claim }), [base, notes.report, notes.claim]);

  return (
    <ImageWorkbench
      job={job}
      options={options}
      accept={tool.accept}
      runLabel="Compress"
      zipName="compressed-images.zip"
      onRun={notes.clear}
      validate={() => (format === 'jpeg' && !isHexColor(background) ? 'Enter a background colour as #rrggbb.' : null)}
      preview={(wb) => (
        <Preview files={wb.files.map((f) => f.file)} options={base} />
      )}
      below={<RunNotes entries={notes.entries} title="Savings" />}
      optionsPanel={
        <>
          <OptionField
            label="Format"
            htmlFor="cmp-format"
            hint={
              format === 'keep'
                ? 'JPG, WebP, AVIF and PNG stay as they are; HEIC becomes JPG; BMP, TIFF and still GIFs become PNG. Animated GIF, WebP and PNG stay animated (a GIF’s colours follow the quality).'
                : format === 'auto'
                  ? 'Tries JPG and WebP (and PNG for screenshots, graphics and transparent images) and keeps the smallest. Animations become animated WebP or GIF, whichever is smaller.'
                  : format === 'jpeg' || format === 'avif'
                    ? 'Animated images keep only their first frame in this format.'
                    : undefined
            }
          >
            <OptionSelect id="cmp-format" value={format} options={FORMATS} onChange={setFormat} />
          </OptionField>
          {format !== 'png' ? (
            <OptionField label="Aim for">
              <Segmented
                label="Aim for"
                value={mode}
                options={[
                  { value: 'quality', label: 'Quality' },
                  { value: 'size', label: 'File size' },
                ]}
                onChange={setMode}
              />
            </OptionField>
          ) : null}
          {format !== 'png' && mode === 'quality' ? (
            <OptionField
              label="Quality"
              htmlFor="cmp-quality"
              hint="70–80% is hard to tell from the original for most photos. PNG files are optimised losslessly."
            >
              <QualitySlider id="cmp-quality" value={quality} onChange={setQuality} />
            </OptionField>
          ) : null}
          {format !== 'png' && mode === 'size' ? (
            <OptionField
              label="Target size"
              hint="The highest quality that fits. PNG files are optimised losslessly and cannot be aimed at a size."
            >
              <NumberField id="cmp-target" label="At most" value={targetKb} min={1} max={100000} unit="KB" onCommit={setTargetKb} />
            </OptionField>
          ) : null}
          <OptionField label="Dimensions" htmlFor="cmp-max">
            <OptionSelect id="cmp-max" value={String(maxSide)} options={SIDES} onChange={(v) => setMaxSide(Number(v))} />
          </OptionField>
          {format === 'jpeg' ? (
            <OptionField label="Background" htmlFor="cmp-bg" hint="JPG has no transparency; transparent areas get this colour.">
              <ColorField id="cmp-bg" value={background} onChange={setBackground} />
            </OptionField>
          ) : null}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            A file is never made bigger: if compressing does not help, the original is kept. EXIF data (camera, GPS) is
            removed and the orientation applied; colour profiles such as Display P3 are kept (AVIF is converted to sRGB).
          </p>
        </>
      }
    />
  );
}
