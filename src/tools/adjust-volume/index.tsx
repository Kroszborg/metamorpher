'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { NumberInput } from '@/components/pdf-pages/fields';
import { OptionField, perFile } from '@/components/workbench';
import { type AudioLevel, sameContainer } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Mode = 'normalize' | 'gain';
type Options = { mode: Mode; target: number; gainDb: number; fadeIn: number; fadeOut: number };

const TARGETS = [
  { value: -14, label: '−14', hint: 'Streaming music (Spotify, YouTube)' },
  { value: -16, label: '−16', hint: 'Podcasts and spoken word' },
  { value: -23, label: '−23', hint: 'Broadcast (EBU R128)' },
];

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const info = await ctx.engines.media.inspect(input.file, ctx.signal);
  if (!info.audio) throw new Error('This file has no audio track.');
  const level: AudioLevel = {
    ...(o.mode === 'normalize' ? { normalize: o.target } : { gainDb: o.gainDb }),
    fadeIn: o.fadeIn || undefined,
    fadeOut: o.fadeOut || undefined,
  };
  const container = sameContainer(extensionOf(input.file.name), !!info.video);
  return runMedia(
    log,
    input,
    ctx,
    (opts) =>
      ctx.engines.media.convert(
        input.file,
        // The picture is copied untouched; only the sound is re-encoded (at the source's bitrate or lower).
        { container, video: { quality: 'copy' }, audio: { bitrate: 'copy', level } },
        opts,
      ),
    o.mode === 'normalize' ? '-normalized' : '-volume',
  );
});

export default function AdjustVolume({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ mode: 'normalize', target: -16, gainDb: 3, fadeIn: 0, fadeOut: 0 });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const target = TARGETS.find((t) => t.value === options.target);

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel={options.mode === 'normalize' ? 'Normalise' : 'Change volume'}
      zipName="volume-adjusted.zip"
      validate={(_files, o) =>
        o.mode === 'normalize' || o.gainDb !== 0 || o.fadeIn > 0 || o.fadeOut > 0 ? null : 'Choose a gain other than 0 dB, or a fade.'
      }
      optionsPanel={
        <>
          <OptionField label="Adjust by">
            <Segmented
              label="Adjust by"
              value={options.mode}
              options={[
                { value: 'normalize', label: 'Loudness (LUFS)' },
                { value: 'gain', label: 'Gain (dB)' },
              ]}
              onChange={(v) => set('mode', v)}
            />
          </OptionField>
          {options.mode === 'normalize' ? (
            <OptionField
              label="Target loudness"
              hint={`${target?.hint ?? 'Custom target'}. Measured over the whole file (EBU R128, gated), then one gain is applied, so quiet and loud passages keep their balance. Peaks never go above −1 dBFS: when they would, the gain stops short and the report says so.`}
            >
              <Segmented label="Target loudness" value={options.target} options={TARGETS.map((t) => ({ value: t.value, label: t.label }))} onChange={(v) => set('target', v)} />
            </OptionField>
          ) : (
            <OptionField
              label="Gain"
              htmlFor="av-gain"
              hint="Positive is louder. Boosts stop at −1 dBFS peaks instead of clipping (the report says when)."
            >
              <NumberInput id="av-gain" value={options.gainDb} onChange={(v) => set('gainDb', v)} min={-30} max={30} decimals suffix="dB" />
            </OptionField>
          )}
          <OptionField label="Fade in" htmlFor="av-fadein" hint="Seconds from silence at the start; 0 for none.">
            <NumberInput id="av-fadein" value={options.fadeIn} onChange={(v) => set('fadeIn', v)} min={0} max={60} decimals suffix="s" />
          </OptionField>
          <OptionField label="Fade out" htmlFor="av-fadeout" hint="Seconds to silence at the end; 0 for none.">
            <NumberInput id="av-fadeout" value={options.fadeOut} onChange={(v) => set('fadeOut', v)} min={0} max={60} decimals suffix="s" />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Works on audio files and on the sound of videos (the picture is copied, not re-encoded). The format stays the same.
          </p>
          <EngineHint container="m4a" />
        </>
      }
    />
  );
}
