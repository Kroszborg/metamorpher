/// <reference lib="webworker" />
/**
 * The Mediabunny side of the media engine. Runs in a module worker: input is
 * read from the File in small ranges (BlobSource), frames go through
 * WebCodecs, and output is streamed into a BlobSink. Nothing here holds the
 * whole input or output in one buffer.
 *
 * Every job either resolves with a finished file or with a typed reason to
 * fall back to ffmpeg.wasm; genuine input errors throw.
 */
import { expose } from 'comlink';
import {
  ALL_FORMATS,
  AdtsOutputFormat,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  CanvasSink,
  type ConversionAudioOptions,
  type ConversionOptions,
  type ConversionVideoOptions,
  Conversion,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  FlacOutputFormat,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  MpegTsOutputFormat,
  OggOutputFormat,
  Output,
  type OutputFormat,
  Quality,
  StreamTarget,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { BlobSink } from './blob-sink';
import { type SpeedProcessor, TapeResampler, TimeStretcher } from './dsp';
import {
  CONTAINERS,
  COMMON_AUDIO_BITRATES,
  audioBitrateWanted,
  audioCodecLabel,
  even,
  fitShortSide,
  capFps,
  formatBitrate,
  planAudioBitrate,
  planVideo,
  videoCodecLabel,
} from './presets';
import type {
  AudioCodecId,
  Capabilities,
  Container,
  ConvertRequest,
  FallbackReason,
  GifRequest,
  GifToVideoRequest,
  MediaInfo,
  MergeRequest,
  VideoCodecId,
  WorkerOutcome,
} from './types';

type Progress = (fraction: number) => void;

const VIDEO_CODECS: VideoCodecId[] = ['avc', 'hevc', 'vp9', 'vp8', 'av1'];

function fallback(code: FallbackReason['code'], message: string): WorkerOutcome {
  return { ok: false, fallback: { code, message } };
}

/** Throttles progress messages across the worker boundary. */
function throttled(onProgress?: Progress): Progress {
  let last = -1;
  let lastAt = 0;
  return (f) => {
    if (!onProgress) return;
    const now = Date.now();
    if (f >= 1 || f - last >= 0.01 || now - lastAt > 250) {
      last = f;
      lastAt = now;
      onProgress(Math.min(1, Math.max(0, f)));
    }
  };
}

function openInput(file: Blob): Input {
  return new Input({ source: new BlobSource(file, { maxCacheSize: 16 * 1024 * 1024 }), formats: ALL_FORMATS });
}

async function withInput<R>(file: Blob, fn: (input: Input) => Promise<R>): Promise<R> {
  const input = openInput(file);
  try {
    return await fn(input);
  } finally {
    input.dispose();
  }
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// ── Encoders ───────────────────────────────────────────────────────────────

const wasmRegistered = new Set<AudioCodecId>();

type AudioEncoderChoice = { bitrate?: number; wasm: boolean; snapped: boolean };

/**
 * Finds a way to encode `codec` at this channel count and sample rate: the
 * browser's encoder at the wanted bitrate, else at the nearest lower common
 * bitrate it accepts, else Mediabunny's WASM encoder (AAC, MP3, FLAC). Null
 * when none can (Vorbis is never encodable here).
 *
 * WASM encoders are registered for the rest of the worker's life and take
 * priority over native ones from then on, so they are only registered when
 * the native encoder cannot do the job; after a job that registered the AAC
 * one the engine replaces the worker, so later jobs get the native encoder.
 */
async function resolveAudioEncoder(
  codec: AudioCodecId,
  numberOfChannels: number,
  sampleRate: number,
  bitrate?: number,
): Promise<AudioEncoderChoice | null> {
  if (codec === 'pcm') return { wasm: false, snapped: false };
  const mb = mbAudioCodec(codec);
  const can = (b?: number) =>
    canEncodeAudio(mb, { numberOfChannels, sampleRate, ...(b ? { quality: new Quality({ bitrate: b }) } : {}) }).catch(() => false);
  if (await can(bitrate)) return { bitrate, wasm: wasmRegistered.has(codec), snapped: false };
  if (bitrate && !wasmRegistered.has(codec)) {
    for (const b of COMMON_AUDIO_BITRATES) {
      if (b < bitrate && b >= bitrate * 0.6 && (await can(b))) return { bitrate: b, wasm: false, snapped: true };
    }
  }
  if (wasmRegistered.has(codec)) return null;
  if (codec === 'aac') (await import('@mediabunny/aac-encoder')).registerAacEncoder();
  else if (codec === 'mp3') (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
  else if (codec === 'flac') (await import('@mediabunny/flac-encoder')).registerFlacEncoder();
  else return null;
  wasmRegistered.add(codec);
  return (await can(bitrate)) ? { bitrate, wasm: true, snapped: false } : null;
}

const videoEncodable = new Map<string, Promise<boolean>>();
function canEncodeVideoAt(codec: VideoCodecId, width: number, height: number): Promise<boolean> {
  const key = `${codec}:${width}x${height}`;
  let p = videoEncodable.get(key);
  if (!p) {
    p = canEncodeVideo(codec, { width, height }).catch(() => false);
    videoEncodable.set(key, p);
  }
  return p;
}

function mbAudioCodec(codec: AudioCodecId): AudioCodec {
  return codec === 'pcm' ? 'pcm-s16' : codec;
}

/** A sample rate the codec's encoders accept, close to the source. */
function encoderSampleRate(codec: AudioCodecId, source: number, wanted?: number): number | undefined {
  const rate = wanted ?? source;
  if (codec === 'opus') return rate === 48000 ? (wanted ? 48000 : undefined) : 48000;
  if (codec === 'aac') return rate === 44100 || rate === 48000 ? (wanted ? rate : undefined) : rate < 44100 ? 44100 : 48000;
  if (codec === 'mp3') return rate > 48000 ? 48000 : wanted;
  return wanted;
}

// ── Probe ──────────────────────────────────────────────────────────────────

async function videoBitrate(track: InputVideoTrack | InputAudioTrack): Promise<number | null> {
  const declared = await track.getAverageBitrate().catch(() => null);
  if (declared && declared > 0) return declared;
  try {
    const stats = await track.computePacketStats(400);
    return stats.averageBitrate > 0 ? stats.averageBitrate : null;
  } catch {
    return null;
  }
}

async function describe(input: Input, file: File): Promise<MediaInfo> {
  const size = file.size;
  if (!(await input.canRead())) {
    const ext = extOf(file.name).toUpperCase() || 'this';
    return { readable: false, reason: `The fast engine cannot read ${ext} files.`, duration: 0, startTime: 0, size, video: null, audio: null };
  }
  const format = (await input.getFormat()).name;
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  const tracks = [v, a].filter((t): t is InputVideoTrack | InputAudioTrack => t !== null);
  const start = tracks.length ? Math.max(0, await input.getFirstTimestamp(tracks).catch(() => 0)) : 0;
  const end = tracks.length
    ? ((await input.getDurationFromMetadata(tracks).catch(() => null)) ?? (await input.computeDuration(tracks)))
    : 0;
  let video: MediaInfo['video'] = null;
  if (v) {
    let fps: number | null = null;
    try {
      fps = (await v.computeFrameRateMetrics({ targetPacketCount: 120 })).bestGuessFrameRate || null;
    } catch {
      fps = null;
    }
    const codec = await v.getCodec();
    video = {
      codec: codec as VideoCodecId | 'prores' | null,
      codedWidth: await v.getCodedWidth(),
      codedHeight: await v.getCodedHeight(),
      width: await v.getDisplayWidth(),
      height: await v.getDisplayHeight(),
      rotation: await v.getRotation(),
      fps,
      bitrate: await videoBitrate(v),
      canDecode: await v.canDecode().catch(() => false),
    };
  }
  let audio: MediaInfo['audio'] = null;
  if (a) {
    audio = {
      codec: await a.getCodec(),
      sampleRate: await a.getSampleRate(),
      channels: await a.getNumberOfChannels(),
      bitrate: await videoBitrate(a),
      canDecode: await a.canDecode().catch(() => false),
    };
  }
  return { readable: true, format, duration: Math.max(0, end - start), startTime: start, size, video, audio };
}

// ── Output plumbing ────────────────────────────────────────────────────────

function makeFormat(container: Container, fastStart: 'reserve' | false = 'reserve'): OutputFormat {
  switch (container) {
    case 'mp4':
    case 'm4a':
      return new Mp4OutputFormat({ fastStart });
    case 'mov':
      return new MovOutputFormat({ fastStart });
    case 'mkv':
      return new MkvOutputFormat();
    case 'webm':
      return new WebMOutputFormat();
    case 'ts':
      return new MpegTsOutputFormat();
    case 'mp3':
      return new Mp3OutputFormat();
    case 'aac':
      return new AdtsOutputFormat();
    case 'opus':
      return new OggOutputFormat();
    case 'flac':
      return new FlacOutputFormat();
    case 'wav':
      return new WavOutputFormat({ large: false });
    case 'ogg':
      return new OggOutputFormat();
    case 'avi':
      throw new Error('AVI is written by ffmpeg.wasm.');
  }
}

function makeOutput(format: OutputFormat): { output: Output; sink: BlobSink } {
  const sink = new BlobSink();
  const target = new StreamTarget(sink.writable(), { chunked: true, chunkSize: 4 * 1024 * 1024 });
  return { output: new Output({ format, target }), sink };
}

/** Whether `codec` from the source may be copied into `container`. */
function copyableAudio(container: Container, format: OutputFormat, codec: string | null): boolean {
  if (!codec) return false;
  const info = CONTAINERS[container];
  if (info.kind === 'audio') {
    return info.audio.some((c) => (c === 'pcm' ? codec.startsWith('pcm') : c === codec)) &&
      format.getSupportedAudioCodecs().includes(codec as AudioCodec);
  }
  return format.getSupportedAudioCodecs().includes(codec as AudioCodec);
}

async function pickVideoCodec(
  container: Container,
  format: OutputFormat,
  wanted: VideoCodecId | 'auto' | undefined,
  width: number,
  height: number,
): Promise<VideoCodecId | null> {
  const supported = format.getSupportedVideoCodecs();
  const candidates = wanted && wanted !== 'auto' ? [wanted] : CONTAINERS[container].video;
  for (const c of candidates) {
    if (supported.includes(c as VideoCodec) && (await canEncodeVideoAt(c, width, height))) return c;
  }
  return null;
}

function discardFallback(conversion: Conversion, wanted: { video: boolean; audio: boolean }): WorkerOutcome | null {
  for (const d of conversion.discardedTracks) {
    if (d.reason === 'discarded_by_user' || d.reason === 'max_track_count_reached' || d.reason === 'max_track_count_of_type_reached') continue;
    const isVideo = d.track.isVideoTrack();
    if ((isVideo && !wanted.video) || (!isVideo && !wanted.audio)) continue;
    const kind = isVideo ? 'video' : 'audio';
    const codec = isVideo ? videoCodecLabel(d.track.codec) : audioCodecLabel(d.track.codec);
    if (d.reason === 'undecodable_source_codec' || d.reason === 'unknown_source_codec') {
      return fallback(isVideo ? 'video-decode' : 'audio-decode', `decode ${codec} ${kind}`);
    }
    if (d.reason === 'no_encodable_target_codec') {
      return fallback(isVideo ? 'video-encode' : 'audio-encode', `encode ${kind} for this format`);
    }
    return fallback('webcodecs-error', `process the ${kind} track (${d.reason})`);
  }
  return null;
}

/** Half a frame: how far a copied cut may start from the requested time and still count as exact. */
function copyTolerance(fps: number | null): number {
  return 0.5 / (fps && fps > 0 ? fps : 30);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Speed (process callbacks) ──────────────────────────────────────────────

function speedAudio(factor: number, keepPitch: boolean, trackStart: number, trackEnd: number) {
  let proc: SpeedProcessor | null = null;
  let outFrames = 0;
  let t0 = 0;
  let relative = false;
  let done = false;
  let channels = 2;
  let rate = 48000;
  const wrap = (planes: Float32Array[]): AudioSample | null => {
    const n = planes[0]?.length ?? 0;
    if (n === 0) return null;
    const data = new Float32Array(n * channels);
    planes.forEach((p, c) => data.set(p, c * n));
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: channels,
      sampleRate: rate,
      timestamp: t0 + outFrames / rate,
    });
    outFrames += n;
    return sample;
  };
  return (sample: AudioSample): AudioSample | AudioSample[] | null => {
    if (done) return null;
    if (!proc) {
      channels = sample.numberOfChannels;
      rate = sample.sampleRate;
      relative = Math.abs(sample.timestamp - trackStart) > 0.05 && trackStart > 0.05;
      t0 = sample.timestamp / factor;
      proc = keepPitch ? new TimeStretcher(channels, rate, factor) : new TapeResampler(channels, factor);
    }
    const planes: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      const plane = new Float32Array(sample.numberOfFrames);
      sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
      planes.push(plane);
    }
    const end = sample.timestamp + sample.duration;
    const limit = relative ? trackEnd - trackStart : trackEnd;
    const out: AudioSample[] = [];
    const first = wrap(proc.push(planes));
    if (first) out.push(first);
    if (end >= limit - 0.003) {
      done = true;
      const tail = wrap(proc.flush());
      if (tail) out.push(tail);
    }
    sample.close();
    return out.length ? out : null;
  };
}

// ── Convert ────────────────────────────────────────────────────────────────

async function convert(file: File, req: ConvertRequest, onProgress?: Progress): Promise<WorkerOutcome> {
  return withInput(file, (input) => convertInput(input, file, req, onProgress));
}

async function convertInput(input: Input, file: File, req: ConvertRequest, onProgress?: Progress): Promise<WorkerOutcome> {
  const progress = throttled(onProgress);
  if (!(await input.canRead())) {
    return fallback('container-read', `read ${(extOf(file.name) || 'this').toUpperCase()} files`);
  }
  if (!CONTAINERS[req.container].mediabunny && req.container !== 'ogg') {
    return fallback('container-write', `write ${CONTAINERS[req.container].label} files`);
  }
  const info = await describe(input, file);
  const audioOnly = CONTAINERS[req.container].kind === 'audio';
  const wantVideo = !audioOnly && !req.video?.discard && !!info.video;
  const wantAudio = !req.audio?.discard && !!info.audio;
  if (!wantVideo && !wantAudio) {
    throw new Error(audioOnly ? 'This file has no audio track.' : 'This file has no audio or video to keep.');
  }

  const speed = req.speed && Math.abs(req.speed.factor - 1) > 1e-3 ? req.speed : undefined;
  const trim = req.trim;
  // Speed changes the packet count, which a reserved MP4 header cannot predict.
  const format = makeFormat(req.container, speed ? false : 'reserve');
  const notes: string[] = [];
  let videoDesc: string | undefined;
  let audioDesc: string | undefined;

  // Video
  let videoOpts: ConversionVideoOptions = { discard: true };
  if (wantVideo && info.video) {
    const v = info.video;
    const vr = req.video ?? {};
    const shape = fitShortSide(v.width, v.height, vr.maxShortSide);
    const fpsCap = capFps(v.fps, speed && speed.factor > 1 ? (v.fps ?? 30) / speed.factor : vr.maxFps);
    const srcCodec = v.codec;
    const copyWanted = (vr.quality ?? 'balanced') === 'copy' && !vr.bitrate;
    const codecFits = !!srcCodec && format.getSupportedVideoCodecs().includes(srcCodec as VideoCodec) &&
      (!vr.codec || vr.codec === 'auto' || vr.codec === srcCodec);
    const accurateTrim = !!trim && trim.accurate;
    // Copied frames keep their stored orientation, so the container must be able to say how to turn them.
    const rotationFits = v.rotation === 0 || format.supportsVideoRotationMetadata;
    let copy = codecFits && rotationFits && !shape.scaled && !fpsCap && !speed && (copyWanted || (!!trim && !trim.accurate));
    if (!rotationFits && (copyWanted || (!!trim && !trim.accurate))) {
      notes.push(`${CONTAINERS[req.container].label} cannot store rotation, so the ${v.rotation}° turn was applied to the frames (re-encoded).`);
    }
    if (copy && trim && accurateTrim) {
      // A frame-accurate cut can only copy when the in point is on a key frame. Decide here rather than
      // letting Mediabunny fall back to transcoding on its own, which would ignore our bitrate plan.
      const start = info.startTime + trim.start;
      const key = await input.getPrimaryVideoTrack().then((t) =>
        t ? new EncodedPacketSink(t).getKeyPacket(start, { verifyKeyPackets: true }) : null,
      );
      copy = !!key && Math.abs(key.timestamp - start) <= copyTolerance(v.fps);
      if (!copy) notes.push('The in point is not on a key frame, so the video was re-encoded for a frame-accurate cut.');
    }
    if (copy) {
      videoOpts = {};
      videoDesc = `Copied ${videoCodecLabel(srcCodec)} ${v.width}×${v.height} without re-encoding`;
    } else {
      if (!v.canDecode) return fallback('video-decode', `decode ${videoCodecLabel(srcCodec)} video`);
      // Trims keep the source codec when it can be encoded here.
      const preferred = vr.codec && vr.codec !== 'auto' ? vr.codec : trim && srcCodec && srcCodec !== 'prores' ? srcCodec : 'auto';
      let codec = await pickVideoCodec(req.container, format, preferred, shape.width, shape.height);
      if (!codec && preferred !== 'auto' && (!vr.codec || vr.codec === 'auto')) {
        codec = await pickVideoCodec(req.container, format, 'auto', shape.width, shape.height);
        if (codec) notes.push(`This browser cannot encode ${videoCodecLabel(preferred)}, so the video was re-encoded as ${videoCodecLabel(codec)}.`);
      }
      if (!codec) {
        const name = preferred === 'auto' ? CONTAINERS[req.container].label : videoCodecLabel(preferred);
        return fallback('video-encode', `encode ${name} video`);
      }
      const quality = accurateTrim || speed ? (vr.quality === 'copy' || !vr.quality ? 'high' : vr.quality) : vr.quality;
      const plan = planVideo(
        { ...v, fps: fpsCap ?? v.fps },
        codec,
        { quality, bitrate: vr.bitrate, maxShortSide: vr.maxShortSide },
      );
      if (plan.cappedAt) notes.push(`Video bitrate held at the source's ${formatBitrate(plan.cappedAt)} (re-encoding cannot add detail).`);
      if (vr.maxShortSide && !shape.scaled && Math.min(v.width, v.height) < vr.maxShortSide) {
        notes.push(`Kept the source size ${v.width}×${v.height}; it is not upscaled.`);
      }
      videoOpts = {
        codec,
        width: shape.width,
        height: shape.height,
        fit: 'fill',
        quality: new Quality({ bitrate: plan.bitrate }),
        forceTranscode: true,
      };
      if (fpsCap) videoOpts.frameRate = fpsCap;
      if (speed) {
        const f = speed.factor;
        videoOpts.process = (sample) => {
          sample.setTimestamp(sample.timestamp / f);
          sample.setDuration(sample.duration / f);
          return sample;
        };
      }
      const outFps = speed ? (fpsCap ?? v.fps ?? 30) * speed.factor : (fpsCap ?? v.fps);
      videoDesc = `Re-encoded to ${videoCodecLabel(codec)} ${shape.width}×${shape.height}${outFps ? ` ${Math.round(outFps * 100) / 100} fps` : ''} at ${formatBitrate(plan.bitrate)}`;
    }
  }

  // Audio
  let audioOpts: ConversionAudioOptions = { discard: true };
  if (wantAudio && info.audio) {
    const a = info.audio;
    const ar = req.audio ?? {};
    const changesFormat = !!ar.sampleRate || !!ar.channels;
    const copy = !speed && !changesFormat && !(trim && trim.accurate) &&
      (ar.bitrate === 'copy' || (!!trim && !trim.accurate)) &&
      (!ar.codec || ar.codec === 'auto' || ar.codec === a.codec) &&
      copyableAudio(req.container, format, a.codec);
    if (copy) {
      audioOpts = {};
      audioDesc = `Copied ${audioCodecLabel(a.codec)} without re-encoding`;
    } else {
      if (!a.canDecode) return fallback('audio-decode', `decode ${audioCodecLabel(a.codec)} audio`);
      const codecs = CONTAINERS[req.container].audio;
      let codec: AudioCodecId | undefined =
        ar.codec && ar.codec !== 'auto'
          ? ar.codec
          : trim && codecs.includes(a.codec as AudioCodecId)
            ? (a.codec as AudioCodecId)
            : codecs[0];
      if (!codec || !format.getSupportedAudioCodecs().includes(mbAudioCodec(codec))) codec = codecs[0];
      if (!codec) return fallback('audio-encode', 'encode audio for this format');
      const lossless = codec === 'flac' || codec === 'pcm';
      const wanted = audioBitrateWanted(ar.bitrate);
      const plan = lossless ? { bitrate: 0 } : planAudioBitrate(wanted, a);
      const channels = ar.channels ?? (a.channels > 2 && (codec === 'opus' || codec === 'mp3' || codec === 'aac') ? 2 : undefined);
      const sampleRate = encoderSampleRate(codec, a.sampleRate, ar.sampleRate);
      const encoder = await resolveAudioEncoder(
        codec,
        channels ?? a.channels,
        sampleRate ?? a.sampleRate,
        lossless ? undefined : plan.bitrate,
      );
      if (!encoder) return fallback('audio-encode', `encode ${audioCodecLabel(codec)} audio`);
      if (!lossless && encoder.snapped && encoder.bitrate) {
        notes.push(`This browser's ${audioCodecLabel(codec)} encoder takes ${formatBitrate(encoder.bitrate)} as the nearest bitrate.`);
        plan.bitrate = encoder.bitrate;
      } else if (!lossless && 'cappedAt' in plan && plan.cappedAt) {
        notes.push(`Audio bitrate held at the source's ${formatBitrate(plan.cappedAt)}.`);
      }
      audioOpts = { codec: mbAudioCodec(codec), forceTranscode: true };
      if (!lossless) audioOpts.quality = new Quality({ bitrate: plan.bitrate });
      if (channels) audioOpts.numberOfChannels = channels;
      if (sampleRate) audioOpts.sampleRate = sampleRate;
      if (speed) {
        const aTrack = await input.getPrimaryAudioTrack();
        const tStart = aTrack ? await aTrack.getFirstTimestamp() : 0;
        const tEnd = aTrack ? await aTrack.computeDuration() : info.duration;
        audioOpts.process = speedAudio(speed.factor, speed.keepPitch, tStart, tEnd);
        audioOpts.processedSampleRate = sampleRate ?? a.sampleRate;
        audioOpts.processedNumberOfChannels = channels ?? a.channels;
        notes.push(
          speed.keepPitch
            ? 'Audio is time-stretched (WSOLA) so voices keep their pitch.'
            : 'Audio is resampled like a tape, so its pitch changes with the speed.',
        );
      }
      const wasm = encoder.wasm ? ' (WASM encoder: the browser has none for this setting)' : '';
      const rate = sampleRate ?? a.sampleRate;
      audioDesc = `Re-encoded to ${audioCodecLabel(codec)}${lossless ? '' : ` ${formatBitrate(plan.bitrate)}`} ${Math.round(rate / 100) / 10} kHz${channels ? `, ${channels === 1 ? 'mono' : channels === 2 ? 'stereo' : `${channels} ch`}` : ''}${wasm}`;
    }
  }

  const { output, sink } = makeOutput(format);
  const options: ConversionOptions = {
    input,
    output,
    tracks: 'primary',
    video: videoOpts,
    audio: audioOpts,
    showWarnings: false,
  };
  if (trim) {
    options.trim = { start: info.startTime + trim.start, end: info.startTime + trim.end };
    options.copy = trim.accurate
      ? { boundaryTolerance: copyTolerance(info.video?.fps ?? null) }
      : { boundaryPolicy: 'expand', shiftTolerance: Infinity };
  } else {
    options.copy = { shiftTolerance: Infinity };
  }
  const conversion = await Conversion.init(options);
  const bad = discardFallback(conversion, { video: wantVideo, audio: wantAudio });
  if (bad) return bad;
  if (!conversion.isValid) return fallback('webcodecs-error', 'set up this conversion');
  conversion.onProgress = (p) => progress(p);
  try {
    await conversion.execute();
  } catch (err) {
    return fallback('webcodecs-error', `finish (${errorText(err)})`);
  }
  if (trim && !trim.accurate && videoDesc?.startsWith('Copied')) {
    notes.push('Fast mode cuts at the nearest key frame before the in point, so the clip may start slightly early.');
  }
  return { ok: true, blob: sink.finish(format.mimeType), ext: CONTAINERS[req.container].ext, video: videoDesc, audio: audioDesc, notes };
}

// ── Video to GIF ───────────────────────────────────────────────────────────

type GifPlan = { track: InputVideoTrack; width: number; height: number; times: number[] };

async function gifPlan(input: Input, req: GifRequest): Promise<GifPlan | WorkerOutcome> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('This file has no video track.');
  if (!(await track.canDecode())) return fallback('video-decode', `decode ${videoCodecLabel(await track.getCodec())} video`);
  const dw = await track.getDisplayWidth();
  const dh = await track.getDisplayHeight();
  const width = Math.max(2, Math.round(req.width > 0 ? Math.min(req.width, dw) : dw));
  const height = Math.max(2, Math.round((width * dh) / dw));
  const first = Math.max(0, await track.getFirstTimestamp());
  const end = await track.computeDuration();
  const from = first + Math.max(0, req.start);
  const to = Math.min(end, first + (req.end > req.start ? req.end : end));
  const times: number[] = [];
  for (let t = from; t < to - 1e-6; t += 1 / req.fps) times.push(t);
  if (times.length === 0) times.push(from);
  return { track, width, height, times };
}

