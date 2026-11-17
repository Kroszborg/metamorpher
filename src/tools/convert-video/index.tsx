'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import {
  AudioBitrateField,
  effectiveCodec,
  FrameRateField,
  ResolutionField,
  VideoQualityField,
  videoCodecChoices,
} from '@/components/media/options';
import { useCapabilities } from '@/components/media/use-media';
import { OptionField, OptionSelect, perFile } from '@/components/workbench';
import { type Container, CONTAINERS, type VideoCodecId, type VideoQuality } from '@/engines/media';
import { extensionOf } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type VideoTarget = 'mp4' | 'webm' | 'mkv' | 'mov' | 'avi';
type AudioTarget = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'flac';
type Target = VideoTarget | 'gif' | `audio:${AudioTarget}`;

type Options = {
  target: Target;
  codec: VideoCodecId | 'auto';
  quality: VideoQuality;
  resolution: number;
  fps: number;
  audioBitrate: number | 'copy';
  gifWidth: number;
  gifFps: number;
};

const VIDEO_TARGETS: { value: VideoTarget; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
  { value: 'mov', label: 'MOV' },
  { value: 'avi', label: 'AVI (MPEG-4)' },
];
const AUDIO_TARGETS: AudioTarget[] = ['mp3', 'm4a', 'wav', 'ogg', 'flac'];

const TARGETS: { value: Target; label: string }[] = [
  ...VIDEO_TARGETS,
  { value: 'gif', label: 'Animated GIF' },
  ...AUDIO_TARGETS.map((f) => ({ value: `audio:${f}` as const, label: `${CONTAINERS[f].label}, audio only` })),
];

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const media = ctx.engines.media;
  if (o.target === 'gif') {
    return runMedia(log, input, ctx, (opts) =>
      media.videoToGif(input.file, { fps: o.gifFps, width: o.gifWidth, colors: 256, start: 0, end: 0 }, opts),
    );
  }
  const isGifInput = extensionOf(input.file.name) === 'gif' || input.file.type === 'image/gif';
  if (isGifInput && (o.target === 'mp4' || o.target === 'webm')) {
    const quality = o.quality === 'copy' ? 'balanced' : o.quality;
    return runMedia(log, input, ctx, (opts) =>
      media.gifToVideo(input.file, { container: o.target as 'mp4' | 'webm', codec: o.codec, quality }, opts),
    );
  }
  const container: Container = o.target.startsWith('audio:') ? (o.target.slice(6) as AudioTarget) : (o.target as VideoTarget);
  const audioOnly = CONTAINERS[container].kind === 'audio';
  return runMedia(log, input, ctx, (opts) =>
    media.convert(
      input.file,
      {
        container,
        video: audioOnly
          ? { discard: true }
          : {
              codec: o.codec,
              quality: o.quality,
              maxShortSide: o.resolution || undefined,
              maxFps: o.fps || undefined,
            },
        // The Copy preset keeps the audio stream too when the new container can hold it.
        audio: { bitrate: !audioOnly && o.quality === 'copy' ? 'copy' : o.audioBitrate },
      },
      opts,
    ),
  );
});

export default function ConvertVideo({ tool }: ToolProps) {
  const caps = useCapabilities();
  const [options, setOptions] = useState<Options>({
    target: 'mp4',
    codec: 'auto',
    quality: 'balanced',
    resolution: 0,
    fps: 0,
    audioBitrate: 160_000,
    gifWidth: 480,
    gifFps: 12,
  });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const isGif = options.target === 'gif';
  const audioTarget = options.target.startsWith('audio:') ? (options.target.slice(6) as AudioTarget) : null;
  const videoTarget = !isGif && !audioTarget ? (options.target as VideoTarget) : null;
  const codec = videoTarget ? effectiveCodec(videoTarget, caps, options.codec) : 'auto';
  const lossless = audioTarget === 'wav' || audioTarget === 'flac';
  const effective = { ...options, codec };

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={effective}
      accept={tool.accept}
      runLabel="Convert"
      zipName="converted-videos.zip"
      optionsPanel={
        <>
          <OptionField label="Convert to" htmlFor="cv-target">
            <OptionSelect id="cv-target" value={options.target} options={TARGETS} onChange={(v) => set('target', v)} />
          </OptionField>
          {videoTarget && videoTarget !== 'avi' ? (
            <OptionField label="Video codec" htmlFor="cv-codec" hint="Only codecs this browser can encode are listed.">
              <OptionSelect
                id="cv-codec"
                value={codec}
                options={videoCodecChoices(videoTarget, caps)}
                onChange={(v) => set('codec', v)}
              />
            </OptionField>
          ) : null}
          {videoTarget ? (
            <>
              <VideoQualityField value={options.quality} onChange={(v) => set('quality', v)} />
              <ResolutionField id="cv-res" value={options.resolution} onChange={(v) => set('resolution', v)} />
              <FrameRateField value={options.fps} onChange={(v) => set('fps', v)} />
            </>
          ) : null}
          {isGif ? (
            <>
              <OptionField label="Width">
                <Segmented
                  label="GIF width"
                  value={options.gifWidth}
                  options={[
                    { value: 320, label: '320' },
                    { value: 480, label: '480' },
                    { value: 640, label: '640' },
                    { value: 0, label: 'Original' },
                  ]}
                  onChange={(v) => set('gifWidth', v)}
                />
              </OptionField>
              <OptionField label="Frames per second" hint="For trimming, palette size and a size estimate, use Video to GIF.">
                <Segmented
                  label="GIF frame rate"
                  value={options.gifFps}
                  options={[
                    { value: 8, label: '8' },
                    { value: 12, label: '12' },
                    { value: 15, label: '15' },
                  ]}
                  onChange={(v) => set('gifFps', v)}
                />
              </OptionField>
            </>
          ) : null}
          {(audioTarget && !lossless) || (videoTarget && options.quality !== 'copy') ? (
            <AudioBitrateField id="cv-abr" value={options.audioBitrate} onChange={(v) => set('audioBitrate', v)} allowCopy />
          ) : null}
          <EngineHint container={isGif ? 'gif' : (videoTarget ?? audioTarget ?? 'mp4')} videoCodec={codec} />
        </>
      }
    />
  );
}
