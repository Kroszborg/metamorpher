/**
 * Pure helpers shared by the media engine (main thread and worker) and the
 * tools: containers, codec labels, the bitrate model and size estimates.
 * No Mediabunny import here so the tools can use it without loading it.
 */
import type { AudioCodecId, Container, MediaInfo, VideoCodecId, VideoInfo, VideoQuality } from './types';

export type ContainerInfo = {
  label: string;
  ext: string;
  kind: 'video' | 'audio';
  /** Mediabunny can write it. AVI and Ogg Vorbis need ffmpeg.wasm. */
  mediabunny: boolean;
  /** Codecs we encode into it, in order of preference. */
  video: VideoCodecId[];
  audio: AudioCodecId[];
};

export const CONTAINERS: Record<Container, ContainerInfo> = {
  mp4: { label: 'MP4', ext: 'mp4', kind: 'video', mediabunny: true, video: ['avc', 'hevc', 'av1', 'vp9'], audio: ['aac'] },
  mov: { label: 'MOV', ext: 'mov', kind: 'video', mediabunny: true, video: ['avc', 'hevc'], audio: ['aac'] },
  mkv: { label: 'MKV', ext: 'mkv', kind: 'video', mediabunny: true, video: ['avc', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus'] },
  webm: { label: 'WebM', ext: 'webm', kind: 'video', mediabunny: true, video: ['vp9', 'vp8', 'av1'], audio: ['opus'] },
  avi: { label: 'AVI', ext: 'avi', kind: 'video', mediabunny: false, video: [], audio: ['mp3'] },
  ts: { label: 'MPEG-TS', ext: 'ts', kind: 'video', mediabunny: true, video: ['avc', 'hevc'], audio: ['aac'] },
  mp3: { label: 'MP3', ext: 'mp3', kind: 'audio', mediabunny: true, video: [], audio: ['mp3'] },
  m4a: { label: 'M4A (AAC)', ext: 'm4a', kind: 'audio', mediabunny: true, video: [], audio: ['aac'] },
  aac: { label: 'AAC (ADTS)', ext: 'aac', kind: 'audio', mediabunny: true, video: [], audio: ['aac'] },
  ogg: { label: 'OGG (Vorbis)', ext: 'ogg', kind: 'audio', mediabunny: false, video: [], audio: ['vorbis'] },
  opus: { label: 'Opus', ext: 'opus', kind: 'audio', mediabunny: true, video: [], audio: ['opus'] },
  flac: { label: 'FLAC', ext: 'flac', kind: 'audio', mediabunny: true, video: [], audio: ['flac'] },
  wav: { label: 'WAV (PCM)', ext: 'wav', kind: 'audio', mediabunny: true, video: [], audio: ['pcm'] },
};

export const VIDEO_CODEC_LABEL: Record<VideoCodecId, string> = {
  avc: 'H.264',
  hevc: 'HEVC (H.265)',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
};

export const AUDIO_CODEC_LABEL: Record<string, string> = {
  aac: 'AAC',
  opus: 'Opus',
  mp3: 'MP3',
  flac: 'FLAC',
  pcm: 'PCM',
  vorbis: 'Vorbis',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
};

export function audioCodecLabel(codec: string | null | undefined): string {
  if (!codec) return 'unknown audio';
  if (codec.startsWith('pcm') || codec === 'ulaw' || codec === 'alaw') return 'PCM';
  return AUDIO_CODEC_LABEL[codec] ?? codec.toUpperCase();
}

export function videoCodecLabel(codec: string | null | undefined): string {
  if (!codec) return 'unknown video';
  return VIDEO_CODEC_LABEL[codec as VideoCodecId] ?? codec.toUpperCase();
}

/** Lossless audio codecs: never capped by the source bitrate, never used for "copy if smaller". */
export function isLosslessAudio(codec: string | null | undefined): boolean {
  return !!codec && (codec === 'flac' || codec.startsWith('pcm') || codec === 'alac');
}

/** The container an input extension maps to when a tool keeps "the same format". */
export function containerForExtension(ext: string): Container | null {
  switch (ext) {
    case 'mp4':
    case 'm4v':
    case '3gp':
      return 'mp4';
    case 'mov':
      return 'mov';
    case 'mkv':
      return 'mkv';
    case 'webm':
      return 'webm';
    case 'ts':
      return 'ts';
    case 'avi':
      return 'avi';
    case 'mp3':
      return 'mp3';
    case 'm4a':
      return 'm4a';
    case 'aac':
      return 'aac';
    case 'ogg':
    case 'oga':
      return 'ogg';
    case 'opus':
      return 'opus';
    case 'flac':
      return 'flac';
    case 'wav':
      return 'wav';
    default:
      return null;
  }
}

/** Bits per pixel per frame for H.264; other codecs scale by CODEC_EFFICIENCY. */
const BPP: Record<Exclude<VideoQuality, 'copy'>, number> = { small: 0.045, balanced: 0.075, high: 0.11 };
const CODEC_EFFICIENCY: Record<VideoCodecId, number> = { avc: 1, hevc: 0.65, vp9: 0.65, av1: 0.55, vp8: 1.1 };

export const MIN_VIDEO_BITRATE = 120_000;

/** The bitrate a quality preset asks for at a given size and frame rate. */
export function presetVideoBitrate(
  quality: VideoQuality,
  codec: VideoCodecId,
  width: number,
  height: number,
  fps: number,
): number {
  const bpp = BPP[quality === 'copy' ? 'balanced' : quality];
  const raw = bpp * CODEC_EFFICIENCY[codec] * width * height * Math.min(Math.max(fps, 1), 60);
  return Math.round(Math.min(Math.max(raw, MIN_VIDEO_BITRATE), 60_000_000));
}

/** Rounds to an even number of at least 2 (most encoders need even sizes). */
export function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * Output display size for a "short side at most" limit. Never upscales; the
 * result is always even.
 */
export function fitShortSide(width: number, height: number, maxShortSide?: number): { width: number; height: number; scaled: boolean } {
  const short = Math.min(width, height);
  if (!maxShortSide || short <= maxShortSide) return { width: even(width), height: even(height), scaled: false };
  const k = maxShortSide / short;
  return { width: even(width * k), height: even(height * k), scaled: true };
}

/** Output frame rate for a cap. Never raises it. */
export function capFps(fps: number | null, maxFps?: number): number | undefined {
  if (!maxFps) return undefined;
  if (fps !== null && fps <= maxFps + 0.01) return undefined;
  return maxFps;
}

export type VideoPlan = {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  /** Set when the preset would have exceeded the source bitrate and was lowered to it. */
  cappedAt?: number;
};

/**
 * The size, frame rate and bitrate a video track is re-encoded at. The
 * bitrate never exceeds the source's (re-encoding cannot add detail).
 */
export function planVideo(
  info: Pick<VideoInfo, 'width' | 'height' | 'fps' | 'bitrate'>,
  codec: VideoCodecId,
  req: { quality?: VideoQuality; bitrate?: number; maxShortSide?: number; maxFps?: number },
): VideoPlan {
  const { width, height } = fitShortSide(info.width, info.height, req.maxShortSide);
  const fps = capFps(info.fps, req.maxFps) ?? info.fps ?? 30;
  let bitrate = req.bitrate ?? presetVideoBitrate(req.quality ?? 'balanced', codec, width, height, fps);
  let cappedAt: number | undefined;
  if (info.bitrate && bitrate > info.bitrate && !req.bitrate) {
    bitrate = Math.max(MIN_VIDEO_BITRATE, Math.round(info.bitrate));
    cappedAt = bitrate;
  }
  return { width, height, fps, bitrate, cappedAt };
}

/** Common audio bitrates, high to low. */
export const COMMON_AUDIO_BITRATES = [320_000, 256_000, 192_000, 160_000, 128_000, 112_000, 96_000, 80_000, 64_000, 48_000, 32_000];

/**
 * The bitrate asked for before the "never raise" cap: an explicit number, or
 * for 'copy' (when the stream has to be re-encoded after all) the source's
 * own rate, which the cap brings 320 kbps down to. Unset means 160 kbps.
 */
export function audioBitrateWanted(bitrate: number | 'copy' | undefined): number {
  return typeof bitrate === 'number' ? bitrate : bitrate === 'copy' ? 320_000 : 160_000;
}

/** The container a tool that keeps "the same format" writes for an input. */
export function sameContainer(ext: string, hasVideo: boolean): Container {
  const c = containerForExtension(ext);
  if (c && (CONTAINERS[c].kind === 'video') === hasVideo) return c;
  if (hasVideo) return 'mp4';
  if (c === 'mp4' || c === 'mov') return 'm4a';
  if (c === 'webm' || c === 'mkv') return 'opus';
  return ext === 'aiff' || ext === 'aif' ? 'wav' : 'mp3';
}

/** Audio bitrate after the "never raise" rule: capped at a lossy source's bitrate. */
export function planAudioBitrate(
  wanted: number,
  source: { codec: string | null; bitrate: number | null } | null,
): { bitrate: number; cappedAt?: number } {
  if (!source || !source.bitrate || isLosslessAudio(source.codec)) return { bitrate: wanted };
  // The highest common bitrate the source reaches (5% slack, so a 127.9k MP3 still allows 128k).
  const ceiling = COMMON_AUDIO_BITRATES.find((b) => b <= source.bitrate! * 1.05) ?? 32_000;
  return wanted > ceiling ? { bitrate: ceiling, cappedAt: ceiling } : { bitrate: wanted };
}

export function formatBitrate(bps: number): string {
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

/** Seconds as m:ss.mmm (or h:mm:ss.mmm). */
export function formatTime(seconds: number, decimals = 2): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = s.toFixed(decimals).padStart(decimals > 0 ? decimals + 3 : 2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Parses "1:02.5", "62.5" or "1:01:02" into seconds; null when invalid. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    if (!/^\d*(\.\d*)?$/.test(p) || p === '' || p === '.') return null;
    total = total * 60 + Number(p);
  }
  return Number.isFinite(total) ? total : null;
}

export type CompressSettings = {
  mode: 'size' | 'quality';
  /** Size mode: the whole output file, in bytes. */
  targetBytes: number;
  quality: Exclude<VideoQuality, 'copy'>;
  /** Short-side cap in pixels; 0 keeps the size (size mode may still lower it). */
  maxShortSide: number;
  audioBitrate: number;
  codec: VideoCodecId;
};

export type CompressPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Video bitrate (size mode) or quality preset, and the short-side cap. */
      video: { bitrate?: number; quality?: Exclude<VideoQuality, 'copy'>; maxShortSide?: number };
      audioBitrate: number;
      /** Expected output size in bytes. */
      estimate: number;
      notes: string[];
    };

/** Container overhead and encoder slack kept free under a target size. */
const SIZE_MARGIN = 0.96;
/** Below this many bits per pixel (H.264-equivalent) video turns to mush: drop the resolution instead. */
const MIN_BPP = 0.04;
const SHORT_SIDES = [1080, 720, 540, 480, 360, 240];

/**
 * Settings for compressing one video: the bitrate that fits a target size
 * (stepping the resolution down when that bitrate would be too thin for the
 * current one), or a quality preset with its expected size. Never asks for
 * more than the source has.
 */
export function planCompress(info: MediaInfo, s: CompressSettings): CompressPlan {
  const v = info.video;
  if (!v) return { ok: false, error: 'This file has no video track.' };
  const duration = info.duration;
  if (!(duration > 0)) return { ok: false, error: 'The length of this video could not be read.' };
  const audio = info.audio ? planAudioBitrate(s.audioBitrate, info.audio).bitrate : 0;
  const notes: string[] = [];
  const eff = CODEC_EFFICIENCY[s.codec];

  if (s.mode === 'quality') {
    const plan = planVideo(v, s.codec, { quality: s.quality, maxShortSide: s.maxShortSide || undefined });
    const estimate = Math.round(((plan.bitrate + audio) * duration) / 8 / 0.98);
    return { ok: true, video: { quality: s.quality, maxShortSide: s.maxShortSide || undefined }, audioBitrate: audio, estimate, notes };
  }

  if (s.targetBytes >= info.size) {
    return { ok: false, error: `This video is already ${formatSize(info.size)}, under the ${formatSize(s.targetBytes)} target.` };
  }
  const videoBitrate = Math.floor((s.targetBytes * 8 * SIZE_MARGIN) / duration - audio);
  if (videoBitrate < MIN_VIDEO_BITRATE) {
    const least = Math.ceil(((MIN_VIDEO_BITRATE + audio) * duration) / 8 / SIZE_MARGIN);
    return {
      ok: false,
      error: `${formatSize(s.targetBytes)} is too small for ${formatTime(duration, 0)} of video; the smallest useful target is about ${formatSize(least)}.`,
    };
  }
  const fps = Math.min(v.fps ?? 30, 60);
  let maxShortSide = s.maxShortSide || undefined;
  let shape = fitShortSide(v.width, v.height, maxShortSide);
  const bpp = (w: number, h: number) => videoBitrate / (w * h * fps * eff);
  if (bpp(shape.width, shape.height) < MIN_BPP) {
    for (const side of SHORT_SIDES) {
      if (side >= Math.min(shape.width, shape.height)) continue;
      const next = fitShortSide(v.width, v.height, side);
      maxShortSide = side;
      shape = next;
      if (bpp(next.width, next.height) >= MIN_BPP) break;
    }
    notes.push(`Scaled to ${shape.width}×${shape.height} so the picture stays clean at this size.`);
  }
  return {
    ok: true,
    video: { bitrate: videoBitrate, maxShortSide },
    audioBitrate: audio,
    estimate: s.targetBytes,
    notes,
  };
}

function formatSize(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