type Rgba = Uint8ClampedArray<ArrayBuffer>;

/** Draws a decoded frame at the GIF's size and reads its pixels. */
function framePixels(ctx: OffscreenCanvasRenderingContext2D, source: CanvasImageSource, plan: { width: number; height: number }): Rgba {
  ctx.drawImage(source, 0, 0, plan.width, plan.height);
  return ctx.getImageData(0, 0, plan.width, plan.height).data;
}

/** Frames sampled across the range to build the palette from. */
const PALETTE_FRAMES = 8;
/** Pixels fed to the quantiser in total; its cost grows with distinct colours, not pixels. */
const PALETTE_PIXELS = 160_000;

/**
 * One palette for the whole GIF, quantised from frames spread over the range
 * (like ffmpeg's palettegen). Quantising every frame separately is up to
 * ~100× slower in gifenc and makes colours flicker between frames.
 */
async function gifPalette(sink: CanvasSink, ctx: OffscreenCanvasRenderingContext2D, plan: GifPlan, colors: number): Promise<number[][]> {
  const n = plan.times.length;
  const picks = [...new Set(Array.from({ length: Math.min(PALETTE_FRAMES, n) }, (_, k) => Math.floor(((k + 0.5) * n) / Math.min(PALETTE_FRAMES, n))))].map(
    (k) => plan.times[k]!,
  );
  const per = Math.max(1, Math.floor(PALETTE_PIXELS / picks.length));
  const step = Math.max(1, Math.floor((plan.width * plan.height) / per));
  const samples: number[] = [];
  for await (const frame of sink.canvasesAtTimestamps(picks)) {
    if (!frame) continue;
    const data = framePixels(ctx, frame.canvas as OffscreenCanvas, plan);
    for (let p = 0; p < data.length; p += step * 4) samples.push(data[p]!, data[p + 1]!, data[p + 2]!, 255);
  }
  if (samples.length === 0) throw new Error('No frames could be read from this range.');
  return quantize(new Uint8ClampedArray(samples), colors, { format: 'rgb565' });
}

