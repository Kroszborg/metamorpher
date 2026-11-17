'use client';

import { useState } from 'react';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { AudioBitrateField, VideoQualityField } from '@/components/media/options';
import { defineJob, OptionField, OptionSelect } from '@/components/workbench';
import { CONTAINERS, type Container, sameContainer } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Target = 'auto' | Extract<Container, 'mp4' | 'webm' | 'mkv' | 'mov' | 'mp3' | 'm4a' | 'wav' | 'flac' | 'opus'>;
type Options = { target: Target; quality: 'small' | 'balanced' | 'high'; audioBitrate: number };

const TARGETS: { value: Target; label: string }[] = [
  { value: 'auto', label: 'Same as the first clip' },
  ...(['mp4', 'webm', 'mkv', 'mov'] as const).map((c) => ({ value: c, label: `${CONTAINERS[c].label} video` })),
  ...(['mp3', 'm4a', 'wav', 'flac', 'opus'] as const).map((c) => ({ value: c, label: `${CONTAINERS[c].label}, audio only` })),
];

const log = createJobLog();

const job = defineJob<Options>({
  mode: 'batch',
  async run(inputs, o, ctx) {
    const media = ctx.engines.media;
    const first = inputs[0];
    if (!first || inputs.length < 2) throw new Error('Add at least two clips.');
    let container: Container;
    if (o.target === 'auto') {
      const infos = await Promise.all(inputs.map((i) => media.probe(i.file, ctx.signal)));
      const anyVideo = infos.some((info, k) => (info.readable ? !!info.video : inputs[k]!.file.type.startsWith('video/')));
      container = sameContainer(extensionOf(first.file.name), anyVideo);
      if (container === 'avi' || container === 'ts') container = 'mp4';
      if (container === 'ogg') container = 'opus';
    } else {
      container = o.target;
    }
    const result = await media.merge(
      inputs.map((i) => i.file),
      { container, quality: o.quality, audioBitrate: o.audioBitrate },
      { signal: ctx.signal, onProgress: ctx.onProgress },
    );
    const name = `merged.${result.ext}`;
    log.push({ name: `${inputs.length} clips`, output: name, size: result.blob.size, report: result.report });
    return [{ name, blob: result.blob }];
  },
});

export default function MergeClips({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ target: 'auto', quality: 'high', audioBitrate: 192_000 });
  const audioOnly = options.target !== 'auto' && CONTAINERS[options.target].kind === 'audio';

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      reorderable
      minFiles={2}
      runLabel="Merge"
      optionsPanel={
        <>
          <OptionField
            label="Output"
            htmlFor="mc-target"
            hint="Clips are joined in list order. When every clip has the same codec, size and settings they are joined without re-encoding (instant, lossless); otherwise everything is re-encoded to match the first clip."
          >
            <OptionSelect id="mc-target" value={options.target} options={TARGETS} onChange={(target) => setOptions((o) => ({ ...o, target }))} />
          </OptionField>
          {!audioOnly ? (
            <VideoQualityField
              value={options.quality}
              onChange={(v) => setOptions((o) => ({ ...o, quality: v === 'copy' ? 'high' : v }))}
              allowCopy={false}
            />
          ) : null}
          <AudioBitrateField
            id="mc-abr"
            value={options.audioBitrate}
            onChange={(v) => setOptions((o) => ({ ...o, audioBitrate: v === 'copy' ? 192_000 : v }))}
          />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            When re-encoding, clips of another size are scaled to fit the first clip’s frame with black bars, clips without
            sound get silence, and audio-only clips in a video get a black picture.
          </p>
          <EngineHint container={options.target === 'auto' ? 'mp4' : options.target} />
        </>
      }
    />
  );
}
