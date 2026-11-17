'use client';

import { useState } from 'react';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { SwitchRow } from '@/components/pdf-pages/fields';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import { sameContainer } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { factor: number; keepPitch: boolean };

const FACTORS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4];

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const info = await ctx.engines.media.probe(input.file, ctx.signal);
  const hasVideo = info.readable ? !!info.video : input.file.type.startsWith('video/');
  const container = sameContainer(extensionOf(input.file.name), hasVideo);
  const label = String(o.factor).replace('.', '_');
  return runMedia(
    log,
    input,
    ctx,
    (opts) =>
      ctx.engines.media.convert(
        input.file,
        {
          container,
          video: { quality: 'high' },
          audio: { bitrate: 'copy' },
          speed: { factor: o.factor, keepPitch: o.keepPitch },
        },
        opts,
      ),
    `-${label}x`,
  );
});

export default function ChangeSpeed({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ factor: 2, keepPitch: true });
  const faster = options.factor > 1;

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel="Change speed"
      zipName="speed-changed.zip"
      optionsPanel={
        <>
          <OptionField
            label="Speed"
            htmlFor="cs-speed"
            hint={
              faster
                ? `Plays ${options.factor}× as fast: a 60 s clip becomes ${Math.round(60 / options.factor)} s. Video keeps its frame rate by dropping frames.`
                : `Plays at ${options.factor}× speed: a 60 s clip becomes ${Math.round(60 / options.factor)} s. Slow motion shows each frame longer (a 30 fps clip at 0.5× plays at 15 fps); no frames are invented.`
            }
          >
            <OptionSelect
              id="cs-speed"
              value={String(options.factor)}
              options={FACTORS.map((f) => ({ value: String(f), label: f < 1 ? `${f}× (slow motion)` : `${f}× (faster)` }))}
              onChange={(v) => setOptions((o) => ({ ...o, factor: Number(v) }))}
            />
          </OptionField>
          <SwitchRow
            label="Keep the audio pitch"
            checked={options.keepPitch}
            onChange={(keepPitch) => setOptions((o) => ({ ...o, keepPitch }))}
            hint={
              options.keepPitch
                ? 'Audio is time-stretched (WSOLA) so voices sound normal, just faster or slower. Sounds most natural between 0.5× and 2×; beyond that it can get choppy or echoey.'
                : 'Audio is resampled like a tape or record: it plays faster and higher, or slower and deeper.'
            }
          />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Video and audio are re-encoded (at the source’s bitrate or lower) and stay in sync. The format stays the same.
          </p>
          <EngineHint container="mp4" />
        </>
      }
    />
  );
}