async function videoToGif(file: File, req: GifRequest, onProgress?: Progress): Promise<WorkerOutcome> {
  return withInput(file, (input) => videoToGifInput(input, file, req, onProgress));
}

async function videoToGifInput(input: Input, file: File, req: GifRequest, onProgress?: Progress): Promise<WorkerOutcome> {
  const progress = throttled(onProgress);
  if (!(await input.canRead())) return fallback('container-read', `read ${(extOf(file.name) || 'this').toUpperCase()} files`);
  const plan = await gifPlan(input, req);
  if ('ok' in plan) return plan;
  const sink = new CanvasSink(plan.track, { width: plan.width, height: plan.height, fit: 'fill', poolSize: 2 });
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw frames in a worker.');
  const palette = await gifPalette(sink, ctx, plan, req.colors);
  progress(0.05);
  const gif = GIFEncoder({ auto: false, initialCapacity: 1 << 20 });
  gif.writeHeader();
  const parts: BlobPart[] = [];
  const flush = () => {
    parts.push(gif.bytes() as Uint8Array<ArrayBuffer>);
    gif.stream.reset();
  };
  // Delays are in centiseconds; accumulate so rounding does not drift.
  const cs = (t: number) => Math.round((t - plan.times[0]!) * 100);
  let i = 0;
  let written = 0;
  for await (const frame of sink.canvasesAtTimestamps(plan.times)) {
    const t = plan.times[i]!;
    const next = plan.times[i + 1] ?? t + 1 / req.fps;
    i += 1;
    if (!frame) continue;
    const delay = Math.max(2, cs(next) - cs(t)) * 10;
    const index = applyPalette(framePixels(ctx, frame.canvas as OffscreenCanvas, plan), palette, 'rgb565');
    // The first frame carries the palette as the global colour table; the rest use it.
    gif.writeFrame(index, plan.width, plan.height, { palette: written === 0 ? palette : undefined, delay, first: written === 0, repeat: 0 });
    written += 1;
    if (gif.stream.bytesView().length > 8 * 1024 * 1024) flush();
    progress(0.05 + (0.95 * i) / plan.times.length);
  }
  if (written === 0) throw new Error('No frames could be read from this range.');
  gif.finish();
  flush();
  return {
    ok: true,
    blob: new Blob(parts, { type: 'image/gif' }),
    ext: 'gif',
    video: `GIF ${plan.width}×${plan.height}, ${written} frames at ${req.fps} fps, ${palette.length}-colour palette`,
    notes: [],
  };
}

