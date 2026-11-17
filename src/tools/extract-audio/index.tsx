'use client';

import { useState } from 'react';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { AudioBitrateField } from '@/components/media/options';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import { CONTAINERS, type Container, type MediaInfo } from '@/engines/media';
import type { ToolProps } from '@/tools/types';

type Target = 'original' | 'mp3' | 'm4a' | 'wav' | 'flac' | 'opus' | 'ogg';
type Options = { target: Target; bitrate: number };

const TARGETS: { value: Target; label: string }[] = [
  { value: 'original', label: 'Original (no re-encoding)' },
  ...(['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg'] as const).map((f) => ({ value: f, label: CONTAINERS[f].label })),
];

/** The audio-only container that holds the source's codec as it is. */
function originalContainer(info: MediaInfo): Container | null {
  const codec = info.audio?.codec ?? null;
  if (!codec) return null;
  if (codec === 'aac') return 'm4a';
  if (codec === 'mp3') return 'mp3';
  if (codec === 'opus') return 'opus';
  if (codec === 'vorbis') return 'ogg';
  if (codec === 'flac') return 'flac';
  if (codec.startsWith('pcm')) return 'wav';
  return null;
}

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const media = ctx.engines.media;
  const info = await media.probe(input.file, ctx.signal);
  if (info.readable && !info.audio) throw new Error('This video has no audio track.');
  let container: Container;
  let bitrate: number | 'copy' = o.bitrate;
  if (o.target === 'original') {
    // Unknown codecs (AC-3, unreadable containers) are re-encoded to M4A (AAC) at the source's bitrate or lower.
    container = (info.readable ? originalContainer(info) : null) ?? 'm4a';
    bitrate = info.readable ? 'copy' : 192_000;
  } else {
    container = o.target;
  }
  return runMedia(log, input, ctx, (opts) =>
    media.convert(input.file, { container, video: { discard: true }, audio: { bitrate } }, opts),
  );
});

export default function ExtractAudio({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ target: 'original', bitrate: 192_000 });
  const lossy = options.target !== 'original' && options.target !== 'wav' && options.target !== 'flac';

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel="Extract audio"
      zipName="extracted-audio.zip"
      optionsPanel={
        <>
          <OptionField
            label="Save as"
            htmlFor="ea-target"
            hint={
              options.target === 'original'
                ? 'Keeps the soundtrack exactly as it is (AAC → M4A, MP3 → MP3, Opus → Opus, Vorbis → OGG, FLAC, PCM → WAV). Other codecs become M4A.'
                : undefined
            }
          >
            <OptionSelect id="ea-target" value={options.target} options={TARGETS} onChange={(target) => setOptions((o) => ({ ...o, target }))} />
          </OptionField>
          {lossy ? (
            <AudioBitrateField id="ea-bitrate" value={options.bitrate} onChange={(v) => setOptions((o) => ({ ...o, bitrate: v === 'copy' ? 192_000 : v }))} />
          ) : null}
          <EngineHint container={options.target === 'original' ? 'm4a' : options.target} />
        </>
      }
    />
  );
}
