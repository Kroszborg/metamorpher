'use client';

/* eslint-disable @next/next/no-img-element -- seek thumbnails are local object URLs */

import {
  Camera01Icon,
  GoBackward10SecIcon,
  GoForward10SecIcon,
  InformationCircleIcon,
  MusicNote01Icon,
  NextIcon,
  PauseIcon,
  PictureInPictureOnIcon,
  PlayIcon,
  PlayListIcon,
  PreviousIcon,
  RepeatIcon,
  SubtitleIcon,
  VolumeHighIcon,
  VolumeMute02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { describeMedia } from '@/components/media/preview-card';
import { useMediaInfo, useThumbnails, useWaveform } from '@/components/media/use-media';
import { Button } from '@/components/ui/button';
import { audioCodecLabel, formatBitrate, type MediaInfo, mediaEngine, videoCodecLabel } from '@/engines/media';
import { baseName, downloadBlob, formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, InfoRows, PanelTitle, ViewerProblem } from '../bits';
import { type Shortcut, useKeys, useShortcuts, type ViewerProps } from '../context';
import { extOf } from '../sniff';
import { formatClock, parseSubtitles, toVtt } from './subtitles';

const SHORTCUTS: Shortcut[] = [
  { keys: 'Space  K', label: 'Play or pause' },
  { keys: '←  →', label: 'Back or forward 5 seconds' },
  { keys: 'J  L', label: 'Back or forward 10 seconds' },
  { keys: ',  .', label: 'Previous or next frame (paused)' },
  { keys: '↑  ↓', label: 'Volume up or down (to 200%)' },
  { keys: 'M', label: 'Mute' },
  { keys: '<  >', label: 'Slower or faster' },
  { keys: 'A  B', label: 'Set loop start or end' },
  { keys: 'R', label: 'Loop on or off' },
  { keys: 'C', label: 'Subtitles on or off' },
  { keys: 'S', label: 'Save the current frame' },
  { keys: 'P', label: 'Picture-in-picture' },
  { keys: '0 … 9', label: 'Jump to 0% … 90%' },
  { keys: 'N', label: 'Next in the playlist' },
];

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MEDIA_RE = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|ogv|3gp|mpe?g|ts|m2ts|mts|mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|aiff?|mka|weba)$/i;
const SUB_RE = /\.(srt|vtt|ass|ssa)$/i;
/** Containers the browser never plays: go straight to a playable copy. */
const NEVER_NATIVE = new Set(['avi', 'wmv', 'wma', 'flv', 'mpg', 'mpeg', 'vob', '3gp', 'aiff', 'aif', 'aifc', 'ts', 'm2ts', 'mts']);
const FFMPEG_LIMIT = 1024 * 1024 * 1024;

type Source = { blob: Blob; how: 'native' | 'copy' | 'proxy'; note?: string };
type Track = { label: string; url: string };
type Panel = 'info' | 'playlist' | null;

const isMedia = (f: File) => MEDIA_RE.test(f.name) || f.type.startsWith('video/') || f.type.startsWith('audio/');

function infoRows(info: MediaInfo, file: File): [string, string | undefined][] {
  const v = info.video;
  const a = info.audio;
  return [
    ['Container', info.format ?? extOf(file.name).toUpperCase()],
    ['Duration', formatClock(info.duration)],
    ['File size', formatBytes(info.size)],
    ['Overall bitrate', info.duration > 0 ? formatBitrate((info.size * 8) / info.duration) : undefined],
    ['Video', v ? `${v.label ?? videoCodecLabel(v.codec)}` : undefined],
    ['Picture', v ? `${v.width} × ${v.height}${v.rotation ? ` (turned ${v.rotation}°)` : ''}` : undefined],
    ['Frame rate', v?.fps ? `${Math.round(v.fps * 1000) / 1000} fps` : undefined],
    ['Video bitrate', v?.bitrate ? formatBitrate(v.bitrate) : undefined],
    ['Audio', a ? `${a.label ?? audioCodecLabel(a.codec)}` : undefined],
    ['Sample rate', a?.sampleRate ? `${(a.sampleRate / 1000).toFixed(1)} kHz` : undefined],
    ['Channels', a ? (a.channels === 1 ? 'Mono' : a.channels === 2 ? 'Stereo' : `${a.channels} channels`) : undefined],
    ['Audio bitrate', a?.bitrate ? formatBitrate(a.bitrate) : undefined],
    ['Read by', info.engine === 'ffmpeg' ? 'ffmpeg.wasm (software)' : 'Mediabunny (WebCodecs)'],
  ];
}