/** Builds the palette and encodes a few frames with it to estimate the GIF's size. */
async function estimateGif(file: File, req: GifRequest): Promise<number | null> {
  return withInput(file, (input) => estimateGifInput(input, req));
}

async function estimateGifInput(input: Input, req: GifRequest): Promise<number | null> {
  if (!(await input.canRead())) return null;
  const plan = await gifPlan(input, req);
  if ('ok' in plan) return null;
  const sink = new CanvasSink(plan.track, { width: plan.width, height: plan.height, fit: 'fill' });
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const palette = await gifPalette(sink, ctx, plan, req.colors);
  const n = plan.times.length;
  // Consecutive frames, so the estimate reflects how GIF's LZW handles motion between them.
  const mid = Math.floor(n / 2);
  const picks = plan.times.slice(Math.max(0, mid - 2), Math.min(n, mid + 2));
  const gif = GIFEncoder({ auto: false });
  let count = 0;
  for await (const frame of sink.canvasesAtTimestamps(picks)) {
    if (!frame) continue;
    const index = applyPalette(framePixels(ctx, frame.canvas as OffscreenCanvas, plan), palette, 'rgb565');
    gif.writeFrame(index, plan.width, plan.height, { palette: count === 0 ? palette : undefined, delay: 100, first: count === 0 });
    count += 1;
  }
  return count ? Math.round((gif.bytesView().length / count) * n + 800) : null;
}

