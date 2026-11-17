'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModelGate } from '@/components/ai/model-gate';
import { useLocalModel } from '@/components/ai/use-local-model';
import { CompareSlider } from '@/components/image';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { type ResultNote, ResultRows, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { type Device, localAi, type ModelSpec } from '@/engines/ai';
import { decodeToImageData } from '@/lib/ai/pixels';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Format = 'png' | 'jpeg' | 'webp';
type Report = { notes: ResultNote[]; width: number; height: number };

/** Output size limit, in pixels (an RGBA buffer of 4 bytes per pixel is held in memory). */
const MAX_OUTPUT = 48_000_000;
const TILE = 128;

type Options = {
  spec: ModelSpec;
  device: Device | null;
  format: Format;
  onReport: (id: string, r: Report) => void;
};

const job = perFile<Options>(async (input, o, ctx) => {
  if (!o.device) throw new Error('This device cannot run the upscaling model.');
  const scale = o.spec.scale ?? 2;
  ctx.onProgress(0.02, 'Decoding');
  const image = await decodeToImageData(input.file, ctx.engines, ctx.signal);
  const outPixels = image.width * image.height * scale * scale;
  if (outPixels > MAX_OUTPUT) {
    const maxSide = Math.floor(Math.sqrt(MAX_OUTPUT / (scale * scale) / ((image.width / image.height) || 1)));
    throw new Error(
      `${image.width} × ${image.height} at ${scale}× would be ${Math.round(outPixels / 1e6)} megapixels; the limit is ${MAX_OUTPUT / 1e6}. Use a smaller image (about ${Math.round(maxSide * (image.width / image.height))} × ${maxSide}) or the 2× model.`,
    );
  }
  const started = performance.now();
  const out = await localAi.upscale(o.spec, image, {
    device: o.device,
    signal: ctx.signal,
    tile: TILE,
    onTile: (done, total) => ctx.onProgress(0.05 + 0.85 * (done / total), `Tile ${done} of ${total}`),
  });
  const secs = (performance.now() - started) / 1000;
  ctx.onProgress(0.92, 'Encoding');
  const blob = await ctx.engines.image.encodePixels(
    new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height),
    o.format === 'png' ? { format: 'png' } : { format: o.format, quality: 0.92 },
    ctx.signal,
  );
  o.onReport(input.id, {
    notes: [{ kind: 'ok', text: `${image.width} × ${image.height} → ${out.width} × ${out.height} · ${secs.toFixed(1)} s` }],
    width: out.width,
    height: out.height,
  });
  return { name: `${baseName(input.file.name)}-${scale}x.${o.format === 'jpeg' ? 'jpg' : o.format}`, blob };
});

export default function UpscaleImage({ tool }: ToolProps) {
  const [format, setFormat] = useState<Format>('png');
  const [reports, setReports] = useState<Record<string, Report>>({});
  const model = useLocalModel('upscale', 'swin2sr-x2-light', 'upscale-image');
  const device = model.plan && model.plan.device ? model.plan.device : null;
  const onReport = useCallback((id: string, r: Report) => setReports((p) => ({ ...p, [id]: r })), []);
  const options = useMemo<Options>(() => ({ spec: model.spec, device, format, onReport }), [model.spec, device, format, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept });

  const last = wb.results.at(-1);
  const source = last?.sourceId ? wb.files.find((f) => f.id === last.sourceId)?.file : undefined;
  const [before, setBefore] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!source) return;
    const url = URL.createObjectURL(source);
    const id = requestAnimationFrame(() => setBefore({ file: source, url }));
    return () => {
      cancelAnimationFrame(id);
      URL.revokeObjectURL(url);
    };
  }, [source]);
  const report = last?.sourceId ? reports[last.sourceId] : undefined;

  const blocked =
    model.status === 'ready' ? null : model.status === 'unsupported' ? 'This device cannot run the selected model.' : 'Download the model first.';

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel={`Upscale ${model.spec.scale ?? 2}×`}
      disabledReason={wb.files.length === 0 ? undefined : blocked}
      optionsPanel={
        <>
          <ModelGate model={model} id="up-model" />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Processed in {TILE}-pixel tiles, each run with 16 pixels of its neighbours, so large images do not run out of memory and tiles
            join without seams. {device === 'wasm' ? 'Without WebGPU this takes roughly a second or more per tile.' : ''}
          </p>
          <OptionField label="Format">
            <Segmented<Format>
              label="Format"
              value={format}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'webp', label: 'WebP' },
              ]}
              onChange={setFormat}
            />
          </OptionField>
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName="upscaled.zip"
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId]?.notes ?? []) : [])}
      />
      {last && report && before && before.file === source ? (
        <SectionCard title="Before and after" description={last.name}>
          <CompareSlider before={before.url} after={last.url} width={report.width} height={report.height} />
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
