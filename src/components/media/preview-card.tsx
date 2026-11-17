'use client';

import { SectionCard } from '@/components/kit/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { audioCodecLabel, formatBitrate, formatTime, type MediaInfo, videoCodecLabel } from '@/engines/media';
import { formatBytes } from '@/lib/files';
import { MediaPlayer, usePlayer } from './media-player';
import { clampRange, type TrimRange, TrimTimeline } from './trim-timeline';
import { useMediaInfo, useThumbnails, useWaveform } from './use-media';

/** "H.264 1920×1080 30 fps · AAC 48 kHz stereo · 1:02.50 · 24 MB" */
export function describeMedia(info: MediaInfo): string {
  const parts: string[] = [];
  if (info.video) {
    const v = info.video;
    parts.push(
      `${videoCodecLabel(v.codec)} ${v.width}×${v.height}${v.fps ? ` ${Math.round(v.fps * 100) / 100} fps` : ''}${v.rotation ? ` (rotated ${v.rotation}°)` : ''}${v.bitrate ? ` ${formatBitrate(v.bitrate)}` : ''}`,
    );
  }
  if (info.audio) {
    const a = info.audio;
    const ch = a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : `${a.channels} ch`;
    parts.push(`${audioCodecLabel(a.codec)} ${Math.round(a.sampleRate / 100) / 10} kHz ${ch}`);
  }
  parts.push(formatTime(info.duration), formatBytes(info.size));
  return parts.join(' · ');
}

/**
 * Player, file facts and (when `onRange` is given) a trim timeline for one
 * file. `range` null means the whole file, not yet chosen.
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
  const { info, loading, error } = useMediaInfo(file);
  const player = usePlayer();
  const isVideo = !!info?.video;
  const thumbs = useThumbnails(info && isVideo ? file : null, 12);
  const peaks = useWaveform(file, 160, !!info && !isVideo && !!info.audio && !!onRange);
  const duration = info?.duration ?? 0;

  return (
    <SectionCard
      title={title}
      description={info?.readable ? describeMedia(info) : loading ? 'Reading the file…' : (error ?? info?.reason)}
      contentClassName="flex flex-col gap-4"
    >
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <MediaPlayer file={file} kind={isVideo || (!info?.readable && file.type.startsWith('video/')) ? 'video' : 'audio'} control={player} />
      )}
      {onRange && info?.readable && duration > 0 ? (
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
      {onRange && info && !info.readable ? (
        <p className="text-[0.7rem]/relaxed text-muted-foreground">
          The fast engine cannot read this format, so there is no timeline. Convert it to MP4 or MP3 first, then trim.
        </p>
      ) : null}
    </SectionCard>
  );
}
