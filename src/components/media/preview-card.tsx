'use client';

import { PlayIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { audioCodecLabel, formatBitrate, formatTime, type MediaInfo, mediaEngine, videoCodecLabel } from '@/engines/media';
import { formatBytes } from '@/lib/files';
import { MediaPlayer, usePlayer } from './media-player';
import { clampRange, type TrimRange, TrimTimeline } from './trim-timeline';
import { useMediaInfo, useThumbnails, useWaveform } from './use-media';

/** "H.264 1920×1080 30 fps · AAC 48 kHz stereo · 1:02.50 · 24 MB" */
export function describeMedia(info: MediaInfo): string {
  const parts: string[] = [];
  if (info.engine === 'ffmpeg' && info.format) parts.push(info.format);
  if (info.video) {
    const v = info.video;
    parts.push(
      `${v.label ?? videoCodecLabel(v.codec)} ${v.width}×${v.height}${v.fps ? ` ${Math.round(v.fps * 100) / 100} fps` : ''}${v.rotation ? ` (rotated ${v.rotation}°)` : ''}${v.bitrate ? ` ${formatBitrate(v.bitrate)}` : ''}`,
    );
  }
  if (info.audio) {
    const a = info.audio;
    const ch = a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : `${a.channels} ch`;
    parts.push(`${a.label ?? audioCodecLabel(a.codec)}${a.sampleRate ? ` ${Math.round(a.sampleRate / 100) / 10} kHz` : ''} ${ch}`);
  }
  parts.push(formatTime(info.duration), formatBytes(info.size));
  return parts.join(' · ');
}

/** Builds a small playable copy of a file the browser cannot play, on request. */
function useProxy(file: File) {
  const [state, setState] = useState<{ file: File; blob: Blob | null; progress: number | null; error: string | null } | null>(null);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => job.current?.abort(), [file]);
  const current = state?.file === file ? state : null;
  const start = () => {
    job.current?.abort();
    const abort = new AbortController();
    job.current = abort;
    setState({ file, blob: null, progress: 0, error: null });
    mediaEngine
      .previewProxy(file, {
        signal: abort.signal,
        onProgress: (f) => !abort.signal.aborted && setState((s) => (s?.file === file && !s.blob ? { ...s, progress: f } : s)),
      })
      .then(
        (blob) => !abort.signal.aborted && setState({ file, blob, progress: null, error: null }),
        (err: unknown) =>
          !abort.signal.aborted &&
          setState({ file, blob: null, progress: null, error: err instanceof Error ? err.message : 'The preview could not be built.' }),
      );
  };
  return { blob: current?.blob ?? null, progress: current?.progress ?? null, error: current?.error ?? null, start };
}

/**
 * Player, file facts and (when `onRange` is given) a trim timeline for one
 * file. `range` null means the whole file, not yet chosen. With a timeline,
 * files only the software engine reads still get their length, frames or
 * waveform from ffmpeg.wasm, and a playable preview on request.
 */
export function MediaPreviewCard({
  file,
  running,
  range,
  onRange,
  title = 'Preview',
}: {
  file: File;
  running: boolean;
  range?: TrimRange | null;
  onRange?: (r: TrimRange) => void;
  title?: string;
}) {
  const deep = !!onRange;
  const { info, loading, error } = useMediaInfo(file, deep);
  const player = usePlayer();
  const proxy = useProxy(file);
  const isVideo = !!info?.video;
  const known = !!info && (info.readable || info.engine === 'ffmpeg');
  const thumbs = useThumbnails(info && isVideo ? file : null, 12);
  const peaks = useWaveform(file, 160, !!info && !isVideo && !!info.audio && !!onRange);
  const duration = info?.duration ?? 0;
  const soft = info?.engine === 'ffmpeg';

  const buildButton =
    deep && known ? (
      proxy.progress !== null ? (
        <p className="text-[0.7rem] text-muted-foreground tabular-nums">Building a preview… {Math.round(proxy.progress * 100)}%</p>
      ) : (
        <div className="flex flex-col gap-1">
          <Button variant="outline" size="sm" className="self-start" disabled={running} onClick={proxy.start}>
            <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
            Make a playable preview
          </Button>
          <p className="text-[0.7rem]/relaxed text-muted-foreground">
            A small, low-quality copy made on this device with the software engine, only for watching while you choose. Your
            cut is made from the original.
          </p>
          {proxy.error ? <p className="text-[0.7rem]/relaxed text-destructive">{proxy.error}</p> : null}
        </div>
      )
    ) : null;

  return (
    <SectionCard
      title={title}
      description={known && info ? describeMedia(info) : loading ? 'Reading the file…' : (error ?? info?.reason)}
      contentClassName="flex flex-col gap-4"
    >
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <MediaPlayer
          file={proxy.blob ?? file}
          kind={isVideo || (!known && file.type.startsWith('video/')) ? 'video' : 'audio'}
          control={player}
          fallback={buildButton}
        />
      )}
      {onRange && known && duration > 0 ? (
        <TrimTimeline
          duration={duration}
          value={range ? clampRange(range, duration) : { start: 0, end: duration }}
          onChange={onRange}
          player={player}
          thumbs={thumbs}
          peaks={peaks}
          disabled={running}
        />
      ) : null}
      {onRange && soft ? (
        <p className="text-[0.7rem]/relaxed text-muted-foreground">
          Your browser cannot decode this format, so the software engine (ffmpeg.wasm) reads it: frames and length come from
          it, and the cut is made with it.
        </p>
      ) : null}
      {onRange && info && !known && !loading ? (
        <p className="text-[0.7rem]/relaxed text-muted-foreground">
          Neither engine could read the length of this file, so there is no timeline. It may be damaged.
        </p>
      ) : null}
    </SectionCard>
  );
}
