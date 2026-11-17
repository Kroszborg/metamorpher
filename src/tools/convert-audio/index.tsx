'use client';

import { useState } from 'react';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { AudioBitrateField, AudioChannelsField, SampleRateField, sampleRateChoices } from '@/components/media/options';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import { CONTAINERS, type Container } from '@/engines/media';
import type { ToolProps } from '@/tools/types';

type AudioTarget = Extract<Container, 'mp3' | 'm4a' | 'aac' | 'ogg' | 'opus' | 'flac' | 'wav'>;

type Options = { format: AudioTarget; bitrate: number | 'copy'; sampleRate: number; channels: number };

const FORMATS: { value: AudioTarget; label: string }[] = (['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav'] as const).map((f) => ({
  value: f,
  label: CONTAINERS[f].label,
}));

const LOSSLESS = new Set<AudioTarget>(['flac', 'wav']);

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) =>
  runMedia(log, input, ctx, (opts) =>
    ctx.engines.media.convert(
      input.file,
      {
        container: o.format,
        video: { discard: true },
        audio: {
          bitrate: LOSSLESS.has(o.format) ? undefined : o.bitrate,
          sampleRate: o.sampleRate || undefined,
          channels: o.channels || undefined,
        },
      },
      opts,
    ),
  ),
);

export default function ConvertAudio({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ format: 'mp3', bitrate: 160_000, sampleRate: 0, channels: 0 });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const rates = sampleRateChoices(options.format);
  const sampleRate = rates.some((r) => r.value === options.sampleRate) ? options.sampleRate : 0;
  const effective = { ...options, sampleRate };

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={effective}
      accept={tool.accept}
      runLabel="Convert"
      zipName="converted-audio.zip"
      optionsPanel={
        <>
          <OptionField label="Convert to" htmlFor="ca-format">
            <OptionSelect id="ca-format" value={options.format} options={FORMATS} onChange={(v) => set('format', v)} />
          </OptionField>
          {LOSSLESS.has(options.format) ? (
            <p className="text-[0.7rem]/relaxed text-muted-foreground">
              {CONTAINERS[options.format].label} is lossless: no bitrate to choose. Converting from a lossy file does not
              restore quality, it only makes the file larger.
            </p>
          ) : (
            <AudioBitrateField id="ca-bitrate" value={options.bitrate} onChange={(v) => set('bitrate', v)} allowCopy />
          )}
          <SampleRateField id="ca-rate" format={options.format} value={sampleRate} onChange={(v) => set('sampleRate', v)} />
          <AudioChannelsField value={options.channels} onChange={(v) => set('channels', v)} />
          <EngineHint container={options.format} />
        </>
      }
    />
  );
}

