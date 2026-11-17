/**
 * Reads what `ffmpeg -i <file>` prints into a MediaInfo, for files the fast
 * engine (Mediabunny) cannot read: AVI, WMV/WMA, FLV, MPEG-PS, OGV (Theora),
 * 3GP with H.263/AMR, AIFF… Pure: no ffmpeg import here.
 */
import type { MediaInfo, VideoCodecId } from './types';

const VIDEO_IDS: Record<string, VideoCodecId | 'prores'> = {
  h264: 'avc',
  hevc: 'hevc',
  vp8: 'vp8',
  vp9: 'vp9',
  av1: 'av1',
  prores: 'prores',
};

const VIDEO_LABELS: Record<string, string> = {
  mpeg4: 'MPEG-4 Part 2',
  msmpeg4v2: 'MS MPEG-4 v2',
  msmpeg4v3: 'MS MPEG-4 v3 (DivX 3)',
  wmv1: 'WMV7',
  wmv2: 'WMV8',
  wmv3: 'WMV9',
  vc1: 'VC-1',
  flv1: 'Sorenson Spark (FLV1)',
  h263: 'H.263',
  mpeg1video: 'MPEG-1',
  mpeg2video: 'MPEG-2',
  theora: 'Theora',
  mjpeg: 'Motion JPEG',
  dvvideo: 'DV',
  rv40: 'RealVideo 4',
};

const AUDIO_LABELS: Record<string, string> = {
  wmav1: 'WMA v1',
  wmav2: 'WMA v2',
  wmapro: 'WMA Pro',
  amr_nb: 'AMR-NB',
  amr_wb: 'AMR-WB',
  mp2: 'MP2',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  alac: 'ALAC',
  adpcm_ima_wav: 'IMA ADPCM',
  adpcm_ms: 'MS ADPCM',
};

/** Seconds from "HH:MM:SS.cc". */
function hms(text: string): number {
  const [h, m, s] = text.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function channelCount(text: string): number {
  if (/\bmono\b/.test(text)) return 1;
  if (/\bstereo\b/.test(text)) return 2;
  const n = /(\d+) channels/.exec(text);
  if (n) return Number(n[1]);
  const layout = /\b(\d)\.(\d)(\(\w+\))?\b/.exec(text);
  if (layout) return Number(layout[1]) + Number(layout[2]);
  return 2;
}

/**
 * Builds a MediaInfo (`readable: false`, `engine: 'ffmpeg'`) from the log of
 * `ffmpeg -i`. Null when ffmpeg did not recognise the input either.
 */
export function parseFfmpegProbe(log: string[], size: number): MediaInfo | null {
  const text = log.join('\n');
  const input = /Input #0, ([^,]+(?:,[^,]+)*?), from/.exec(text);
  if (!input) return null;
  const names = input[1]!.split(',').map((n) => n.trim());
  // The ISO family reports itself as "mov,mp4,m4a,3gp,3g2,mj2".
  const format = names.length > 1 && names.includes('mp4') ? 'MP4 / 3GP' : names[0]!;
  const dur = /Duration: (\d+:\d+:\d+(?:\.\d+)?)(?:, start: (-?[\d.]+))?(?:, bitrate: (\d+) kb\/s)?/.exec(text);
  const duration = dur ? hms(dur[1]!) : 0;
  const startTime = dur?.[2] ? Math.max(0, Number(dur[2])) : 0;
  const totalBitrate = dur?.[3] ? Number(dur[3]) * 1000 : null;

  let video: MediaInfo['video'] = null;
  let audio: MediaInfo['audio'] = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const v = /Stream #0:\d+.*?: Video: (\w+)(.*)$/.exec(line);
    if (v && !video && !/attached pic/.test(line)) {
      const codec = v[1]!;
      const rest = v[2]!;
      const size = /, (\d{2,5})x(\d{2,5})/.exec(rest);
      const fps = /, ([\d.]+) fps/.exec(rest) ?? /, ([\d.]+) tbr/.exec(rest);
      const br = /, (\d+) kb\/s/.exec(rest);
      const dar = /DAR (\d+):(\d+)/.exec(rest);
      let rotation: 0 | 90 | 180 | 270 = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 8) && !/Stream #/.test(lines[j]!); j++) {
        const rot = /rotation of (-?[\d.]+) degrees/.exec(lines[j]!);
        if (rot) rotation = ((((-Math.round(Number(rot[1]) / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
      }
      const cw = size ? Number(size[1]) : 0;
      const ch = size ? Number(size[2]) : 0;
      // Display width from the display aspect ratio (anamorphic MPEG-2, DV).
      const dw = dar && ch ? Math.round((ch * Number(dar[1])) / Number(dar[2]) / 2) * 2 : cw;
      const turned = rotation === 90 || rotation === 270;
      video = {
        codec: VIDEO_IDS[codec] ?? null,
        label: VIDEO_IDS[codec] ? undefined : (VIDEO_LABELS[codec] ?? codec.toUpperCase()),
        codedWidth: cw,
        codedHeight: ch,
        width: turned ? ch : dw,
        height: turned ? dw : ch,
        rotation,
        fps: fps ? Number(fps[1]) : null,
        bitrate: br ? Number(br[1]) * 1000 : null,
        canDecode: false,
      };
      continue;
    }
    const a = /Stream #0:\d+.*?: Audio: (\w+)(.*)$/.exec(line);
    if (a && !audio) {
      const codec = a[1]!;
      const rest = a[2]!;
      const rate = /, (\d+) Hz/.exec(rest);
      const br = /, (\d+) kb\/s/.exec(rest);
      audio = {
        codec,
        label: AUDIO_LABELS[codec],
        sampleRate: rate ? Number(rate[1]) : 0,
        channels: channelCount(rest),
        bitrate: br ? Number(br[1]) * 1000 : null,
        canDecode: false,
      };
    }
  }
  if (!video && !audio) return null;
  // Containers that do not state a per-stream bitrate (MPEG-PS, ASF): what is left after the audio.
  if (video && !video.bitrate && totalBitrate) {
    video.bitrate = Math.max(100_000, totalBitrate - (audio?.bitrate ?? 128_000));
  }
  return {
    readable: false,
    engine: 'ffmpeg',
    format: format.toUpperCase(),
    reason: 'Read by the software engine (ffmpeg.wasm).',
    duration: Math.max(0, duration),
    startTime,
    size,
    video,
    audio,
  };
}