// ── GIF to video ───────────────────────────────────────────────────────────

async function gifToVideo(file: File, req: GifToVideoRequest, onProgress?: Progress): Promise<WorkerOutcome> {
  const progress = throttled(onProgress);
  if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported('image/gif'))) {
    return fallback('image-decode', 'decode animated GIFs');
  }
  const decoder = new ImageDecoder({ data: file.stream(), type: 'image/gif' });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    const count = track?.frameCount ?? 0;
    if (!count) throw new Error('This GIF has no frames.');
    const firstFrame = (await decoder.decode({ frameIndex: 0 })).image;
    const width = even(firstFrame.displayWidth);
    const height = even(firstFrame.displayHeight);
    firstFrame.close();
    const format = makeFormat(req.container, false);
    const codec = await pickVideoCodec(req.container, format, req.codec, width, height);
    if (!codec) return fallback('video-encode', `encode ${req.codec === 'auto' ? CONTAINERS[req.container].label : videoCodecLabel(req.codec)} video`);
    const bitrate = planVideo({ width, height, fps: 15, bitrate: null }, codec, { quality: req.quality }).bitrate;
    const { output, sink } = makeOutput(format);
    const source = new VideoSampleSource({ codec, quality: new Quality({ bitrate }), keyFrameInterval: 2 });
    output.addVideoTrack(source);
    await output.start();
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw frames in a worker.');
    let t = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      // Browsers play delays under 20 ms as 100 ms; match them.
      const d = image.duration && image.duration >= 20_000 ? image.duration / 1e6 : 0.1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      image.close();
      const sample = new VideoSample(canvas, { timestamp: t, duration: d });
      await source.add(sample);
      sample.close();
      t += d;
      progress((i + 1) / count);
    }
    source.close();
    await output.finalize();
    return {
      ok: true,
      blob: sink.finish(format.mimeType),
      ext: CONTAINERS[req.container].ext,
      video: `Encoded ${count} frames to ${videoCodecLabel(codec)} ${width}×${height} at ${formatBitrate(bitrate)}`,
      notes: ['Transparent areas are filled with white.'],
    };
  } finally {
    decoder.close();
  }
}