/** Draws the live spectrum of what is playing. */
function Spectrum({ analyser, playing }: { analyser: AnalyserNode | null; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !analyser) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const colour = getComputedStyle(c).color;
    const draw = () => {
      const w = (c.width = c.clientWidth * devicePixelRatio);
      const h = (c.height = c.clientHeight * devicePixelRatio);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colour;
      const bars = 64;
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        // Logarithmic bins: more resolution in the low end.
        const from = Math.floor(Math.pow(data.length, i / bars));
        const to = Math.max(from + 1, Math.floor(Math.pow(data.length, (i + 1) / bars)));
        let v = 0;
        for (let k = from; k < to && k < data.length; k++) v = Math.max(v, data[k]!);
        const bh = (v / 255) * h;
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, playing]);
  return <canvas ref={ref} aria-hidden className="h-full w-full text-primary/70" />;
}

export default function MediaViewer({ file, sniff, files, index, onIndex }: ViewerProps) {
  useShortcuts(SHORTCUTS);
  const ext = extOf(file.name) || sniff.ext;
  const isVideo = sniff.kind === 'video';
  const { info } = useMediaInfo(file, true);
  const [source, setSource] = useState<Source>({ blob: file, how: 'native' });
  const [fixing, setFixing] = useState<{ progress: number; note: string } | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const media = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [ab, setAb] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackOn, setTrackOn] = useState(-1);
  const [panel, setPanel] = useState<Panel>(files.filter(isMedia).length > 1 ? 'playlist' : null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [audioTracks, setAudioTracks] = useState<{ id: number; label: string; on: boolean }[]>([]);
  const graph = useRef<{ ctx: AudioContext; gain: GainNode; analyser: AnalyserNode } | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const subInput = useRef<HTMLInputElement>(null);
  const fixJob = useRef<AbortController | null>(null);

  const playlist = useMemo(() => files.map((f, i) => ({ f, i })).filter(({ f }) => isMedia(f)), [files]);
  const thumbs = useThumbnails(isVideo ? file : null, 24, 90);
  const peaks = useWaveform(file, 720, !isVideo);
  const fps = info?.video?.fps ?? 30;

  useEffect(() => {
    const u = URL.createObjectURL(source.blob);
    queueMicrotask(() => setUrl(u));
    return () => URL.revokeObjectURL(u);
  }, [source]);

  // Subtitle files dropped together with the video load automatically.
  useEffect(() => {
    const base = baseName(file.name).toLowerCase();
    const subs = files.filter((f) => SUB_RE.test(f.name) && baseName(f.name).toLowerCase().startsWith(base));
    if (!subs.length) return;
    let live = true;
    const made: string[] = [];
    Promise.all(subs.map(async (f) => ({ label: f.name, url: URL.createObjectURL(new Blob([toVtt(parseSubtitles(await f.text(), extOf(f.name)))], { type: 'text/vtt' })) }))).then((t) => {
      t.forEach((x) => made.push(x.url));
      if (live) {
        setTracks(t);
        setTrackOn(0);
      }
    }, () => undefined);
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [file, files]);

  const makePlayable = useCallback(async () => {
    fixJob.current?.abort();
    const ctrl = new AbortController();
    fixJob.current = ctrl;
    setFixError(null);
    setFixing({ progress: 0, note: 'Reading the file' });
    try {
      const probe = await mediaEngine.inspect(file, ctrl.signal);
      const hasVideo = !!probe.video;
      const onProgress = (f: number, note?: string) => !ctrl.signal.aborted && setFixing({ progress: f, note: note ?? 'Converting' });
      if (probe.engine !== 'ffmpeg' && probe.readable && (!hasVideo || probe.video!.canDecode) && (!probe.audio || probe.audio.canDecode)) {
        setFixing({ progress: 0, note: 'Re-packaging into a format this browser plays (streams copied where possible)' });
        const r = await mediaEngine.convert(
          file,
          {
            container: hasVideo ? 'mp4' : 'm4a',
            video: hasVideo ? { quality: 'copy' } : { discard: true },
            audio: probe.audio ? { bitrate: 'copy' } : { discard: true },
          },
          { signal: ctrl.signal, onProgress },
        );
        setSource({ blob: r.blob, how: 'copy', note: `Playing a re-packaged copy (${r.report.engineLabel}); the file itself is unchanged.` });
      } else {
        if (file.size > FFMPEG_LIMIT) throw new Error(`This browser cannot play ${sniff.format} and the software engine handles files up to 1 GB; this one is ${formatBytes(file.size)}.`);
        setFixing({ progress: 0, note: `Software engine (ffmpeg.wasm, about 31 MB, loads once): making ${hasVideo ? 'a 360p preview copy' : 'a playable copy'}` });
        const blob = await mediaEngine.previewProxy(file, { signal: ctrl.signal, onProgress });
        setSource({ blob, how: 'proxy', note: `Playing ${hasVideo ? 'a 360p preview copy' : 'a converted copy'} made by the software engine; the file itself is unchanged.` });
      }
      setFixing(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setFixing(null);
      setFixError(err instanceof Error ? err.message : 'A playable copy could not be made.');
    }
  }, [file, sniff.format]);

  useEffect(() => () => fixJob.current?.abort(), []);

  // Containers no browser plays go straight to a playable copy.
  useEffect(() => {
    if (source.how === 'native' && NEVER_NATIVE.has(ext)) queueMicrotask(() => void makePlayable());
  }, [ext, source.how, makePlayable]);

  const el = () => media.current;

  // Element events.
  useEffect(() => {
    const m = media.current;
    if (!m || !url) return;
    const onTime = () => {
      setTime(m.currentTime);
      if (m.buffered.length) setBuffered(m.buffered.end(m.buffered.length - 1));
    };
    const onMeta = () => {
      setDuration(Number.isFinite(m.duration) ? m.duration : (info?.duration ?? 0));
      const list = (m as unknown as { audioTracks?: ArrayLike<{ id: string; label: string; language: string; enabled: boolean }> }).audioTracks;
      if (list && list.length > 1) setAudioTracks(Array.from(list, (t, i) => ({ id: i, label: t.label || t.language || `Track ${i + 1}`, on: t.enabled })));
      // Plays, but shows no picture (a codec without a decoder here): make a copy.
      if (isVideo && source.how === 'native' && m.videoWidth === 0 && info?.video) void makePlayable();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => {
      if (source.how === 'native') void makePlayable();
      else setFixError('The converted copy could not be played either.');
    };
    const onEnded = () => {
      if (playlist.length > 1 && !loop) {
        const at = playlist.findIndex((p) => p.i === index);
        const next = playlist[at + 1];
        if (next) onIndex(next.i);
      }
    };
    m.addEventListener('timeupdate', onTime);
    m.addEventListener('progress', onTime);
    m.addEventListener('loadedmetadata', onMeta);
    m.addEventListener('durationchange', onMeta);
    m.addEventListener('play', onPlay);
    m.addEventListener('pause', onPause);
    m.addEventListener('error', onError);
    m.addEventListener('ended', onEnded);
    return () => {
      m.removeEventListener('timeupdate', onTime);
      m.removeEventListener('progress', onTime);
      m.removeEventListener('loadedmetadata', onMeta);
      m.removeEventListener('durationchange', onMeta);
      m.removeEventListener('play', onPlay);
      m.removeEventListener('pause', onPause);
      m.removeEventListener('error', onError);
      m.removeEventListener('ended', onEnded);
    };
  }, [url, info, isVideo, source.how, makePlayable, playlist, index, onIndex, loop]);

  // A–B loop and smooth time while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const m = media.current;
      if (m) {
        if (ab.a !== null && ab.b !== null && m.currentTime >= ab.b) m.currentTime = ab.a;
        setTime(m.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ab]);

  useEffect(() => {
    const m = media.current;
    if (!m) return;
    m.playbackRate = rate;
    m.loop = loop;
    m.muted = muted;
    // Above 100% the gain node boosts; the element stays at full volume then.
    if (graph.current) {
      graph.current.gain.gain.value = volume;
      m.volume = 1;
    } else m.volume = Math.min(1, volume);
  }, [rate, loop, muted, volume, url]);

  useEffect(() => {
    const m = media.current;
    if (!m) return;
    const list = m.textTracks;
    for (let i = 0; i < list.length; i++) list[i]!.mode = i === trackOn ? 'showing' : 'disabled';
  }, [trackOn, tracks, url]);

  useEffect(
    () => () => {
      void graph.current?.ctx.close();
      graph.current = null;
    },
    [url],
  );

  /** Web Audio for the volume boost and the spectrum, connected on first play (needs a user gesture). */
  const ensureGraph = useCallback(() => {
    const m = media.current;
    if (!m || graph.current) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(m);
      const gain = ctx.createGain();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(gain).connect(an).connect(ctx.destination);
      gain.gain.value = volume;
      m.volume = 1;
      graph.current = { ctx, gain, analyser: an };
      setAnalyser(an);
    } catch {
      // Without Web Audio the player still works, capped at 100%.
    }
  }, [volume]);

  const toggle = useCallback(() => {
    const m = media.current;
    if (!m) return;
    if (m.paused) {
      ensureGraph();
      void graph.current?.ctx.resume();
      void m.play().catch(() => undefined);
    } else m.pause();
  }, [ensureGraph]);

  const seek = useCallback((t: number) => {
    const m = media.current;
    if (!m) return;
    m.currentTime = Math.max(0, Math.min(m.duration || 0, t));
    setTime(m.currentTime);
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const m = media.current;
      if (!m) return;
      m.pause();
      seek(m.currentTime + dir / fps);
    },
    [seek, fps],
  );

  const screenshot = useCallback(() => {
    const m = media.current;
    if (!m || !isVideo || !m.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = m.videoWidth;
    c.height = m.videoHeight;
    c.getContext('2d')?.drawImage(m, 0, 0);
    c.toBlob((b) => {
      if (b) downloadBlob(b, `${baseName(file.name)}-${formatClock(m.currentTime).replace(/:/g, '-')}.png`);
      c.width = 0;
    }, 'image/png');
  }, [isVideo, file.name]);

  const pip = useCallback(() => {
    const m = media.current;
    if (!m || !isVideo) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void m.requestPictureInPicture?.().catch(() => toast.error('Picture-in-picture is not available here.'));
  }, [isVideo]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (playlist.length < 2) return;
      const at = playlist.findIndex((p) => p.i === index);
      onIndex(playlist[(at + dir + playlist.length) % playlist.length]!.i);
    },
    [playlist, index, onIndex],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const m = el();
      if (!m) return false;
      const k = e.key;
      if (k === ' ' || k === 'k' || k === 'K') toggle();
      else if (k === 'ArrowLeft') seek(m.currentTime - 5);
      else if (k === 'ArrowRight') seek(m.currentTime + 5);
      else if (k === 'j' || k === 'J') seek(m.currentTime - 10);
      else if (k === 'l' || k === 'L') seek(m.currentTime + 10);
      else if (k === ',') step(-1);
      else if (k === '.') step(1);
      else if (k === 'ArrowUp') setVolume((v) => Math.min(2, Math.round((v + 0.1) * 10) / 10));
      else if (k === 'ArrowDown') setVolume((v) => Math.max(0, Math.round((v - 0.1) * 10) / 10));
      else if (k === 'm' || k === 'M') setMuted((v) => !v);
      else if (k === '<') setRate((r) => SPEEDS[Math.max(0, SPEEDS.indexOf(r) - 1)] ?? r);
      else if (k === '>') setRate((r) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(r) + 1)] ?? r);
      else if (k === 'a' || k === 'A') setAb((x) => ({ a: m.currentTime, b: x.b !== null && x.b > m.currentTime ? x.b : null }));
      else if (k === 'b' || k === 'B') setAb((x) => ({ a: x.a ?? 0, b: m.currentTime > (x.a ?? 0) ? m.currentTime : null }));
      else if (k === 'r' || k === 'R') setLoop((v) => !v);
      else if (k === 'c' || k === 'C') setTrackOn((t) => (tracks.length ? (t >= 0 ? -1 : 0) : -1));
      else if (k === 's' || k === 'S') screenshot();
      else if (k === 'p' || k === 'P') pip();
      else if (k === 'n' || k === 'N') go(1);
      else if (/^[0-9]$/.test(k)) seek((m.duration || 0) * (Number(k) / 10));
      else return false;
      return true;
    },
    [toggle, seek, step, tracks.length, screenshot, pip, go],
  );
  useKeys(onKey);

  const addSubtitles = async (f: File) => {
    try {
      const cues = parseSubtitles(await f.text(), extOf(f.name));
      if (!cues.length) throw new Error('No subtitles were found in that file.');
      const u = URL.createObjectURL(new Blob([toVtt(cues)], { type: 'text/vtt' }));
      setTracks((t) => [...t, { label: f.name, url: u }]);
      setTrackOn(tracks.length);
      toast.success(`${cues.length.toLocaleString()} subtitles loaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Those subtitles could not be read.');
    }
  };

  const extractEmbedded = async () => {
    const id = toast.loading('Looking for subtitles in the file (software engine)…');
    try {
      const { ffmpegEngine } = await import('@/engines/ffmpeg');
      const vtt = await ffmpegEngine.run({ input: file, inputExt: ext, outputExt: 'vtt', args: (i, o) => ['-i', i, '-map', '0:s:0', '-c:s', 'webvtt', o] });
      const text = await vtt.text();
      if (!/-->/.test(text)) throw new Error('none');
      setTracks((t) => [...t, { label: 'Embedded', url: URL.createObjectURL(new Blob([text], { type: 'text/vtt' })) }]);
      setTrackOn(tracks.length);
      toast.success('Embedded subtitles loaded', { id });
    } catch {
      toast.error('No text subtitles could be read from this file (picture-based subtitles are not supported).', { id });
    }
  };

  const total = duration || info?.duration || 0;
  const pct = (t: number) => (total ? `${(t / total) * 100}%` : '0%');
  const thumbAt = (t: number) => (thumbs?.length && total ? thumbs[Math.min(thumbs.length - 1, Math.floor((t / total) * thumbs.length))] : null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1">
        <div ref={stage} className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col', isVideo ? 'bg-black' : 'bg-card')}>
          {isVideo ? (
            <video
              key={url ?? 'none'}
              ref={media}
              src={url ?? undefined}
              playsInline
              preload="metadata"
              onClick={toggle}
              onDoubleClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))}
              className="min-h-0 w-full flex-1 object-contain [&::cue]:bg-black/70 [&::cue]:text-[1.1rem]"
              aria-label={`Video ${file.name}`}
            >
              {tracks.map((t, i) => (
                <track key={t.url} kind="subtitles" src={t.url} label={t.label} default={i === trackOn} />
              ))}
            </video>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
              <audio key={url ?? 'none'} ref={media as unknown as React.RefObject<HTMLAudioElement>} src={url ?? undefined} preload="metadata" aria-label={`Audio ${file.name}`} />
              <div className="min-w-0">
                <p className="truncate font-display text-xl font-semibold">{baseName(file.name)}</p>
                <p className="truncate text-xs text-muted-foreground">{info ? describeMedia(info) : sniff.format}</p>
              </div>
              <div className="relative min-h-0 flex-1">
                {analyser ? (
                  <div className="absolute inset-0 opacity-60">
                    <Spectrum analyser={analyser} playing={playing} />
                  </div>
                ) : (
                  <div className="grid h-full place-items-center text-muted-foreground/40">
                    <HugeiconsIcon icon={MusicNote01Icon} strokeWidth={1.5} className="size-20" />
                  </div>
                )}
              </div>
              <svg
                viewBox={`0 0 ${peaks?.length || 1} 100`}
                preserveAspectRatio="none"
                className="h-24 w-full shrink-0 cursor-pointer"
                role="slider"
                aria-label="Waveform: click to seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                aria-valuenow={Math.round(time)}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  seek(((e.clientX - r.left) / r.width) * total);
                }}
              >
                {(peaks ?? []).map((p, i) => {
                  const h = Math.max(1, p * 96);
                  const played = total && i / (peaks?.length ?? 1) <= time / total;
                  return <rect key={i} x={i} y={50 - h / 2} width={0.7} height={h} className={played ? 'fill-primary' : 'fill-muted-foreground/40'} />;
                })}
              </svg>
              {!peaks ? <p className="text-center text-xs text-muted-foreground">Drawing the waveform…</p> : null}
            </div>
          )}
          {fixing || fixError ? (
            <div className="absolute inset-0 grid place-items-center bg-background/90 p-6">
              {fixError ? (
                <ViewerProblem title="This file cannot be played here">{fixError}</ViewerProblem>
              ) : (
                <div className="flex w-80 max-w-full flex-col items-center gap-3 text-center">
                  <p className="text-sm font-semibold">This browser cannot play {sniff.format} directly</p>
                  <p className="text-xs text-muted-foreground">{fixing!.note}…</p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(fixing!.progress * 100)}%` }} />
                  </div>
                  <p className="text-[0.68rem] text-muted-foreground">Done on this device. The original file is not changed.</p>
                  <Button variant="outline" size="lg" onClick={() => fixJob.current?.abort()}>
                    Stop
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {panel ? (
          <aside data-viewer-panel aria-label={panel === 'info' ? 'Media information' : 'Playlist'} className="flex flex-col border-l bg-card max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:max-h-[60%] max-lg:border-t max-lg:border-l-0 lg:w-80">
            <PanelTitle action={<ChipButton onClick={() => setPanel(null)}>Close</ChipButton>}>{panel === 'info' ? 'Media information' : `Playlist · ${playlist.length}`}</PanelTitle>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {panel === 'info' ? (
                info ? (
                  <div className="flex flex-col gap-3 p-1">
                    <InfoRows rows={infoRows(info, file)} />
                    {source.note ? <p className="text-xs text-muted-foreground">{source.note}</p> : null}
                    {audioTracks.length > 1 ? (
                      <label className="flex flex-col gap-1 text-xs">
                        Audio track
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2"
                          value={audioTracks.find((t) => t.on)?.id ?? 0}
                          onChange={(e) => {
                            const list = (media.current as unknown as { audioTracks?: ArrayLike<{ enabled: boolean }> }).audioTracks;
                            if (!list) return;
                            for (let i = 0; i < list.length; i++) list[i]!.enabled = i === Number(e.target.value);
                            setAudioTracks((ts) => ts.map((t) => ({ ...t, on: t.id === Number(e.target.value) })));
                          }}
                        >
                          {audioTracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : (
                  <p className="p-1 text-xs text-muted-foreground">Reading…</p>
                )
              ) : (
                <ol className="flex flex-col gap-0.5">
                  {playlist.map(({ f, i }, n) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onIndex(i)}
                        aria-current={i === index ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
                          i === index && 'bg-primary/12 font-medium text-foreground',
                        )}
                      >
                        <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{n + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {/* Seek bar */}
      <div className="border-t bg-card px-3 pt-2">
        <div
          className="group relative h-5 cursor-pointer"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            setHover({ x: e.clientX - r.left, t: f * total });
          }}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => {
            const target = e.currentTarget;
            const r = target.getBoundingClientRect();
            target.setPointerCapture(e.pointerId);
            const at = (x: number) => seek(Math.max(0, Math.min(1, (x - r.left) / r.width)) * total);
            at(e.clientX);
            const move = (ev: PointerEvent) => at(ev.clientX);
            const up = () => {
              target.removeEventListener('pointermove', move);
              target.removeEventListener('pointerup', up);
            };
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', up);
          }}
          role="slider"
          tabIndex={0}
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatClock(time)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              seek(time + (e.key === 'ArrowLeft' ? -5 : 5));
            }
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-y-0 left-0 bg-muted-foreground/25" style={{ width: pct(buffered) }} />
            {ab.a !== null ? (
              <div className="absolute inset-y-0 bg-warning/40" style={{ left: pct(ab.a), width: ab.b !== null ? `calc(${pct(ab.b)} - ${pct(ab.a)})` : '2px' }} />
            ) : null}
            <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(time) }} />
          </div>
          <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow" style={{ left: pct(time) }} />
          {hover && total ? (
            <div className="pointer-events-none absolute bottom-6 z-10 -translate-x-1/2 overflow-hidden rounded-md border bg-popover text-center shadow-lg" style={{ left: Math.max(60, hover.x) }}>
              {thumbAt(hover.t) ? <img src={thumbAt(hover.t)!} alt="" className="block h-[68px] w-auto" /> : null}
              <span className="block px-2 py-0.5 text-[0.68rem] tabular-nums">{formatClock(hover.t)}</span>
            </div>
          ) : null}
        </div>
      </div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1 bg-card px-2 pb-2">
        {playlist.length > 1 ? <IconButton icon={PreviousIcon} label="Previous in the playlist" onClick={() => go(-1)} /> : null}
        <IconButton icon={GoBackward10SecIcon} label="Back 10 seconds (J)" onClick={() => seek(time - 10)} />
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
          className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} strokeWidth={2.2} className="size-4" />
        </button>
        <IconButton icon={GoForward10SecIcon} label="Forward 10 seconds (L)" onClick={() => seek(time + 10)} />
        {playlist.length > 1 ? <IconButton icon={NextIcon} label="Next in the playlist (N)" onClick={() => go(1)} /> : null}
        <span className="px-1.5 text-xs text-muted-foreground tabular-nums">
          {formatClock(time)} / {formatClock(total)}
        </span>
        {isVideo ? (
          <>
            <ChipButton onClick={() => step(-1)} title="Previous frame (,)" className="max-sm:hidden">
              −1f
            </ChipButton>
            <ChipButton onClick={() => step(1)} title="Next frame (.)" className="max-sm:hidden">
              +1f
            </ChipButton>
          </>
        ) : null}
        <span className="flex-1" />
        <label className="inline-flex h-8 items-center text-xs text-muted-foreground">
          <span className="sr-only">Speed</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Speed" className="h-7 rounded-md border border-input bg-background px-1 text-xs text-foreground">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <IconButton icon={RepeatIcon} label="Loop (R)" pressed={loop} onClick={() => setLoop((v) => !v)} />
        <ChipButton
          pressed={ab.a !== null}
          onClick={() => {
            const m = media.current;
            if (!m) return;
            if (ab.a === null) setAb({ a: m.currentTime, b: null });
            else if (ab.b === null && m.currentTime > ab.a) setAb({ a: ab.a, b: m.currentTime });
            else setAb({ a: null, b: null });
          }}
          title="A–B loop: first click sets A, second sets B, third clears (keys A and B)"
        >
          {ab.a === null ? 'A–B' : ab.b === null ? `A ${formatClock(ab.a)} → B?` : `${formatClock(ab.a)}–${formatClock(ab.b)}`}
        </ChipButton>
        <IconButton icon={muted || volume === 0 ? VolumeMute02Icon : VolumeHighIcon} label="Mute (M)" pressed={muted} onClick={() => setMuted((v) => !v)} />
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={volume}
          onChange={(e) => {
            ensureGraph();
            setVolume(Number(e.target.value));
          }}
          aria-label="Volume (up to 200%)"
          className="h-1 w-20 accent-[var(--primary)]"
        />
        <span className={cn('w-9 text-xs tabular-nums', volume > 1 ? 'text-warning' : 'text-muted-foreground')}>{Math.round(volume * 100)}%</span>
        {isVideo ? (
          <>
            <IconButton
              icon={SubtitleIcon}
              label={tracks.length ? 'Subtitles (C)' : 'Add subtitles (SRT, VTT, ASS)'}
              pressed={trackOn >= 0}
              onClick={() => (tracks.length ? setTrackOn((t) => (t >= 0 ? -1 : 0)) : subInput.current?.click())}
            />
            {tracks.length > 1 ? (
              <select value={trackOn} onChange={(e) => setTrackOn(Number(e.target.value))} aria-label="Subtitle track" className="h-7 max-w-32 rounded-md border border-input bg-background px-1 text-xs">
                <option value={-1}>Off</option>
                {tracks.map((t, i) => (
                  <option key={t.url} value={i}>
                    {t.label}
                  </option>
                ))}
              </select>
            ) : null}
            <ChipButton onClick={() => subInput.current?.click()} className="max-md:hidden">
              + Subtitles
            </ChipButton>
            {/^(mkv|mp4|m4v|mov|webm)$/.test(ext) ? (
              <ChipButton onClick={() => void extractEmbedded()} className="max-md:hidden" title="Read text subtitles stored inside the video (uses the software engine)">
                Embedded
              </ChipButton>
            ) : null}
            <IconButton icon={Camera01Icon} label="Save this frame as PNG (S)" onClick={screenshot} />
            <IconButton icon={PictureInPictureOnIcon} label="Picture-in-picture (P)" onClick={pip} />
          </>
        ) : null}
        <IconButton icon={InformationCircleIcon} label="Media information" pressed={panel === 'info'} onClick={() => setPanel((p) => (p === 'info' ? null : 'info'))} />
        {playlist.length > 1 ? (
          <IconButton icon={PlayListIcon} label="Playlist" pressed={panel === 'playlist'} onClick={() => setPanel((p) => (p === 'playlist' ? null : 'playlist'))} />
        ) : null}
        <input
          ref={subInput}
          type="file"
          hidden
          accept=".srt,.vtt,.ass,.ssa"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void addSubtitles(f);
          }}
        />
      </div>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{info ? describeMedia(info) : 'Reading the file…'}</span>
        {source.note ? <span className="text-warning">{source.note}</span> : null}
      </footer>
    </div>
  );
}
