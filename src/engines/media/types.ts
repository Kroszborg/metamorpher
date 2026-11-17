/**
 * Types shared by the media engine, its worker and the tools. Plain data only:
 * everything here crosses the worker boundary by structured clone.
 */

export type VideoCodecId = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1';
export type AudioCodecId = 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm' | 'vorbis';

/** Output containers. `avi` and `ogg` (Vorbis) are written by ffmpeg.wasm only. */
export type Container =
  | 'mp4'
  | 'mov'
  | 'mkv'
  | 'webm'
  | 'avi'
  | 'ts'
  | 'mp3'
  | 'm4a'
  | 'aac'
  | 'ogg'
  | 'opus'
  | 'flac'
  | 'wav';

/** What the engine learned about a file without decoding it. */
export type MediaInfo = {
  /** False when Mediabunny cannot read the container (AVI, WMV, FLV, MPEG-PS, AIFF…). */
  readable: boolean;
  /** Why it is not readable, for the UI. */
  reason?: string;
  /** Container name as Mediabunny reports it ("MP4", "Matroska"…). */
  format?: string;
  /** Seconds from the first to the last timestamp. 0 when unknown. */
  duration: number;
  /** Timestamp of the first frame or sample (non-zero in some MPEG-TS and edited MP4 files). Trim times are relative to it. */
  startTime: number;
  size: number;
  video: VideoInfo | null;
  audio: AudioInfo | null;
};

export type VideoInfo = {
  codec: VideoCodecId | 'prores' | null;
  /** Coded size, before rotation. */
  codedWidth: number;
  codedHeight: number;
  /** Display size, after pixel aspect ratio and rotation. */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** Best-guess frame rate, or null when it could not be measured. */
  fps: number | null;
  /** Average bits per second, measured from the packets when the file does not say. */
  bitrate: number | null;
  canDecode: boolean;
};

export type AudioInfo = {
  codec: string | null;
  sampleRate: number;
  channels: number;
  bitrate: number | null;
  canDecode: boolean;
};

/**
 * Quality presets. `copy` keeps the encoded stream untouched when it fits the
 * output (fast and lossless) and otherwise behaves like `balanced`.
 */
export type VideoQuality = 'copy' | 'small' | 'balanced' | 'high';

export type VideoRequest = {
  discard?: boolean;
  /** 'auto' picks the first codec this browser can encode for the container. */
  codec?: VideoCodecId | 'auto';
  quality?: VideoQuality;
  /** Explicit target bits per second (compress to size). Wins over `quality`. */
  bitrate?: number;
  /** Downscale so the short side is at most this many pixels. Never upscales. */
  maxShortSide?: number;
  /** Cap the frame rate. Never raises it. */
  maxFps?: number;
};

export type AudioRequest = {
  discard?: boolean;
  codec?: AudioCodecId | 'auto';
  /** Bits per second, or 'copy' to keep the stream when it fits the output. */
  bitrate?: number | 'copy';
  sampleRate?: number;
  channels?: number;
};

export type ConvertRequest = {
  container: Container;
  video?: VideoRequest;
  audio?: AudioRequest;
  /** Seconds in the input's timeline. `accurate: false` cuts at key frames without re-encoding. */
  trim?: { start: number; end: number; accurate: boolean };
  /** Playback speed factor (0.25–4). Audio keeps its pitch when `keepPitch`. */
  speed?: { factor: number; keepPitch: boolean };
};

export type GifRequest = {
  fps: number;
  /** Output width in pixels; 0 keeps the source width. Never upscales. */
  width: number;
  /** Colours per frame (palette size). */
  colors: 256 | 128 | 64 | 32;
  start: number;
  end: number;
};

export type GifToVideoRequest = {
  container: 'mp4' | 'webm';
  codec: VideoCodecId | 'auto';
  quality: Exclude<VideoQuality, 'copy'>;
};

export type MergeRequest = {
  container: Container;
  quality: Exclude<VideoQuality, 'copy'>;
  /** Audio bitrate for re-encoded audio. */
  audioBitrate: number;
};

export type EngineName = 'mediabunny' | 'ffmpeg';

/**
 * Why the job left the fast path. Shown to the user as
 * "WebCodecs cannot <message> here, using the slower software engine".
 */
export type FallbackReason = {
  code:
    | 'container-read'
    | 'container-write'
    | 'video-decode'
    | 'video-encode'
    | 'audio-decode'
    | 'audio-encode'
    | 'image-decode'
    | 'webcodecs-error';
  message: string;
};

/** What happened to one job, for the engine log the media tools show. */
export type MediaReport = {
  engine: EngineName;
  /** "Mediabunny · WebCodecs" or "ffmpeg.wasm (software)". */
  engineLabel: string;
  fallback?: FallbackReason;
  /** "Copied (H.264 1920×1080)" or "Re-encoded to VP9 1280×720 at 2.1 Mbps". */
  video?: string;
  audio?: string;
  notes: string[];
  ms: number;
};

export type MediaResult = { blob: Blob; ext: string; report: MediaReport };

/** What the worker hands back: a finished file, or a reason to use ffmpeg instead. */
export type WorkerOutcome = (
  | { ok: true; blob: Blob; ext: string; video?: string; audio?: string; notes: string[] }
  | { ok: false; fallback: FallbackReason }
) & {
  /** The worker registered an encoder that would shadow a native one; start a fresh worker for the next job. */
  recycle?: boolean;
};

export type Capabilities = {
  videoEncode: VideoCodecId[];
  audioEncode: AudioCodecId[];
  /** Encoders that come from bundled WASM rather than the browser (slower, but still on the fast path). */
  wasmAudio: AudioCodecId[];
  imageDecoder: boolean;
};
