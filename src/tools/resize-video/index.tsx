'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { NumberInput } from '@/components/pdf-pages/fields';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import type { Container } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Preset = 'vertical' | 'square' | 'portrait' | 'landscape' | 'custom';
type Options = { preset: Preset; width: number; height: number; fit: 'cover' | 'contain'; short: 1080 | 720 };

const PRESETS: { value: Preset; label: string; ratio: [number, number]; hint: string }[] = [
  { value: 'vertical', label: '9:16 vertical', ratio: [9, 16], hint: 'Reels, TikTok, Shorts, Stories' },
  { value: 'square', label: '1:1 square', ratio: [1, 1], hint: 'Feed posts' },
  { value: 'portrait', label: '4:5 portrait', ratio: [4, 5], hint: 'Instagram and Facebook feed' },
  { value: 'landscape', label: '16:9 landscape', ratio: [16, 9], hint: 'YouTube, X, LinkedIn' },
  { value: 'custom', label: 'Custom size', ratio: [0, 0], hint: 'Any width and height' },
];

/** Output frame in pixels: the preset's shape with its short side at 1080 or 720. */
function frameSize(o: Options): { width: number; height: number } {
  const p = PRESETS.find((x) => x.value === o.preset)!;
  if (o.preset === 'custom') return { width: Math.round(o.width / 2) * 2, height: Math.round(o.height / 2) * 2 };
  const [a, b] = p.ratio;
  const k = o.short / Math.min(a, b);
  return { width: Math.round((a * k) / 2) * 2, height: Math.round((b * k) / 2) * 2 };
}

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const media = ctx.engines.media;
  const info = await media.inspect(input.file, ctx.signal);
  if (!info.video) throw new Error('This file has no video track.');
  const frame = { ...frameSize(o), fit: o.fit };
  // MP4 (H.264/AAC) is what every app accepts for upload; WebM inputs stay WebM.
  const container: Container = extensionOf(input.file.name) === 'webm' ? 'webm' : 'mp4';
  return runMedia(
    log,
    input,
    ctx,
    (opts) =>
      media.convert(input.file, { container, video: { quality: 'high', transform: { frame } }, audio: { bitrate: 'copy' } }, opts).then((r) => {
        const short = Math.min(info.video!.width, info.video!.height);
        if (short < Math.min(frame.width, frame.height)) {
          r.report.notes.push(`The source is ${info.video!.width}×${info.video!.height}, smaller than the ${frame.width}×${frame.height} frame, so it was scaled up: it will look softer, not sharper.`);
        }
        return r;
      }),
    `-${frame.width}x${frame.height}`,
  );
});

export default function ResizeVideo({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ preset: 'vertical', width: 1280, height: 720, fit: 'cover', short: 1080 });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const preset = PRESETS.find((p) => p.value === options.preset)!;
  const size = frameSize(options);

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel="Resize"
      zipName="resized-videos.zip"
      validate={() => (size.width < 16 || size.height < 16 || size.width > 4096 || size.height > 4096 ? 'Use a size between 16 and 4096 pixels.' : null)}
      optionsPanel={
        <>
          <OptionField label="Format" htmlFor="rv-preset" hint={preset.hint}>
            <OptionSelect id="rv-preset" value={options.preset} options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} onChange={(v) => set('preset', v)} />
          </OptionField>
          {options.preset === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <OptionField label="Width" htmlFor="rv-w">
                <NumberInput id="rv-w" value={options.width} onChange={(v) => set('width', v)} min={16} max={4096} suffix="px" />
              </OptionField>
              <OptionField label="Height" htmlFor="rv-h">
                <NumberInput id="rv-h" value={options.height} onChange={(v) => set('height', v)} min={16} max={4096} suffix="px" />
              </OptionField>
            </div>
          ) : (
            <OptionField label="Resolution">
              <Segmented
                label="Resolution"
                value={options.short}
                options={[
                  { value: 1080 as const, label: '1080p' },
                  { value: 720 as const, label: '720p' },
                ]}
                onChange={(v) => set('short', v)}
              />
            </OptionField>
          )}
          <OptionField
            label="Fit"
            hint={options.fit === 'cover' ? 'Fills the frame; the parts that do not fit are cropped evenly from the sides.' : 'Shows the whole picture; the rest of the frame is black.'}
          >
            <Segmented
              label="Fit"
              value={options.fit}
              options={[
                { value: 'cover', label: 'Fill (crop)' },
                { value: 'contain', label: 'Fit (black bars)' },
              ]}
              onChange={(v) => set('fit', v)}
            />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Output: {size.width}×{size.height}, MP4 (H.264/AAC) for any upload form. The video is re-encoded; the sound is copied when it can be.
          </p>
          <EngineHint container="mp4" />
        </>
      }
    />
  );
}
