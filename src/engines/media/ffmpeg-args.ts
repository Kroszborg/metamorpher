/**
 * ffmpeg.wasm argument lists for the fallback path. They mirror what the
 * Mediabunny path does (same sizes, bitrate caps and speed handling) with the
 * codecs the single-thread core has: libx264, libvpx (VP8), mpeg4, aac,
 * libmp3lame, libopus, libvorbis, flac and PCM.
 */
import { gifArgs } from '@/engines/ffmpeg/presets';
import { CONTAINERS, audioBitrateWanted, audioCodecLabel, formatBitrate, planAudioBitrate, planVideo } from './presets';
import type { ConvertRequest, GifRequest, MediaInfo, MergeRequest } from './types';

export type FfmpegPlan = {
  /** Arguments before `-i <input>` (input seeking). */
  pre: string[];
  post: string[];
  ext: string;
  video?: string;
  audio?: string;
  notes: string[];
};

const CRF: Record<string, string> = { small: '28', balanced: '23', high: '19', copy: '21' };

/** Scale to an even size, downscaling so the short side is at most `max`. ffmpeg auto-rotates first. */
function scaleFilter(max?: number): string {
  if (!max) return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return `scale='if(gte(iw,ih),-2,trunc(min(${max},iw)/2)*2)':'if(gte(iw,ih),trunc(min(${max},ih)/2)*2,-2)'`;
}

function atempoChain(factor: number): string {
  const parts: string[] = [];
  let f = factor;
  while (f > 2) {
    parts.push('atempo=2');
    f /= 2;
  }
  while (f < 0.5) {
    parts.push('atempo=0.5');
    f /= 0.5;
  }
  parts.push(`atempo=${f.toFixed(5)}`);
  return parts.join(',');
}

function audioEncoder(container: string, bitrate: number): { args: string[]; label: string } {
  const b = `${Math.round(bitrate / 1000)}k`;
  switch (container) {
    case 'mp3':
    case 'avi':
      return { args: ['-c:a', 'libmp3lame', '-b:a', b], label: `MP3 ${formatBitrate(bitrate)}` };
    case 'opus':
      // This core's libopus crashes on stereo input, so the engine normally decodes with ffmpeg
      // and encodes Opus with WebCodecs instead (decodeThenEncode in ./index.ts).
      return { args: ['-c:a', 'libopus', '-b:a', b, '-ac', '1', '-ar', '48000'], label: `Opus ${formatBitrate(bitrate)} mono` };
    case 'webm':
    case 'ogg':
      return { args: ['-c:a', 'libvorbis', '-b:a', b], label: `Vorbis ${formatBitrate(bitrate)}` };
    case 'flac':
      return { args: ['-c:a', 'flac'], label: 'FLAC' };
    case 'wav':
      return { args: ['-c:a', 'pcm_s16le'], label: 'PCM 16-bit' };
    default:
      return { args: ['-c:a', 'aac', '-b:a', b], label: `AAC ${formatBitrate(bitrate)}` };
  }
}

/** Whether ffmpeg can stream-copy a codec into a container (rough, conservative). */
function copyFits(container: string, codec: string | null | undefined, kind: 'video' | 'audio'): boolean {
  if (!codec) return false;
  if (container === 'mkv') return true;
  if (kind === 'video') {
    if (container === 'webm') return ['vp8', 'vp9', 'av1'].includes(codec);
    if (container === 'mp4' || container === 'mov') return ['avc', 'hevc', 'av1', 'vp9'].includes(codec);
    if (container === 'ts') return ['avc', 'hevc'].includes(codec);
    return false;
  }
  const allowed: Record<string, string[]> = {
    mp4: ['aac', 'mp3', 'opus', 'flac'],
    mov: ['aac', 'mp3'],
    webm: ['opus', 'vorbis'],
    ts: ['aac', 'mp3'],
    mp3: ['mp3'],
    m4a: ['aac'],
    aac: ['aac'],
    ogg: ['vorbis'],
    opus: ['opus'],
    flac: ['flac'],
  };
  return (allowed[container] ?? []).includes(codec);
}

/**
 * `sameContainer`: the output container is the input's own, so streams can be
 * copied even when their codecs are unknown (inputs Mediabunny cannot read).
 */
