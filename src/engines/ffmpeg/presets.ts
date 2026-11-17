/**
 * ffmpeg argument presets shared by the media tools. Every codec named here
 * is compiled into the @ffmpeg/core single-thread build this app serves.
 */

export type AudioFormat = 'mp3' | 'm4a' | 'aac' | 'ogg' | 'opus' | 'flac' | 'wav';
export type Quality = 'small' | 'balanced' | 'high';

export const AUDIO_FORMATS: Record<AudioFormat, { label: string; lossless: boolean }> = {
  mp3: { label: 'MP3', lossless: false },
  m4a: { label: 'M4A (AAC)', lossless: false },
  aac: { label: 'AAC (ADTS)', lossless: false },
  ogg: { label: 'OGG (Vorbis)', lossless: false },
  opus: { label: 'Opus', lossless: false },
  flac: { label: 'FLAC', lossless: true },
  wav: { label: 'WAV (PCM)', lossless: true },
};

const AUDIO_BITRATE: Record<Quality, string> = { small: '96k', balanced: '160k', high: '256k' };

/** Encoder arguments for an audio output (no input/output names). */
export function audioCodecArgs(format: AudioFormat, quality: Quality): string[] {
  const b = AUDIO_BITRATE[quality];
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', b];
    case 'm4a':
    case 'aac':
      return ['-c:a', 'aac', '-b:a', b];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', b];
    case 'opus':
      // libopus only takes 48/24/16/12/8 kHz input.
      return ['-c:a', 'libopus', '-b:a', b, '-ar', '48000'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
  }
}

export type VideoFormat = 'mp4' | 'webm' | 'mkv' | 'mov' | 'avi';

export const VIDEO_FORMATS: Record<VideoFormat, { label: string }> = {
  mp4: { label: 'MP4 (H.264)' },
  webm: { label: 'WebM (VP8)' },
  mkv: { label: 'MKV (H.264)' },
  mov: { label: 'MOV (H.264)' },
  avi: { label: 'AVI (MPEG-4)' },
};

// H.264 and most players need even dimensions.
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/** Encoder arguments for a video output (no input/output names). */
export function videoCodecArgs(format: VideoFormat, quality: Quality): string[] {
  switch (format) {
    case 'mp4':
    case 'mov':
    case 'mkv': {
      const crf = { small: '28', balanced: '23', high: '18' }[quality];
      const args = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p'];
      args.push('-vf', EVEN, '-c:a', 'aac', '-b:a', '128k');
      if (format !== 'mkv') args.push('-movflags', '+faststart');
      return args;
    }
    case 'webm': {
      // VP8 in realtime mode: VP9 is far too slow in single-thread wasm.
      const [crf, cap] = ({ small: ['30', '1M'], balanced: ['16', '2M'], high: ['8', '4M'] } as const)[quality];
      return [
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-crf', crf, '-b:v', cap,
        '-vf', EVEN, '-c:a', 'libvorbis', '-b:a', '128k',
      ];
    }
    case 'avi': {
      const q = { small: '8', balanced: '5', high: '3' }[quality];
      return ['-c:v', 'mpeg4', '-q:v', q, '-vf', EVEN, '-c:a', 'libmp3lame', '-b:a', '160k'];
    }
  }
}

/** Animated GIF with a per-clip palette. `width` 0 keeps the source width. */
export function gifArgs(width: number, fps: number): string[] {
  const scale = width > 0 ? `scale='min(${width},iw)':-1:flags=lanczos` : 'scale=iw:-1:flags=lanczos';
  return [
    '-vf', `fps=${fps},${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`,
    '-loop', '0',
  ];
}