// ── Merge ──────────────────────────────────────────────────────────────────

type Clip = {
  input: Input;
  v: InputVideoTrack | null;
  a: InputAudioTrack | null;
  start: number;
  duration: number;
  /** Set when the audio was converted to PCM first: that input, and where its timeline starts in the clip's. */
  pcm?: { input: Input; shift: number };
};

/**
 * Decodes an input's primary audio to a PCM WAV at the given rate and channel
 * count (Mediabunny resamples and remixes). Merging needs every clip's audio in
 * one format, because an audio source cannot change rate or channels midway.
 */
async function audioAsPcm(input: Input, sampleRate: number, numberOfChannels: number): Promise<{ blob: Blob; shift: number }> {
  const track = await input.getPrimaryAudioTrack();
  const shift = track ? Math.max(0, await track.getFirstTimestamp()) : 0;
  const format = new WavOutputFormat({ large: true });
  const { output, sink } = makeOutput(format);
  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: { discard: true },
    audio: { codec: 'pcm-s16', sampleRate, numberOfChannels, forceTranscode: true },
    showWarnings: false,
  });
  if (!conversion.isValid) throw new Error('Could not decode the audio of a clip.');
  await conversion.execute();
  return { blob: sink.finish('audio/wav'), shift };
}

function sameBytes(x?: AllowSharedBufferSource, y?: AllowSharedBufferSource): boolean {
  if (!x && !y) return true;
  if (!x || !y) return false;
  const a = ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(x);
  const b = ArrayBuffer.isView(y) ? new Uint8Array(y.buffer, y.byteOffset, y.byteLength) : new Uint8Array(y);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function canCopyAll(clips: Clip[], format: OutputFormat): Promise<boolean> {
  const first = clips[0]!;
  const vc = first.v ? await first.v.getDecoderConfig() : null;
  const ac = first.a ? await first.a.getDecoderConfig() : null;
  const firstRotation = first.v ? await first.v.getRotation() : 0;
  if (firstRotation !== 0 && !format.supportsVideoRotationMetadata) return false;
  if (vc &&!format.getSupportedVideoCodecs().includes((await first.v!.getCodec()) as VideoCodec)) return false;
  if (ac && !format.getSupportedAudioCodecs().includes((await first.a!.getCodec()) as AudioCodec)) return false;
  for (const c of clips) {
    if (!!c.v !== !!first.v || !!c.a !== !!first.a) return false;
    if (c.v) {
      const cfg = await c.v.getDecoderConfig();
      if (!cfg || !vc || cfg.codec !== vc.codec || cfg.codedWidth !== vc.codedWidth || cfg.codedHeight !== vc.codedHeight) return false;
      if (!sameBytes(cfg.description, vc.description)) return false;
      if ((await c.v.getRotation()) !== firstRotation) return false;
    }
    if (c.a) {
      const cfg = await c.a.getDecoderConfig();
      if (!cfg || !ac || cfg.codec !== ac.codec || cfg.sampleRate !== ac.sampleRate || cfg.numberOfChannels !== ac.numberOfChannels) return false;
      if (!sameBytes(cfg.description, ac.description)) return false;
    }
  }
  return true;
}

async function merge(files: File[], req: MergeRequest, onProgress?: Progress): Promise<WorkerOutcome> {
  const progress = throttled(onProgress);
  const clips: Clip[] = [];
  try {
    for (const file of files) {
      const input = openInput(file);
      clips.push({ input, v: null, a: null, start: 0, duration: 0 });
      if (!(await input.canRead())) return fallback('container-read', `read ${(extOf(file.name) || 'this').toUpperCase()} files`);
      const clip = clips[clips.length - 1]!;
      clip.v = CONTAINERS[req.container].kind === 'video' ? await input.getPrimaryVideoTrack() : null;
      clip.a = await input.getPrimaryAudioTrack();
      const tracks = [clip.v, clip.a].filter((t): t is InputVideoTrack | InputAudioTrack => t !== null);
      if (tracks.length === 0) throw new Error(`${file.name} has no ${CONTAINERS[req.container].kind === 'video' ? 'audio or video' : 'audio'} to merge.`);
      clip.start = Math.max(0, await input.getFirstTimestamp(tracks));
      clip.duration = (await input.computeDuration(tracks)) - clip.start;
    }
    const total = clips.reduce((s, c) => s + c.duration, 0) || 1;
    const format = makeFormat(req.container, false);
    const hasVideo = clips.some((c) => c.v);
    const hasAudio = clips.some((c) => c.a);
    const { output, sink } = makeOutput(format);
    const notes: string[] = [];

    if (await canCopyAll(clips, format)) {
      const first = clips[0]!;
      const vSource = first.v ? new EncodedVideoPacketSource((await first.v.getCodec()) as VideoCodec) : null;
      const aSource = first.a ? new EncodedAudioPacketSource((await first.a.getCodec()) as AudioCodec) : null;
      if (vSource) output.addVideoTrack(vSource, { rotation: await first.v!.getRotation() });
      if (aSource) output.addAudioTrack(aSource);
      await output.start();
      let offset = 0;
      let done = 0;
      for (const clip of clips) {
        const copyTrack = async (track: InputVideoTrack | InputAudioTrack, add: (p: import('mediabunny').EncodedPacket, meta?: EncodedVideoChunkMetadata & EncodedAudioChunkMetadata) => Promise<void>) => {
          const config = await track.getDecoderConfig();
          let firstPacket = true;
          for await (const packet of new EncodedPacketSink(track).packets()) {
            const ts = Math.max(offset, offset + packet.timestamp - clip.start);
            await add(packet.clone({ timestamp: ts }), firstPacket && config ? ({ decoderConfig: config } as EncodedVideoChunkMetadata & EncodedAudioChunkMetadata) : undefined);
            firstPacket = false;
            if (track === clip.v || !clip.v) progress((done + Math.max(0, packet.timestamp - clip.start)) / total);
          }
        };
        await Promise.all([
          clip.v && vSource ? copyTrack(clip.v, (p, m) => vSource.add(p, m)) : null,
          clip.a && aSource ? copyTrack(clip.a, (p, m) => aSource.add(p, m)) : null,
        ]);
        offset += clip.duration;
        done += clip.duration;
      }
      vSource?.close();
      aSource?.close();
      await output.finalize();
      return {
        ok: true,
        blob: sink.finish(format.mimeType),
        ext: CONTAINERS[req.container].ext,
        video: hasVideo ? `Joined ${clips.length} clips without re-encoding` : undefined,
        audio: hasAudio ? 'Copied without re-encoding' : undefined,
        notes,
      };
    }

    // Re-encode everything to the first video clip's size.
    let vSource: VideoSampleSource | null = null;
    let width = 0;
    let height = 0;
    let vDesc: string | undefined;
    if (hasVideo) {
      const ref = clips.find((c) => c.v)!.v!;
      width = even(await ref.getDisplayWidth());
      height = even(await ref.getDisplayHeight());
      const codec = await pickVideoCodec(req.container, format, 'auto', width, height);
      if (!codec) return fallback('video-encode', `encode ${CONTAINERS[req.container].label} video`);
      for (const c of clips) {
        if (c.v && !(await c.v.canDecode())) return fallback('video-decode', `decode ${videoCodecLabel(await c.v.getCodec())} video`);
      }
      let fps = 30;
      try {
        fps = (await ref.computeFrameRateMetrics({ targetPacketCount: 120 })).bestGuessFrameRate || 30;
      } catch {
        fps = 30;
      }
      // Never more than the richest clip has (per pixel of the output frame).
      const rates = await Promise.all(clips.map((c) => (c.v ? videoBitrate(c.v) : null)));
      const known = rates.filter((r): r is number => r !== null);
      const plan = planVideo({ width, height, fps, bitrate: known.length === rates.filter((_, i) => clips[i]!.v).length && known.length ? Math.max(...known) : null }, codec, { quality: req.quality });
      const bitrate = plan.bitrate;
      if (plan.cappedAt) notes.push(`Video bitrate held at ${formatBitrate(plan.cappedAt)}, the highest of the clips.`);
      vSource = new VideoSampleSource({
        codec,
        quality: new Quality({ bitrate }),
        sizeChangeBehavior: 'passThrough',
        transform: { width, height, fit: 'contain' },
      });
      output.addVideoTrack(vSource);
      vDesc = `Re-encoded to ${videoCodecLabel(codec)} ${width}×${height} at ${formatBitrate(bitrate)}`;
      const sizes = await Promise.all(clips.map(async (c) => (c.v ? `${even(await c.v.getDisplayWidth())}x${even(await c.v.getDisplayHeight())}` : null)));
      if (sizes.some((sz) => sz && sz !== `${width}x${height}`)) notes.push(`Clips of another size are scaled to fit ${width}×${height}, with black bars where the shape differs.`);
    }
    let aSource: AudioSampleSource | null = null;
    let rate = 48000;
    let channels = 2;
    let aDesc: string | undefined;
    if (hasAudio) {
      const codec = CONTAINERS[req.container].audio[0];
      if (!codec) return fallback('audio-encode', 'encode audio for this format');
      for (const c of clips) {
        if (c.a && !(await c.a.canDecode())) return fallback('audio-decode', `decode ${audioCodecLabel(await c.a.getCodec())} audio`);
      }
      const ref = clips.find((c) => c.a)!.a!;
      rate = encoderSampleRate(codec, await ref.getSampleRate()) ?? (await ref.getSampleRate());
      channels = Math.min(2, Math.max(...(await Promise.all(clips.map((c) => (c.a ? c.a.getNumberOfChannels() : 1))))));
      const lossless = codec === 'flac' || codec === 'pcm';
      // Never above the richest lossy clip (lossless clips allow the full request).
      const caps = await Promise.all(
        clips.map(async (c) => (c.a ? planAudioBitrate(req.audioBitrate, { codec: await c.a.getCodec(), bitrate: await videoBitrate(c.a) }).bitrate : 0)),
      );
      const wanted = Math.max(...caps, 32_000);
      if (!lossless && wanted < req.audioBitrate) notes.push(`Audio bitrate held at ${formatBitrate(wanted)}, the highest of the clips.`);
      const encoder = await resolveAudioEncoder(codec, channels, rate, lossless ? undefined : wanted);
      if (!encoder) return fallback('audio-encode', `encode ${audioCodecLabel(codec)} audio`);
      const bitrate = encoder.bitrate ?? wanted;
      // Bring clips with another rate or channel count to the output's, so every sample added matches.
      for (const c of clips) {
        if (!c.a) continue;
        if ((await c.a.getSampleRate()) === rate && (await c.a.getNumberOfChannels()) === channels) continue;
        const pcm = await audioAsPcm(c.input, rate, channels);
        const pcmInput = openInput(pcm.blob);
        c.pcm = { input: pcmInput, shift: pcm.shift };
        c.a = await pcmInput.getPrimaryAudioTrack();
      }
      aSource = new AudioSampleSource({
        codec: mbAudioCodec(codec),
        ...(lossless ? {} : { quality: new Quality({ bitrate }) }),
      });
      output.addAudioTrack(aSource);
      aDesc = `Re-encoded to ${audioCodecLabel(codec)}${lossless ? '' : ` ${formatBitrate(bitrate)}`} ${rate / 1000} kHz${encoder.wasm ? ' (WASM encoder)' : ''}`;
    }
    await output.start();

    let offset = 0;
    let done = 0;
    for (const clip of clips) {
      const end = clip.start + clip.duration;
      const videoLoop = async () => {
        if (!vSource) return;
        if (!clip.v) {
          // Audio-only clip inside a video: hold a black frame.
          const black = new OffscreenCanvas(width, height);
          const bctx = black.getContext('2d')!;
          bctx.fillStyle = '#000';
          bctx.fillRect(0, 0, width, height);
          for (let t = 0; t < clip.duration; t += 1) {
            const s = new VideoSample(black, { timestamp: offset + t, duration: Math.min(1, clip.duration - t) });
            await vSource.add(s);
            s.close();
          }
          return;
        }
        for await (const sample of new VideoSampleSink(clip.v).samples(clip.start, end)) {
          const ts = offset + sample.timestamp - clip.start;
          if (ts >= offset - 1e-6) {
            sample.setTimestamp(ts);
            await vSource.add(sample);
          }
          sample.close();
          if (!clip.a || !aSource) progress((done + sample.timestamp - clip.start) / total);
        }
      };
      const audioLoop = async () => {
        if (!aSource) return;
        let cursor = offset;
        const silence = async (until: number) => {
          while (cursor < until - 1e-4) {
            const frames = Math.min(Math.round((until - cursor) * rate), rate);
            if (frames <= 0) break;
            const s = new AudioSample({ data: new Float32Array(frames * channels), format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: cursor });
            await aSource!.add(s);
            s.close();
            cursor += frames / rate;
          }
        };
        if (clip.a) {
          const shift = clip.pcm?.shift ?? 0;
          for await (const sample of new AudioSampleSink(clip.a).samples(Math.max(0, clip.start - shift), end - shift)) {
            let s = sample;
            let ts = offset + sample.timestamp + shift - clip.start;
            if (ts < cursor - 1e-4) {
              const skip = Math.round((cursor - ts) * sample.sampleRate);
              if (skip >= sample.numberOfFrames) {
                sample.close();
                continue;
              }
              s = sample.trim(skip);
              ts = cursor;
            } else if (ts > cursor + 0.002) {
              await silence(ts);
            }
            s.setTimestamp(ts);
            await aSource.add(s);
            cursor = ts + s.duration;
            if (s !== sample) s.close();
            sample.close();
            progress((done + ts - offset) / total);
          }
        }
        await silence(offset + clip.duration);
      };
      await Promise.all([videoLoop(), audioLoop()]);
      offset += clip.duration;
      done += clip.duration;
    }
    vSource?.close();
    aSource?.close();
    await output.finalize();
    if (clips.some((c) => !c.a) && hasAudio) notes.push('Clips without sound are filled with silence.');
    return { ok: true, blob: sink.finish(format.mimeType), ext: CONTAINERS[req.container].ext, video: vDesc, audio: aDesc, notes };
  } finally {
    for (const c of clips) {
      c.input.dispose();
      c.pcm?.input.dispose();
    }
  }
}

// ── Thumbnails and capabilities ────────────────────────────────────────────

async function thumbnails(file: File, count: number, height: number): Promise<Blob[]> {
  return withInput(file, (input) => thumbnailsInput(input, count, height));
}

async function thumbnailsInput(input: Input, count: number, height: number): Promise<Blob[]> {
  if (!(await input.canRead())) return [];
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) return [];
  const start = Math.max(0, await track.getFirstTimestamp());
  const end = await track.computeDuration();
  const step = (end - start) / count;
  const times = Array.from({ length: count }, (_, i) => start + step * (i + 0.5));
  const width = Math.max(2, Math.round((height * (await track.getDisplayWidth())) / (await track.getDisplayHeight())));
  const sink = new CanvasSink(track, { width, height, fit: 'fill' });
  const out: Blob[] = [];
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    if (!frame) continue;
    const c = frame.canvas as OffscreenCanvas;
    out.push(await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }));
  }
  return out;
}

