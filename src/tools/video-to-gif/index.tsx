'use client';

import { useEffect, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { MediaPreviewCard } from '@/components/media/preview-card';
import { clampRange, type TrimRange } from '@/components/media/trim-timeline';
import { useMediaInfo } from '@/components/media/use-media';
import { type InputFile, OptionField, perFile } from '@/components/workbench';
import { formatTime, type GifRequest, mediaEngine } from '@/engines/media';
import { formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Options = { fps: number; width: number; colors: GifRequest['colors']; ranges: Record<string, TrimRange> };

/** Longest default selection: GIFs of whole videos get huge. */
const DEFAULT_SECONDS = 5;

function request(o: Options, id: string, duration: number): GifRequest {
  const r = o.ranges[id] ?? { start: 0, end: Math.min(duration, DEFAULT_SECONDS) };
  return { fps: o.fps, width: o.width, colors: o.colors, start: r.start, end: r.end };
}

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const info = await ctx.engines.media.probe(input.file, ctx.signal);
  const req = request(o, input.id, info.duration || DEFAULT_SECONDS);
  return runMedia(log, input, ctx, (opts) => ctx.engines.media.videoToGif(input.file, req, opts));
});

/** Size estimate from a few encoded sample frames, refreshed (debounced) as the options change. */
function SizeEstimate({ input, options }: { input: InputFile; options: Options }) {
  const { info } = useMediaInfo(input.file);
  const req = info?.readable ? request(options, input.id, info.duration) : null;
  const key = req ? JSON.stringify(req) : null;
  const [state, setState] = useState<{ key: string; bytes: number | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      mediaEngine.estimateGif(input.file, JSON.parse(key) as GifRequest, abort.signal).then(
        (bytes) => !abort.signal.aborted && setState({ key, bytes }),
        () => !abort.signal.aborted && setState({ key, bytes: null }),
      );
    }, 400);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [input.file, key]);
  if (!req) return null;
  const frames = Math.max(1, Math.round((req.end - req.start) * req.fps));
  const current = state?.key === key ? state : null;
  return (
    <p className="text-[0.7rem]/relaxed text-muted-foreground">
      {formatTime(req.end - req.start)} · {frames} frames ·{' '}
      <span className="font-mono tabular-nums text-foreground">
        {current ? (current.bytes ? `≈ ${formatBytes(current.bytes)}` : 'no estimate') : 'estimating…'}
      </span>
    </p>
  );
}

export default function VideoToGif({ tool }: ToolProps) {
  const [options, setOptions] = useState<Omit<Options, 'ranges'>>({ fps: 12, width: 480, colors: 256 });
  const [ranges, setRanges] = useState<Record<string, TrimRange>>({});
  const all: Options = { ...options, ranges };
  const set = <K extends keyof typeof options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={all}
      accept={tool.accept}
      multiple={false}
      runLabel="Make GIF"
      preview={(files, running) => {
        const input = files[0];
        if (!input) return null;
        return (
          <GifPreview
            key={input.id}
            input={input}
            running={running}
            range={ranges[input.id] ?? null}
            onRange={(r) => setRanges((m) => ({ ...m, [input.id]: r }))}
          />
        );
      }}
      optionsPanel={(files) => (
        <>
          <OptionField label="Frames per second" hint="Fewer frames make a smaller file; 10–15 looks smooth for most clips.">
            <Segmented
              label="Frame rate"
              value={options.fps}
              options={[8, 10, 12, 15, 20, 25].map((n) => ({ value: n, label: String(n) }))}
              onChange={(v) => set('fps', v)}
            />
          </OptionField>
          <OptionField label="Width" hint="Height follows the aspect ratio. Never upscaled.">
            <Segmented
              label="Width"
              value={options.width}
              options={[
                { value: 240, label: '240' },
                { value: 320, label: '320' },
                { value: 480, label: '480' },
                { value: 640, label: '640' },
                { value: 0, label: 'Original' },
              ]}
              onChange={(v) => set('width', v)}
            />
          </OptionField>
          <OptionField label="Colours" hint="One palette for the whole GIF, picked from frames across the clip. Fewer colours, smaller file, more banding.">
            <Segmented
              label="Palette"
              value={options.colors}
              options={([256, 128, 64, 32] as const).map((n) => ({ value: n, label: String(n) }))}
              onChange={(v) => set('colors', v)}
            />
          </OptionField>
          {files[0] ? (
            <OptionField label="Estimated size">
              <SizeEstimate input={files[0]} options={all} />
            </OptionField>
          ) : null}
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            Frames are decoded with WebCodecs and quantised in your browser. GIFs have no sound.
          </p>
        </>
      )}
    />
  );
}

function GifPreview({
  input,
  running,
  range,
  onRange,
}: {
  input: InputFile;
  running: boolean;
  range: TrimRange | null;
  onRange: (r: TrimRange) => void;
}) {
  const { info } = useMediaInfo(input.file);
  const duration = info?.duration ?? 0;
  // Until the user picks a range, show the default first seconds as selected.
  const shown = range ?? (duration > 0 ? clampRange({ start: 0, end: Math.min(duration, DEFAULT_SECONDS) }, duration) : null);
  return <MediaPreviewCard file={input.file} running={running} range={shown} onRange={onRange} title="Clip" />;
}
