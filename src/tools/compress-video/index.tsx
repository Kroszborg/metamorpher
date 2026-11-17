'use client';

import { useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { EngineHint } from '@/components/media/engine-log';
import { createJobLog } from '@/components/media/job-log';
import { runMedia } from '@/components/media/media-job';
import { MediaWorkbench } from '@/components/media/media-workbench';
import { ResolutionField, VideoQualityField } from '@/components/media/options';
import { useCapabilities, useMediaInfo } from '@/components/media/use-media';
import { NumberInput } from '@/components/pdf-pages/fields';
import { type InputFile, OptionField, perFile } from '@/components/workbench';
import {
  type Capabilities,
  CONTAINERS,
  type CompressSettings,
  type Container,
  formatBitrate,
  planCompress,
  sameContainer,
  VIDEO_CODEC_LABEL,
  type VideoCodecId,
} from '@/engines/media';
import { extensionOf, formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type CodecChoice = VideoCodecId | 'auto';
type Options = Omit<CompressSettings, 'codec' | 'targetBytes'> & { targetMb: number; codec: CodecChoice };

const MB = 1024 * 1024;
const SIZE_PRESETS = [8, 25, 50, 100];

/** Output container and codec for one input: its own container when it can hold the codec, else MP4. */
function target(file: File, codec: CodecChoice, caps: Capabilities | null): { container: Container; codec: VideoCodecId } {
  let container = sameContainer(extensionOf(file.name), true);
  if (container === 'avi') container = 'mp4';
  if (codec !== 'auto' && !CONTAINERS[container].video.includes(codec)) container = 'mp4';
  const list = codec === 'auto' ? CONTAINERS[container].video : [codec];
  const chosen = list.find((c) => !caps || caps.videoEncode.includes(c)) ?? list[0] ?? 'avc';
  return { container, codec: chosen };
}

const log = createJobLog();

const job = perFile<Options>(async (input, o, ctx) => {
  const media = ctx.engines.media;
  const info = await media.probe(input.file, ctx.signal);
  if (!info.readable) throw new Error(`${info.reason ?? 'This format cannot be read.'} Convert it to MP4 first.`);
  const caps = await media.capabilities().catch(() => null);
  const { container, codec } = target(input.file, o.codec, caps);
  const settings: CompressSettings = { ...o, codec, targetBytes: o.targetMb * MB };
  const plan = planCompress(info, settings);
  if (!plan.ok) throw new Error(plan.error);

  const encode = (bitrate?: number) =>
    media.convert(
      input.file,
      {
        container,
        video: { ...plan.video, ...(bitrate ? { bitrate } : {}), codec: o.codec === 'auto' ? 'auto' : codec },
        audio: { bitrate: plan.audioBitrate || 96_000 },
      },
      { signal: ctx.signal, onProgress: ctx.onProgress },
    );

  return runMedia(
    log,
    input,
    ctx,
    async () => {
      let result = await encode();
      const notes = [...plan.notes];
      const limit = settings.targetBytes;
      if (o.mode === 'size' && plan.video.bitrate && result.blob.size > limit * 1.01) {
        // Encoders overshoot on short or busy clips: scale the video bitrate by how far off it was and go again.
        const audioBytes = (plan.audioBitrate * info.duration) / 8;
        const videoBytes = Math.max(1, result.blob.size - audioBytes);
        const wanted = limit * 0.95 - audioBytes;
        const bitrate = Math.max(100_000, Math.floor((plan.video.bitrate * wanted) / videoBytes));
        notes.push(`The first pass came out at ${formatBytes(result.blob.size)}; encoded again at ${formatBitrate(bitrate)} to fit.`);
        result = await encode(bitrate);
        if (result.blob.size > limit * 1.03) notes.push(`Still ${formatBytes(result.blob.size)}: this encoder cannot go lower here. Try a lower resolution.`);
      }
      if (result.blob.size >= input.file.size) {
        throw new Error(
          `The result (${formatBytes(result.blob.size)}) would not be smaller than the original. It is already efficiently compressed; try a smaller quality or a lower resolution.`,
        );
      }
      const saved = 1 - result.blob.size / input.file.size;
      notes.push(`${formatBytes(input.file.size)} → ${formatBytes(result.blob.size)} (${Math.round(saved * 100)}% smaller).`);
      result.report.notes.unshift(...notes);
      return result;
    },
    '-compressed',
  );
});

function Estimate({ input, options, caps }: { input: InputFile; options: Options; caps: Capabilities | null }) {
  const { info } = useMediaInfo(input.file);
  let text = '…';
  let tone = 'text-muted-foreground';
  if (info && !info.readable) text = 'cannot read';
  else if (info) {
    const { codec } = target(input.file, options.codec, caps);
    const plan = planCompress(info, { ...options, codec, targetBytes: options.targetMb * MB });
    if (!plan.ok) {
      text = plan.error.replace(/^This video is already .*$/, 'already under the target');
      tone = 'text-warning';
    } else {
      const pct = Math.round((1 - plan.estimate / input.file.size) * 100);
      text = pct > 0 ? `≈ ${formatBytes(plan.estimate)} (−${pct}%)` : `≈ ${formatBytes(plan.estimate)}, not smaller`;
      if (pct <= 0) tone = 'text-warning';
    }
  }
  return (
    <li className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-[0.7rem]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={input.file.name}>
        {input.file.name} · {formatBytes(input.file.size)}
      </span>
      <span className={`max-w-full text-right font-mono tabular-nums ${tone}`}>{text}</span>
    </li>
  );
}

export default function CompressVideo({ tool }: ToolProps) {
  const caps = useCapabilities();
  const [options, setOptions] = useState<Options>({
    mode: 'size',
    targetMb: 25,
    quality: 'balanced',
    maxShortSide: 0,
    audioBitrate: 128_000,
    codec: 'auto',
  });
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const custom = !SIZE_PRESETS.includes(options.targetMb);
  const codecs: { value: CodecChoice; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    ...(['avc', 'hevc', 'av1'] as const)
      .filter((c) => !caps || caps.videoEncode.includes(c))
      .map((c) => ({ value: c, label: VIDEO_CODEC_LABEL[c].replace(' (H.265)', '') })),
  ];

  return (
    <MediaWorkbench
      job={job}
      log={log}
      options={options}
      accept={tool.accept}
      runLabel="Compress"
      zipName="compressed-videos.zip"
      optionsPanel={(files) => (
        <>
          <OptionField label="Compress by">
            <Segmented
              label="Compress by"
              value={options.mode}
              options={[
                { value: 'size', label: 'Target size' },
                { value: 'quality', label: 'Quality' },
              ]}
              onChange={(v) => set('mode', v)}
            />
          </OptionField>
          {options.mode === 'size' ? (
            <OptionField
              label="Target size per file (MB)"
              htmlFor="cmp-mb"
              hint="Resolution steps down automatically when the size is too small for the current one."
            >
              <Segmented
                label="Target size"
                value={custom ? 0 : options.targetMb}
                options={[...SIZE_PRESETS.map((n) => ({ value: n, label: String(n) })), { value: 0, label: 'Custom' }]}
                onChange={(v) => set('targetMb', v === 0 ? 10 : v)}
              />
              {custom ? (
                <NumberInput id="cmp-mb" value={options.targetMb} onChange={(v) => set('targetMb', v)} min={1} max={10_000} decimals suffix="MB" />
              ) : null}
            </OptionField>
          ) : (
            <VideoQualityField value={options.quality} onChange={(v) => set('quality', v === 'copy' ? 'balanced' : v)} allowCopy={false} />
          )}
          <ResolutionField id="cmp-res" value={options.maxShortSide} onChange={(v) => set('maxShortSide', v)} />
          <OptionField label="Codec" hint="HEVC and AV1 are smaller at the same quality; older devices may not play them. Auto keeps H.264 (VP9 for WebM).">
            <Segmented label="Codec" value={codecs.some((c) => c.value === options.codec) ? options.codec : 'auto'} options={codecs} onChange={(v) => set('codec', v)} />
          </OptionField>
          <OptionField label="Audio">
            <Segmented
              label="Audio bitrate"
              value={options.audioBitrate}
              options={[
                { value: 64_000, label: '64k' },
                { value: 96_000, label: '96k' },
                { value: 128_000, label: '128k' },
              ]}
              onChange={(v) => set('audioBitrate', v)}
            />
          </OptionField>
          {files.length > 0 ? (
            <OptionField label="Estimated size">
              <ul className="flex flex-col gap-1">
                {files.map((f) => (
                  <Estimate key={f.id} input={f} options={options} caps={caps} />
                ))}
              </ul>
            </OptionField>
          ) : null}
          <EngineHint container="mp4" videoCodec={options.codec === 'auto' ? 'auto' : options.codec} />
        </>
      )}
    />
  );
}