/**
 * Peak level (0–1) of the primary audio track in `buckets` equal slices of
 * the file's duration, for a timeline. Decodes the whole track, so it runs
 * in the preview worker. Empty when there is no decodable audio.
 */
async function waveform(file: File, buckets: number): Promise<number[]> {
  return withInput(file, async (input) => {
    if (!(await input.canRead())) return [];
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return [];
    const info = await describe(input, file);
    const start = info.startTime;
    const span = info.duration || (await track.computeDuration()) - start;
    if (!(span > 0)) return [];
    const peaks = new Array<number>(buckets).fill(0);
    for await (const sample of new AudioSampleSink(track).samples()) {
      const n = sample.numberOfFrames;
      const plane = new Float32Array(n);
      sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
      const rate = sample.sampleRate;
      const t0 = sample.timestamp - start;
      // Stride through long chunks; peaks only need a few hundred points per bucket.
      const stride = Math.max(1, Math.floor(n / 512));
      for (let i = 0; i < n; i += stride) {
        const b = Math.floor(((t0 + i / rate) / span) * buckets);
        if (b < 0 || b >= buckets) continue;
        const v = Math.abs(plane[i]!);
        if (v > peaks[b]!) peaks[b] = v;
      }
      sample.close();
    }
    const max = Math.max(...peaks, 1e-6);
    return peaks.map((p) => Math.min(1, p / max));
  });
}

