'use client';

import { Segmented } from '@/components/kit/segmented';
import { OptionField, OptionSelect } from '@/components/workbench';
import {
  type Capabilities,
  CONTAINERS,
  type Container,
  VIDEO_CODEC_LABEL,
  type VideoCodecId,
  type VideoQuality,
} from '@/engines/media';

/** Codecs offered for a container: the ones this browser can encode, plus Auto. */
export function videoCodecChoices(container: Container, caps: Capabilities | null): { value: VideoCodecId | 'auto'; label: string }[] {
  const list = CONTAINERS[container].video.filter((c) => !caps || caps.videoEncode.includes(c));
  return [
    { value: 'auto', label: 'Auto (best supported)' },
    ...list.map((c) => ({ value: c, label: VIDEO_CODEC_LABEL[c] })),
  ];
}

/** The codec to use when the stored choice is not valid for the container. */
export function effectiveCodec(
  container: Container,
  caps: Capabilities | null,
  codec: VideoCodecId | 'auto',
): VideoCodecId | 'auto' {
  return videoCodecChoices(container, caps).some((c) => c.value === codec) ? codec : 'auto';
}

export const RESOLUTIONS = [
  { value: '0', label: 'Original size' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
] as const;

export const FRAME_RATES = [
  { value: 0, label: 'Original' },
  { value: 60, label: '60' },
  { value: 30, label: '30' },
  { value: 24, label: '24' },
] as const;

export const AUDIO_BITRATES = [
  { value: '96000', label: '96 kbps' },
  { value: '128000', label: '128 kbps' },
  { value: '160000', label: '160 kbps' },
  { value: '192000', label: '192 kbps' },
  { value: '256000', label: '256 kbps' },
  { value: '320000', label: '320 kbps' },
] as const;

export function VideoQualityField({
  value,
  onChange,
  allowCopy = true,
}: {
  value: VideoQuality;
  onChange: (v: VideoQuality) => void;
  allowCopy?: boolean;
}) {
  const options: { value: VideoQuality; label: string }[] = [
    ...(allowCopy ? [{ value: 'copy' as const, label: 'Copy' }] : []),
    { value: 'small', label: 'Smaller' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'high', label: 'Higher' },
  ];
  return (
    <OptionField
      label="Quality"
      hint={
        allowCopy
          ? 'Copy keeps streams untouched when they fit the new format (fast, lossless). Bitrates never exceed the source’s.'
          : 'Bitrates never exceed the source’s.'
      }
    >
      <Segmented label="Quality" value={value} options={options} onChange={onChange} />
    </OptionField>
  );
}

export function ResolutionField({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  return (
    <OptionField label="Resolution" htmlFor={id} hint="Downscales only; smaller videos keep their size.">
      <OptionSelect
        id={id}
        value={String(value) as (typeof RESOLUTIONS)[number]['value']}
        options={RESOLUTIONS}
        onChange={(v) => onChange(Number(v))}
      />
    </OptionField>
  );
}

export function FrameRateField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <OptionField label="Frame rate cap" hint="Lowers the frame rate only; it is never raised.">
      <Segmented
        label="Frame rate"
        value={value}
        options={FRAME_RATES.map((f) => ({ value: f.value as number, label: f.label }))}
        onChange={onChange}
      />
    </OptionField>
  );
}

const ALL_RATES = [48000, 44100, 32000, 24000, 22050, 16000] as const;

/** Sample rates offered for an output format (0 = keep the source's). Opus is always 48 kHz. */
export function sampleRateChoices(container: Container): { value: number; label: string }[] {
  const rates: readonly number[] =
    container === 'opus' || container === 'webm'
      ? []
      : container === 'm4a' || container === 'aac' || container === 'mp4' || container === 'mov' || container === 'mkv' || container === 'ts'
        ? [48000, 44100]
        : ALL_RATES;
  return [{ value: 0, label: 'Original' }, ...rates.map((r) => ({ value: r, label: `${r / 1000} kHz` }))];
}

export function SampleRateField({
  id,
  format,
  value,
  onChange,
}: {
  id: string;
  format: Container;
  value: number;
  onChange: (v: number) => void;
}) {
  const choices = sampleRateChoices(format);
  if (choices.length === 1) {
    return (
      <OptionField label="Sample rate">
        <p className="text-[0.7rem]/relaxed text-muted-foreground">Opus always plays at 48 kHz.</p>
      </OptionField>
    );
  }
  return (
    <OptionField label="Sample rate" htmlFor={id} hint="Lower rates make smaller files; 44.1 or 48 kHz for music.">
      <OptionSelect
        id={id}
        value={String(value)}
        options={choices.map((c) => ({ value: String(c.value), label: c.label }))}
        onChange={(v) => onChange(Number(v))}
      />
    </OptionField>
  );
}

export function AudioChannelsField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <OptionField label="Channels" hint="Mono mixes the channels together.">
      <Segmented
        label="Channels"
        value={value}
        options={[
          { value: 0, label: 'Original' },
          { value: 2, label: 'Stereo' },
          { value: 1, label: 'Mono' },
        ]}
        onChange={onChange}
      />
    </OptionField>
  );
}

export function AudioBitrateField({
  id,
  value,
  onChange,
  allowCopy,
}: {
  id: string;
  value: number | 'copy';
  onChange: (v: number | 'copy') => void;
  allowCopy?: boolean;
}) {
  const options = [...(allowCopy ? [{ value: 'copy', label: 'Copy (no re-encode when possible)' }] : []), ...AUDIO_BITRATES];
  return (
    <OptionField label="Audio bitrate" htmlFor={id} hint="Never above a lossy source’s bitrate.">
      <OptionSelect
        id={id}
        value={String(value)}
        options={options as { value: string; label: string }[]}
        onChange={(v) => onChange(v === 'copy' ? 'copy' : Number(v))}
      />
    </OptionField>
  );
}
