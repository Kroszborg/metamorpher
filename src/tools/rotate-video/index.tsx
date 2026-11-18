'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { SwitchRow } from '@/components/pdf-pages/fields';
import { OptionField, perFile } from '@/components/workbench';
import { type MediaInfo, sameContainer, type VideoTransform } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Aspect = 'original' | '1:1' | '9:16' | '16:9' | '4:5' | '4:3';
type Options = { rotate: 0 | 90 | 180 | 270; flipHorizontal: boolean; flipVertical: boolean; aspect: Aspect; position: 'start' | 'center' | 'end' };

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: 'original', label: 'Keep' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' },
  { value: '4:5', label: '4:5' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
];

/** The largest centred (or edge-aligned) region of the given shape inside the turned picture. */
function cropFor(info: MediaInfo, o: Options): VideoTransform['crop'] {
  if (o.aspect === 'original' || !info.video) return undefined;
  const turned = o.rotate === 90 || o.rotate === 270;
  const w = turned ? info.video.height : info.video.width;
  const h = turned ? info.video.width : info.video.height;
  const [aw, ah] = o.aspect.split(':').map(Number) as [number, number];
  let cw = w;
  let ch = Math.round((w * ah) / aw);
  if (ch > h) {
    ch = h;
    cw = Math.round((h * aw) / ah);
  }
  cw -= cw % 2;
  ch -= ch % 2;
  const at = (free: number) => (o.position === 'start' ? 0 : o.position === 'end' ? free : Math.floor(free / 2));
  return { left: at(w - cw), top: at(h - ch), width: cw, height: ch };
}

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const media = ctx.engines.media;
  const info = await media.inspect(input.file, ctx.signal);
  if (!info.video) throw new Error('This file has no video track.');
  const transform: VideoTransform = {
    rotate: o.rotate || undefined,
    flipHorizontal: o.flipHorizontal || undefined,
    flipVertical: o.flipVertical || undefined,
    crop: cropFor(info, o),
  };
  const container = sameContainer(extensionOf(input.file.name), true);
  return runMedia(
    log,
    input,
    ctx,
    (opts) =>
      media.convert(
        input.file,
        // Copy when a plain turn can be stored as rotation metadata; otherwise re-encode at the source's bitrate or lower.
        { container, video: { quality: 'copy', transform }, audio: { bitrate: 'copy' } },
        opts,
      ),
    o.aspect === 'original' ? '-rotated' : '-cropped',
  );
});

export default function RotateVideo({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ rotate: 90, flipHorizontal: false, flipVertical: false, aspect: 'original', position: 'center' });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const onlyTurn = !options.flipHorizontal && !options.flipVertical && options.aspect === 'original';
  const nothing = onlyTurn && options.rotate === 0;

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel="Apply"
      zipName="rotated-videos.zip"
      validate={() => (nothing ? 'Choose a turn, a flip or a crop.' : null)}
      optionsPanel={
        <>
          <OptionField label="Rotate (clockwise)">
            <Segmented
              label="Rotate"
              value={options.rotate}
              options={[
                { value: 0 as const, label: '0°' },
                { value: 90 as const, label: '90°' },
                { value: 180 as const, label: '180°' },
                { value: 270 as const, label: '270°' },
              ]}
              onChange={(v) => set('rotate', v)}
            />
          </OptionField>
          <SwitchRow label="Mirror (left ↔ right)" checked={options.flipHorizontal} onChange={(v) => set('flipHorizontal', v)} />
          <SwitchRow label="Flip upside down" checked={options.flipVertical} onChange={(v) => set('flipVertical', v)} />
          <OptionField label="Crop to" hint="The largest area of this shape in the turned picture. Use Resize for social media to pad instead of crop.">
            <Segmented label="Crop to" value={options.aspect} options={ASPECTS} onChange={(v) => set('aspect', v)} />
          </OptionField>
          {options.aspect !== 'original' ? (
            <OptionField label="Keep">
              <Segmented
                label="Crop position"
                value={options.position}
                options={[
                  { value: 'start', label: 'Left / top' },
                  { value: 'center', label: 'Centre' },
                  { value: 'end', label: 'Right / bottom' },
                ]}
                onChange={(v) => set('position', v)}
              />
            </OptionField>
          ) : null}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            {onlyTurn
              ? 'A plain turn is lossless and instant in MP4 and MOV: only the rotation flag changes. Other formats are re-encoded.'
              : 'Mirroring and cropping change the pixels, so the video is re-encoded (at the source’s bitrate or lower). Sound is copied.'}
          </p>
          <EngineHint container="mp4" />
        </>
      }
    />
  );
}
