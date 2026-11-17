'use client';

import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { perFile } from '@/components/workbench';
import { sameContainer } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

const log = createJobLog();

const job = perFile<null>(async (input, _o, ctx) => {
  const info = await ctx.engines.media.probe(input.file, ctx.signal);
  if (info.readable && !info.video) throw new Error('This file has no video track.');
  const container = sameContainer(extensionOf(input.file.name), true);
  return runMedia(
    log,
    input,
    ctx,
    (opts) => ctx.engines.media.convert(input.file, { container, video: { quality: 'copy' }, audio: { discard: true } }, opts),
    '-muted',
  );
});

export default function MuteVideo({ tool }: ToolProps) {
  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={null}
      accept={tool.accept}
      runLabel="Remove audio"
      zipName="muted-videos.zip"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            Removes every audio track. The video is copied without re-encoding, so quality and size stay the same and it
            takes seconds even for long files. The format stays the same (WMV, FLV and MPEG become MP4).
          </p>
          <EngineHint container="mp4" />
        </>
      }
    />
  );
}
