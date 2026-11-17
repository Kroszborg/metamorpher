'use client';

import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { MediaPreviewCard } from '@/components/media/preview-card';
import type { TrimRange } from '@/components/media/trim-timeline';
import { useMediaInfo } from '@/components/media/use-media';
import { OptionField, perFile } from '@/components/workbench';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Mode = 'precise' | 'fast';
type Options = { mode: Mode; ranges: Record<string, TrimRange> };

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const range = o.ranges[input.id];
  if (!range) throw new Error('Choose the part to keep first.');
  return runMedia(
    log,
    input,
    ctx,
    (opts) => ctx.engines.media.trim(input.file, { start: range.start, end: range.end, accurate: o.mode === 'precise' }, opts),
    '-trimmed',
  );
});

/** What the cut will cost for a format only the software engine reads. */
function SoftwareNote({ file, mode }: { file: File; mode: Mode }) {
  const { info } = useMediaInfo(file, true);
  if (info?.engine !== 'ffmpeg') return null;
  const name = (info.format ?? extensionOf(file.name)).toUpperCase();
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[0.7rem]/relaxed text-warning">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
      <span>
        {name} is cut by the software engine (ffmpeg.wasm, a 31 MB download the first time). It reads the file in pieces, so
        any input size works, but it builds the result in memory: the part you keep must come out under 1 GB.{' '}
        {mode === 'fast'
          ? 'Fast mode copies the streams, so it takes seconds.'
          : 'Frame-accurate mode re-encodes in software, which is slow for HD video (often slower than real time). Fast mode is instant.'}
      </span>
    </p>
  );
}

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
      optionsPanel={(files) => (
        <>
          <OptionField
            label="Cut"
            hint={
              mode === 'precise'
                ? 'Cuts exactly at the in and out frames. The kept part is re-encoded (at the source’s bitrate or lower), which takes longer.'
                : 'Copies the streams without re-encoding: instant and lossless, but video can only start at a key frame, so the clip may begin up to a few seconds early. MP3 and M4A audio are still cut on the exact sample (the end can run up to one audio frame, about 25 ms, long in M4A); Opus and Ogg audio are always re-encoded for an exact cut.'
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
          {files[0] ? <SoftwareNote file={files[0].file} mode={mode} /> : null}
          <EngineHint container="mp4" />
        </>
      )}
    />
  );
}