async function capabilities(): Promise<Capabilities> {
  const videoEncode: VideoCodecId[] = [];
  for (const c of VIDEO_CODECS) if (await canEncodeVideoAt(c, 1280, 720)) videoEncode.push(c);
  const audioEncode: AudioCodecId[] = ['pcm'];
  const wasmAudio: AudioCodecId[] = [];
  for (const c of ['aac', 'opus', 'mp3', 'flac', 'vorbis'] as const) {
    if (await canEncodeAudio(c).catch(() => false)) audioEncode.push(c);
    else if (c === 'aac' || c === 'mp3' || c === 'flac') {
      audioEncode.push(c);
      wasmAudio.push(c);
    }
  }
  const imageDecoder = typeof ImageDecoder !== 'undefined' && (await ImageDecoder.isTypeSupported('image/gif').catch(() => false));
  return { videoEncode, audioEncode, wasmAudio, imageDecoder };
}

async function probe(file: File): Promise<MediaInfo> {
  return withInput(file, (input) => describe(input, file));
}

/** Marks outcomes after which the worker should be replaced (see resolveAudioEncoder). */
function recycling<A extends unknown[]>(fn: (...args: A) => Promise<WorkerOutcome>) {
  return async (...args: A): Promise<WorkerOutcome> => {
    const outcome = await fn(...args);
    return wasmRegistered.has('aac') ? { ...outcome, recycle: true } : outcome;
  };
}

const api = {
  probe,
  capabilities,
  convert: recycling(convert),
  videoToGif,
  estimateGif,
  gifToVideo: recycling(gifToVideo),
  merge: recycling(merge),
  thumbnails,
  waveform,
};

export type MediaWorkerApi = typeof api;

expose(api);
