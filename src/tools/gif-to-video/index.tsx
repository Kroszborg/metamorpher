'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { VideoQualityField } from '@/components/media/options';
import { OptionField, perFile } from '@/components/workbench';
import type { GifToVideoRequest } from '@/engines/media';
import type { ToolProps } from '@/tools/types';

type Options = Omit<GifToVideoRequest, 'codec'>;

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) =>
  runMedia(log, input, ctx, (opts) => ctx.engines.media.gifToVideo(input.file, { ...o, codec: 'auto' }, opts)),
);

export default function GifToVideo({ tool }: ToolProps) {
  const [options, setOptions] = useState<Options>({ container: 'mp4', quality: 'balanced' });

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel="Convert"
      zipName="gif-videos.zip"
      optionsPanel={
        <>
          <OptionField
            label="Format"
            hint={options.container === 'mp4' ? 'H.264: plays everywhere, including messaging apps.' : 'VP9 (or VP8): smaller, for the web.'}
          >
            <Segmented
              label="Format"
              value={options.container}
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'webm', label: 'WebM' },
              ]}
              onChange={(container) => setOptions((o) => ({ ...o, container }))}
            />
          </OptionField>
          <VideoQualityField
            value={options.quality}
            onChange={(v) => setOptions((o) => ({ ...o, quality: v === 'copy' ? 'balanced' : v }))}
            allowCopy={false}
          />
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Every frame keeps its own delay, so the timing matches the GIF. Transparent areas become white. Videos are
            usually far smaller than the GIF.
          </p>
          <EngineHint container={options.container} />
        </>
      }
    />
  );
}