export function convertPlan(req: ConvertRequest, info: MediaInfo | null, sameContainer = false): FfmpegPlan {
  const c = CONTAINERS[req.container];
  const pre: string[] = [];
  const post: string[] = [];
  const notes: string[] = [];
  let video: string | undefined;
  let audio: string | undefined;
  const speed = req.speed && Math.abs(req.speed.factor - 1) > 1e-3 ? req.speed : undefined;
  const fastTrim = req.trim && !req.trim.accurate;

  if (req.trim) {
    pre.push('-ss', req.trim.start.toFixed(3), '-to', req.trim.end.toFixed(3));
  }

  // Video
  const keepVideo = c.kind === 'video' && !req.video?.discard && info?.video !== null;
  if (!keepVideo) {
    post.push('-vn');
  } else {
    const vr = req.video ?? {};
    const copy =
      !speed && !vr.maxShortSide && !vr.maxFps && !vr.bitrate &&
      (vr.quality === 'copy' || fastTrim) &&
      (copyFits(req.container, info?.video?.codec, 'video') || (sameContainer && !info));
    if (copy) {
      post.push('-c:v', 'copy');
      video = 'Copied without re-encoding';
    } else {
      const filters = [scaleFilter(vr.maxShortSide)];
      if (speed) filters.push(`setpts=PTS/${speed.factor}`);
      const plan = info?.video ? planVideo(info.video, 'avc', vr) : null;
      if (plan?.cappedAt) notes.push(`Video bitrate held at the source's ${formatBitrate(plan.cappedAt)}.`);
      const quality = vr.quality ?? 'balanced';
      if (req.container === 'webm') {
        const rate = plan?.bitrate ?? { small: 1e6, balanced: 2e6, high: 4e6, copy: 2e6 }[quality];
        post.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', String(Math.round(rate)), '-crf', '10');
        video = `Re-encoded to VP8 at ${formatBitrate(rate)}`;
        if (vr.codec && vr.codec !== 'auto' && vr.codec !== 'vp8') notes.push(`The software engine writes VP8 instead of ${vr.codec.toUpperCase()}.`);
      } else if (req.container === 'avi') {
        const q = { small: '8', balanced: '5', high: '3', copy: '4' }[quality];
        post.push('-c:v', 'mpeg4', '-q:v', q);
        video = 'Re-encoded to MPEG-4 Part 2';
      } else {
        post.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
        if (plan) {
          post.push('-b:v', String(plan.bitrate), '-maxrate', String(Math.round(plan.bitrate * 1.5)), '-bufsize', String(plan.bitrate * 2));
          video = `Re-encoded to H.264 at ${formatBitrate(plan.bitrate)}`;
        } else {
          post.push('-crf', CRF[quality] ?? '23');
          video = 'Re-encoded to H.264';
        }
        if (vr.codec && vr.codec !== 'auto' && vr.codec !== 'avc') notes.push(`The software engine writes H.264 instead of ${vr.codec.toUpperCase()}.`);
      }
      post.push('-vf', filters.join(','));
      if (vr.maxFps) post.push('-fpsmax', String(vr.maxFps));
      if (speed && speed.factor > 1 && info?.video?.fps) post.push('-fpsmax', String(Math.round(info.video.fps)));
    }
  }

  // Audio
  const keepAudio = !req.audio?.discard && info?.audio !== null;
  if (!keepAudio) {
    post.push('-an');
  } else {
    const ar = req.audio ?? {};
    const copy = !speed && !ar.sampleRate && !ar.channels && (ar.bitrate === 'copy' || fastTrim) &&
      (copyFits(req.container, info?.audio?.codec, 'audio') || (sameContainer && !info));
    if (copy) {
      post.push('-c:a', 'copy');
      audio = `Copied ${audioCodecLabel(info?.audio?.codec)} without re-encoding`;
    } else {
      // 'copy' means "the source's bitrate"; when it is unknown (unreadable input), 192 kbps.
      const wanted = ar.bitrate === 'copy' && !info?.audio ? 192_000 : audioBitrateWanted(ar.bitrate);
      const plan = planAudioBitrate(wanted, info?.audio ?? null);
      if (plan.cappedAt && !['flac', 'wav'].includes(req.container)) notes.push(`Audio bitrate held at the source's ${formatBitrate(plan.cappedAt)}.`);
      const enc = audioEncoder(req.container, plan.bitrate);
      post.push(...enc.args);
      if (ar.sampleRate) post.push('-ar', String(ar.sampleRate));
      if (ar.channels) post.push('-ac', String(ar.channels));
      if (speed) {
        const sr = info?.audio?.sampleRate;
        if (speed.keepPitch || !sr) {
          post.push('-af', atempoChain(speed.factor));
          if (!speed.keepPitch) notes.push('The software engine kept the pitch (tape mode needs the sample rate, which could not be read).');
        } else {
          post.push('-af', `asetrate=${Math.round(sr * speed.factor)},aresample=${sr}`);
        }
      }
      audio = `Re-encoded to ${enc.label}`;
    }
  }

  if (req.container === 'mp4' || req.container === 'mov' || req.container === 'm4a') post.push('-movflags', '+faststart');
  post.push('-map_metadata', '0');
  return { pre, post, ext: c.ext, video, audio, notes };
}

