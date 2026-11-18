'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { createJobLog } from '@/components/media/job-log';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { NumberInput } from '@/components/pdf-pages/fields';
import { OptionField, perFile } from '@/components/workbench';
import type { FramesRequest } from '@/engines/media';
import { baseName } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Mode = 'interval' | 'count';
type Options = { mode: Mode; every: number; count: number; format: FramesRequest['format']; maxWidth: number };

/** More than this many images in one go is rarely meant and costs a lot of memory. */
const MAX_FRAMES = 300;

/** Times in seconds: every `every` seconds from 0, or `count` evenly spaced (each in the middle of its slice). */
function times(o: Options, duration: number): number[] {
  if (!(duration > 0)) return [0];
  if (o.mode === 'count') {
    const n = Math.max(1, Math.min(MAX_FRAMES, Math.round(o.count)));
    return Array.from({ length: n }, (_, i) => (duration * (i + 0.5)) / n);
  }
  const step = Math.max(0.04, o.every);
  const out: number[] = [];
  for (let t = 0; t < duration - 1e-3 && out.length < MAX_FRAMES; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

function stamp(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${h ? `${h}h` : ''}${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s${String(r).padStart(3, '0')}`;
}

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const media = ctx.engines.media;
  const info = await media.inspect(input.file, ctx.signal);
  if (!info.video) throw new Error('This file has no video track.');
  const list = times(o, info.duration);
  const result = await media.frames(
    input.file,
    { times: list, format: o.format, quality: 0.9, maxWidth: o.maxWidth },
    { signal: ctx.signal, onProgress: ctx.onProgress },
  );
  const ext = result.frames[0]?.blob.type === 'image/png' ? 'png' : result.frames[0]?.blob.type === 'image/webp' ? 'webp' : 'jpg';
  const base = baseName(input.file.name);
  const outputs = result.frames.map((f) => ({ name: `${base}_${stamp(f.time)}.${ext}`, blob: f.blob }));
  const size = outputs.reduce((s, x) => s + x.blob.size, 0);
  const notes = [...result.report.notes, `${outputs.length} images, ${result.width}×${result.height}.`];
  if (o.mode === 'interval' && list.length === MAX_FRAMES) notes.push(`Stopped at ${MAX_FRAMES} images; use a longer interval for the rest of the video.`);
  if (outputs.length < list.length) notes.push(`${list.length - outputs.length} of the requested times had no frame (past the end of the video).`);
  log.push({ name: input.file.name, output: `${outputs.length} images`, size, report: { ...result.report, notes } });
  return outputs;
});

export default function VideoToFrames({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ mode: 'interval', every: 1, count: 12, format: 'jpeg', maxWidth: 0 });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel="Extract frames"
      zipName="frames.zip"
      optionsPanel={
        <>
          <OptionField label="Take">
            <Segmented
              label="Take"
              value={options.mode}
              options={[
                { value: 'interval', label: 'Every N seconds' },
                { value: 'count', label: 'N frames in total' },
              ]}
              onChange={(v) => set('mode', v)}
            />
          </OptionField>
          {options.mode === 'interval' ? (
            <OptionField label="Every" htmlFor="vf-every" hint={`From the start. At most ${MAX_FRAMES} images per video.`}>
              <NumberInput id="vf-every" value={options.every} onChange={(v) => set('every', v)} min={0.04} max={3600} decimals suffix="s" />
            </OptionField>
          ) : (
            <OptionField label="Frames" htmlFor="vf-count" hint="Spread evenly over the whole video.">
              <NumberInput id="vf-count" value={options.count} onChange={(v) => set('count', v)} min={1} max={MAX_FRAMES} suffix="images" />
            </OptionField>
          )}
          <OptionField label="Format" hint="PNG is lossless and large; JPEG and WebP are much smaller.">
            <Segmented
              label="Image format"
              value={options.format}
              options={[
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
                { value: 'webp', label: 'WebP' },
              ]}
              onChange={(v) => set('format', v)}
            />
          </OptionField>
          <OptionField label="Width" hint="Never upscaled; the height follows.">
            <Segmented
              label="Image width"
              value={options.maxWidth}
              options={[
                { value: 0, label: 'Original' },
                { value: 1920, label: '1920' },
                { value: 1280, label: '1280' },
                { value: 640, label: '640' },
              ]}
              onChange={(v) => set('maxWidth', v)}
            />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Each image is the frame on screen at that moment, upright as the video plays. Formats your browser cannot decode
            (AVI, WMV, FLV…) are read by the software engine.
          </p>
        </>
      }
    />
  );
}
