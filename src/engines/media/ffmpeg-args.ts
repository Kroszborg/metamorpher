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
      (copyFits(req.container, info?.video?.codec, 'video') || (sameContainer && (!info || info.engine === 'ffmpeg')));
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
        if (plan) {
          // MPEG-4 Part 2 needs about 1.5× H.264's bitrate for the same picture; never more than the source.
          const rate = Math.round(Math.min(plan.bitrate * 1.5, info?.video?.bitrate ?? Infinity));
          post.push('-c:v', 'mpeg4', '-vtag', 'xvid', '-b:v', String(rate), '-maxrate', String(Math.round(rate * 1.5)), '-bufsize', String(rate * 2));
          video = `Re-encoded to MPEG-4 Part 2 at ${formatBitrate(rate)}`;
        } else {
          const q = { small: '8', balanced: '5', high: '3', copy: '4' }[quality];
          post.push('-c:v', 'mpeg4', '-vtag', 'xvid', '-q:v', q);
          video = 'Re-encoded to MPEG-4 Part 2';
        }
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
      (copyFits(req.container, info?.audio?.codec, 'audio') || (sameContainer && (!info || info.engine === 'ffmpeg')));
    if (copy) {
      post.push('-c:a', 'copy');
      audio = info?.audio ? `Copied ${info.audio.label ?? audioCodecLabel(info.audio.codec)} without re-encoding` : 'Copied without re-encoding';
    } else {
      // 'copy' means "the source's bitrate"; when it is unknown, 192 kbps.
      const wanted = ar.bitrate === 'copy' && !info?.audio?.bitrate ? 192_000 : audioBitrateWanted(ar.bitrate);
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
 * padded to the first clip's size and resampled to 48 kHz stereo (mono when every clip is mono). All clips
 * must agree on having audio.
 */
export function mergeArgs(
  req: MergeRequest,
  infos: (MediaInfo | null)[],
  names: string[],
): { args: string[]; ext: string; video?: string; audio?: string; audioBitrate: number } {
  const c = CONTAINERS[req.container];
  // Unreadable clips (null) are assumed to have both streams.
  const video = c.kind === 'video' && infos.some((i) => !i || i.video);
  const ref = infos.find((i) => i?.video)?.video;
  const w = ref ? Math.round(ref.width / 2) * 2 : 1280;
  const h = ref ? Math.round(ref.height / 2) * 2 : 720;
  const audio = infos.some((i) => !i || i.audio !== null);
  // Keep stereo, or mono when every clip is known to be mono.
  const mono = infos.every((i) => i && (!i.audio || i.audio.channels === 1));
  const layout = mono ? 'mono' : 'stereo';
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
        chains.push(`anullsrc=r=48000:cl=${layout},atrim=duration=${d.toFixed(3)}[a${i}]`);
      } else {
        chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=${layout}[a${i}]`);
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
  // Never above the richest clip (as on the fast path), when every clip's audio is known.
  const caps = infos.map((i) => (i?.audio ? planAudioBitrate(req.audioBitrate, i.audio).bitrate : i ? 0 : req.audioBitrate));
  const audioBitrate = Math.max(32_000, Math.min(req.audioBitrate, Math.max(...caps)));
  if (audio) enc.push(...audioEncoder(req.container, audioBitrate).args);
  if (req.container === 'mp4' || req.container === 'mov' || req.container === 'm4a') enc.push('-movflags', '+faststart');
  return {
    args: [...inputs, '-filter_complex', graph, ...maps, ...enc],
    ext: c.ext,
    video: video ? `Re-encoded to ${req.container === 'webm' ? 'VP8' : 'H.264'} ${w}×${h}` : undefined,
    audio: audio ? `Re-encoded to ${audioEncoder(req.container, audioBitrate).label}, 48 kHz ${layout}` : undefined,
    audioBitrate,
  };
}

/**
 * Output settings for re-encoding a cut of a file only ffmpeg reads, keeping
 * its format where the core has an encoder for it (by input extension).
 * Others are written as MP4 (H.264/AAC), or M4A for audio.
 */
const SOFT_FORMATS: Record<string, { muxer: string; video?: string[]; audio: string[]; audioRate?: string }> = {
  avi: { muxer: 'avi', video: ['-c:v', 'mpeg4'], audio: ['-c:a', 'libmp3lame'] },
  wmv: { muxer: 'asf', video: ['-c:v', 'wmv2'], audio: ['-c:a', 'wmav2'] },
  asf: { muxer: 'asf', video: ['-c:v', 'wmv2'], audio: ['-c:a', 'wmav2'] },
  wma: { muxer: 'asf', audio: ['-c:a', 'wmav2'] },
  flv: { muxer: 'flv', video: ['-c:v', 'flv'], audio: ['-c:a', 'libmp3lame'], audioRate: '44100' },
  mpg: { muxer: 'vob', video: ['-c:v', 'mpeg2video'], audio: ['-c:a', 'mp2'] },
  mpeg: { muxer: 'vob', video: ['-c:v', 'mpeg2video'], audio: ['-c:a', 'mp2'] },
  vob: { muxer: 'vob', video: ['-c:v', 'mpeg2video'], audio: ['-c:a', 'mp2'] },
  ogv: { muxer: 'ogg', video: ['-c:v', 'libtheora'], audio: ['-c:a', 'libvorbis'] },
  // H.263 only takes the standard sizes, which an H.263 source already has.
  '3gp': { muxer: '3gp', video: ['-c:v', 'h263'], audio: ['-c:a', 'aac'] },
  aiff: { muxer: 'aiff', audio: ['-c:a', 'pcm_s16be'] },
  aif: { muxer: 'aiff', audio: ['-c:a', 'pcm_s16be'] },
};

/** Display names of the encoders softTrimPlan uses. */
const ENCODER_LABEL: Record<string, string> = {
  mpeg4: 'MPEG-4 Part 2',
  wmv2: 'WMV8',
  flv: 'Sorenson Spark (FLV1)',
  mpeg2video: 'MPEG-2',
  libtheora: 'Theora',
  h263: 'H.263',
  libmp3lame: 'MP3',
  wmav2: 'WMA v2',
  mp2: 'MP2',
  libvorbis: 'Vorbis',
  aac: 'AAC',
  pcm_s16be: 'PCM',
};

export type SoftTrimPlan = FfmpegPlan & {
  /** Expected output size in bytes, for the engine's memory limit. */
  expectedBytes: number;
};

/**
 * A cut of a file only ffmpeg reads. Fast mode copies the streams into the
 * same format (starting at the key frame before the in point); precise mode
 * re-encodes from the in point, at the source's bitrates or lower.
 */
export function softTrimPlan(info: MediaInfo, ext: string, range: { start: number; end: number; accurate: boolean }): SoftTrimPlan {
  const length = Math.max(0.05, range.end - range.start);
  const maps = [...(info.video ? ['-map', '0:v:0'] : []), ...(info.audio ? ['-map', '0:a:0'] : [])];
  const notes: string[] = [];
  const fraction = info.duration > 0 ? Math.min(1, length / info.duration) : 1;
  // MPEG-PS video opens each group with frames that lean on the previous one, and Ogg Theora pages carry
  // positions a copied cut cannot restate: copied cuts of either drift out of sync by 0.1–0.2 s (measured),
  // so these files are always cut by re-encoding.
  const program = ext === 'mpg' || ext === 'mpeg' || ext === 'vob' || ext === 'ogv';
  const accurate = range.accurate || (program && !!info.video);
  if (!range.accurate && accurate) {
    notes.push(`${ext === 'ogv' ? 'Ogg Theora video' : 'MPEG program streams'} cannot be cut cleanly without re-encoding, so this cut was made frame-accurately.`);
  }
  if (!accurate) {
    // Up to a key-frame interval more than the selection (10 s is generous), plus container slack.
    const extra = info.duration > 0 ? Math.min(1, 10 / info.duration) : 0;
    // ASF seeks by its index, which lands up to a second early and throws off -t: seek near, then cut exactly
    // (copying starts at the first key frame from the in point).
    const asf = ext === 'wmv' || ext === 'asf' || ext === 'wma';
    const near = asf ? Math.max(0, range.start - 10) : range.start;
    return {
      pre: ['-ss', near.toFixed(3)],
      post: [...(asf ? ['-ss', (range.start - near).toFixed(3)] : []), '-t', length.toFixed(3), ...maps, '-c', 'copy', '-avoid_negative_ts', 'make_zero'],
      ext,
      video: info.video ? 'Copied without re-encoding' : undefined,
      audio: info.audio ? 'Copied without re-encoding' : undefined,
      notes: info.video
        ? [
            asf
              ? 'Fast mode copies the streams; the picture starts at the first key frame from the in point.'
              : 'Fast mode copies from the key frame before the in point, so the clip may start slightly early.',
          ]
        : [],
      expectedBytes: Math.round(info.size * Math.min(1, fraction + extra) * 1.05) + 1_000_000,
    };
  }
  const pre = ['-ss', range.start.toFixed(3)];
  const fmt = SOFT_FORMATS[ext];
  const keep = !!fmt && (!info.video || !!fmt.video) && (ext !== '3gp' || info.video?.label === 'H.263');
  const outExt = keep ? ext : info.video ? 'mp4' : 'm4a';
  const post = ['-t', length.toFixed(3), ...maps];
  let video: string | undefined;
  let audio: string | undefined;
  let videoBits = 0;
  if (info.video) {
    // Same codec family as the source at its bitrate (H.264 at 70% of it when the format changes).
    const src = info.video.bitrate ?? 2_000_000;
    if (keep) {
      post.push(...fmt.video!, '-b:v', String(src), '-maxrate', String(Math.round(src * 1.5)), '-bufsize', String(src * 2));
      if (fmt.video![1] === 'mpeg4') post.push('-vtag', 'xvid');
      videoBits = src;
      video = `Re-encoded to ${ENCODER_LABEL[fmt.video![1]!]} at ${formatBitrate(src)}`;
    } else {
      const rate = Math.max(300_000, Math.round(src * 0.7));
      post.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', String(rate), '-maxrate', String(Math.round(rate * 1.5)), '-bufsize', String(rate * 2), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
      videoBits = rate;
      video = `Re-encoded to H.264 at ${formatBitrate(rate)}`;
    }
  }
  let audioBits = 0;
  if (info.audio) {
    const lossless = keep && fmt.muxer === 'aiff';
    const rate = Math.min(info.audio.bitrate ?? 192_000, 192_000);
    const ab = commonBitrate(rate);
    if (keep) {
      post.push(...fmt.audio);
      if (!lossless) post.push('-b:a', `${Math.round(ab / 1000)}k`);
      if (fmt.audioRate) post.push('-ar', fmt.audioRate);
    } else {
      post.push('-c:a', 'aac', '-b:a', `${Math.round(ab / 1000)}k`);
    }
    audioBits = lossless ? (info.audio.sampleRate || 48000) * 16 * Math.max(1, info.audio.channels) : ab;
    audio = lossless ? 'Re-encoded to PCM' : `Re-encoded to ${keep ? ENCODER_LABEL[fmt.audio[1]!] : 'AAC'} ${formatBitrate(ab)}`;
  }
  if (keep && fmt.muxer === 'vob') post.push('-f', 'vob');
  if (outExt === 'mp4' || outExt === 'm4a') post.push('-movflags', '+faststart');
  if (!keep) {
    notes.push(`The software engine cannot write ${ext.toUpperCase()} with these codecs, so the frame-accurate cut is saved as ${outExt.toUpperCase()}. Fast mode keeps the format.`);
  }
  return {
    pre,
    post,
    ext: outExt,
    video,
    audio,
    notes,
    expectedBytes: Math.round(((videoBits + audioBits) * length) / 8 * 1.3) + 1_000_000,
  };
}

function commonBitrate(bps: number): number {
  const steps = [192_000, 160_000, 128_000, 112_000, 96_000, 80_000, 64_000, 48_000, 32_000];
  return steps.find((b) => b <= bps * 1.05) ?? 32_000;
}