export function gifPlanArgs(req: GifRequest): FfmpegPlan {
  const pre = req.end > req.start ? ['-ss', req.start.toFixed(3), '-to', req.end.toFixed(3)] : [];
  return { pre, post: gifArgs(req.width, req.fps), ext: 'gif', video: `GIF at ${req.fps} fps`, notes: [] };
}

export function gifToVideoArgs(container: 'mp4' | 'webm'): FfmpegPlan {
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const post =
    container === 'webm'
      ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-vf', even, '-an']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', even, '-movflags', '+faststart', '-an'];
  return { pre: [], post, ext: container, video: container === 'webm' ? 'Encoded to VP8' : 'Encoded to H.264', notes: [] };
}

/**
 * Concatenation with re-encoding (concat filter). Every clip is scaled and
 * padded to the first clip's size and resampled to 48 kHz stereo. All clips
 * must agree on having audio.
 */
export function mergeArgs(
  req: MergeRequest,
  infos: (MediaInfo | null)[],
  names: string[],
): { args: string[]; ext: string; video?: string; audio?: string } {
  const c = CONTAINERS[req.container];
  // Unreadable clips (null) are assumed to have both streams.
  const video = c.kind === 'video' && infos.some((i) => !i || i.video);
  const ref = infos.find((i) => i?.video)?.video;
  const w = ref ? Math.round(ref.width / 2) * 2 : 1280;
  const h = ref ? Math.round(ref.height / 2) * 2 : 720;
  const audio = infos.some((i) => !i || i.audio !== null);
  const inputs = names.flatMap((n) => ['-i', n]);
  const chains: string[] = [];
  const labels: string[] = [];
  names.forEach((_, i) => {
    const info = infos[i];
    const d = info?.duration ?? 0;
    if (video) {
      if (info && !info.video) {
        if (!(d > 0)) throw new Error('The length of an audio-only clip could not be read, so it cannot be joined into a video here.');
        chains.push(`color=c=black:s=${w}x${h}:r=30,trim=duration=${d.toFixed(3)},setsar=1,format=yuv420p[v${i}]`);
      } else {
        chains.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
      }
      labels.push(`[v${i}]`);
    }
    if (audio) {
      if (info && !info.audio) {
        if (!(d > 0)) throw new Error('The length of a silent clip could not be read, so it cannot be joined here.');
        chains.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(3)}[a${i}]`);
      } else {
        chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
      }
      labels.push(`[a${i}]`);
    }
  });
  const graph = `${chains.join(';')};${labels.join('')}concat=n=${names.length}:v=${video ? 1 : 0}:a=${audio ? 1 : 0}${video ? '[v]' : ''}${audio ? '[a]' : ''}`;
  const maps = [...(video ? ['-map', '[v]'] : []), ...(audio ? ['-map', '[a]'] : [])];
  const enc: string[] = [];
  if (video) {
    if (req.container === 'webm') enc.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M');
    else enc.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', CRF[req.quality] ?? '23');
  }
  if (audio) enc.push(...audioEncoder(req.container, req.audioBitrate).args);
  if (req.container === 'mp4' || req.container === 'mov' || req.container === 'm4a') enc.push('-movflags', '+faststart');
  return {
    args: [...inputs, '-filter_complex', graph, ...maps, ...enc],
    ext: c.ext,
    video: video ? `Re-encoded to ${req.container === 'webm' ? 'VP8' : 'H.264'} ${w}×${h}` : undefined,
    audio: audio ? 'Re-encoded' : undefined,
  };
}
