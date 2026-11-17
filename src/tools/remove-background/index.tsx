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
import { decodeToImageData, parseHex } from '@/lib/ai/pixels';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Format = 'png' | 'webp';
type Fill = 'transparent' | 'colour';
type Report = { notes: ResultNote[]; width: number; height: number };

type Options = {
  spec: ModelSpec;
  device: Device | null;
  format: Format;
  fill: Fill;
  colour: string;
  onReport: (id: string, r: Report) => void;
};

const job = perFile<Options>(async (input, o, ctx) => {
  if (!o.device) throw new Error('This device cannot run the background model.');
  ctx.onProgress(0.05, 'Decoding');
  const image = await decodeToImageData(input.file, ctx.engines, ctx.signal);
  ctx.onProgress(0.15, 'Finding the subject');
  const started = performance.now();
  const mask = await localAi.segment(o.spec, image, { device: o.device, signal: ctx.signal });
  const secs = (performance.now() - started) / 1000;
  ctx.onProgress(0.85, 'Cutting out');
  const d = image.data;
  const [br, bg, bb] = parseHex(o.colour);
  let kept = 0;
  for (let i = 0; i < mask.length; i++) {
    const a = ((mask[i] ?? 0) * (d[i * 4 + 3] ?? 255)) / 255;
    if (a > 127) kept += 1;
    if (o.fill === 'colour') {
      const t = a / 255;
      d[i * 4] = Math.round((d[i * 4] ?? 0) * t + br * (1 - t));
      d[i * 4 + 1] = Math.round((d[i * 4 + 1] ?? 0) * t + bg * (1 - t));
      d[i * 4 + 2] = Math.round((d[i * 4 + 2] ?? 0) * t + bb * (1 - t));
      d[i * 4 + 3] = 255;
    } else d[i * 4 + 3] = Math.round(a);
  }
  const blob = await ctx.engines.image.encodePixels(
    image,
    o.format === 'webp' ? { format: 'webp', lossless: true } : { format: 'png' },
    ctx.signal,
  );
  const share = kept / Math.max(1, mask.length);
  const notes: ResultNote[] = [
    { kind: 'ok', text: `${image.width} × ${image.height} · subject covers ${(share * 100).toFixed(0)}% of the image · ${secs.toFixed(1)} s` },
  ];
  if (share < 0.01) notes.push({ kind: 'warn', text: 'Almost nothing was kept: the model found no clear subject. Try the other model.' });
  if (share > 0.97) notes.push({ kind: 'warn', text: 'Almost everything was kept: the model could not separate a background.' });
  o.onReport(input.id, { notes, width: image.width, height: image.height });
  return { name: `${baseName(input.file.name)}-cutout.${o.format}`, blob };
});

export default function RemoveBackground({ tool }: ToolProps) {
  const [format, setFormat] = useState<Format>('png');
  const [fill, setFill] = useState<Fill>('transparent');
  const [colour, setColour] = useState('#ffffff');
  const [reports, setReports] = useState<Record<string, Report>>({});
  const model = useLocalModel('segment', 'ormbg', 'remove-background');
  const device = model.plan && model.plan.device ? model.plan.device : null;
  const onReport = useCallback((id: string, r: Report) => setReports((p) => ({ ...p, [id]: r })), []);
  const options = useMemo<Options>(
    () => ({ spec: model.spec, device, format, fill, colour, onReport }),
    [model.spec, device, format, fill, colour, onReport],
  );
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
    model.status === 'ready'
      ? null
      : model.status === 'unsupported'
        ? 'This device cannot run the selected model.'
        : 'Download the model first.';

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Remove background"
      disabledReason={wb.files.length === 0 ? undefined : blocked}
      optionsPanel={
        <>
          <ModelGate model={model} id="rb-model" />
          <OptionField label="Background">
            <Segmented<Fill>
              label="Background"
              value={fill}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'colour', label: 'Colour' },
              ]}
              onChange={setFill}
            />
          </OptionField>
          {fill === 'colour' ? (
            <OptionField label="Colour" htmlFor="rb-colour">
              <input
                id="rb-colour"
                type="color"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                className="h-8 w-16 cursor-pointer rounded border bg-transparent"
              />
            </OptionField>
          ) : null}
          <OptionField label="Format" hint="Both keep full quality and transparency.">
            <Segmented<Format>
              label="Format"
              value={format}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'webp', label: 'WebP (lossless)' },
              ]}
              onChange={setFormat}
            />
          </OptionField>
        </>
      }
    >
      <ResultRows
        results={wb.results}
        zipName="cutouts.zip"
        notesFor={(r) => (r.sourceId ? (reports[r.sourceId]?.notes ?? []) : [])}
      />
      {last && report && before && before.file === source ? (
        <SectionCard title="Before and after" description={last.name}>
          <CompareSlider
            before={before.url}
            after={last.url}
            width={report.width}
            height={report.height}
            className="bg-[repeating-conic-gradient(#8883_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
          />
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
