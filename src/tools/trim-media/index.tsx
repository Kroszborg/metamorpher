'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { MediaPreviewCard } from '@/components/media/preview-card';
import type { TrimRange } from '@/components/media/trim-timeline';
import { OptionField, perFile } from '@/components/workbench';
import { sameContainer } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Mode = 'precise' | 'fast';
type Options = { mode: Mode; ranges: Record<string, TrimRange> };

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const range = o.ranges[input.id];
  if (!range) throw new Error('Choose the part to keep first.');
  const info = await ctx.engines.media.probe(input.file, ctx.signal);
  const container = sameContainer(extensionOf(input.file.name), !!info.video);
  return runMedia(
    log,
    input,
    ctx,
    (opts) =>
      ctx.engines.media.convert(
        input.file,
        {
          container,
          video: { quality: 'copy' },
          audio: { bitrate: 'copy' },
          trim: { start: range.start, end: range.end, accurate: o.mode === 'precise' },
        },
        opts,
      ),
    '-trimmed',
  );
});

export default function TrimMedia({ tool }: ToolProps) {
  const [mode, setMode] = useState<Mode>('precise');
  const [ranges, setRanges] = useState<Record<string, TrimRange>>({});
  const options: Options = { mode, ranges };

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      multiple={false}
      runLabel="Trim"
      preview={(files, running) => {
        const input = files[0];
        if (!input) return null;
        return (
          <MediaPreviewCard
            key={input.id}
            file={input.file}
            running={running}
            range={ranges[input.id] ?? null}
            onRange={(r) => setRanges((all) => ({ ...all, [input.id]: r }))}
          />
        );
      }}
      validate={(files) => (files[0] && !ranges[files[0].id] ? 'Drag the handles or type the in and out times.' : null)}
      optionsPanel={
        <>
          <OptionField
            label="Cut"
            hint={
              mode === 'precise'
                ? 'Cuts exactly at the in and out frames. The kept part is re-encoded (at the source’s bitrate or lower), which takes longer.'
                : 'Copies the streams without re-encoding: instant and lossless, but video can only start at a key frame, so the clip may begin up to a few seconds early (audio a fraction of a second).'
            }
          >
            <Segmented
              label="Cut mode"
              value={mode}
              options={[
                { value: 'precise', label: 'Frame-accurate' },
                { value: 'fast', label: 'Fast (key frames)' },
              ]}
              onChange={setMode}
            />
          </OptionField>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            The result keeps the input’s format. When the in point falls on a key frame, the frame-accurate cut copies the video
            too.
          </p>
          <EngineHint container="mp4" />
        </>
      }
    />
  );
}
