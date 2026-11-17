/**
 * Audio helpers for speech recognition: read a 16-bit PCM WAV into floats,
 * cut long recordings into ≤ 30 s windows at quiet moments, and write
 * transcripts as text, SRT or WebVTT.
 */

export const SAMPLE_RATE = 16_000;

/** Mono float samples from a PCM WAV (8/16/24/32-bit integer or 32-bit float), mixed down and resampled to `rate`. */
export function decodeWav(buffer: ArrayBuffer, rate = SAMPLE_RATE): Float32Array {
  const view = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let at = 12;
  let format = 1;
  let channels = 1;
  let sampleRate = rate;
  let bits = 16;
  let data: { start: number; length: number } | null = null;
  while (at + 8 <= view.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      format = view.getUint16(at + 8, true);
      channels = view.getUint16(at + 10, true);
      sampleRate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
      if (format === 0xfffe) format = view.getUint16(at + 32, true);
    } else if (id === 'data') {
      // Streaming writers may leave the size as 0 or 0xFFFFFFFF: use the rest of the file.
      const length = size === 0 || size === 0xffffffff || at + 8 + size > view.byteLength ? view.byteLength - at - 8 : size;
      data = { start: at + 8, length };
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (!data) throw new Error('The WAV file has no audio data.');
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = data.start + (f * channels + c) * bytes;
      let v: number;
      if (format === 3 && bits === 32) v = view.getFloat32(p, true);
      else if (bits === 16) v = view.getInt16(p, true) / 32768;
      else if (bits === 24) v = ((view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16)) / 8388608);
      else if (bits === 32) v = view.getInt32(p, true) / 2147483648;
      else v = (view.getUint8(p) - 128) / 128;
      sum += v;
    }
    mono[f] = sum / channels;
  }
  return sampleRate === rate ? mono : resample(mono, sampleRate, rate);
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  const out = new Float32Array(Math.round((input.length * to) / from));
  const ratio = from / to;
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const t = x - i0;
    out[i] = (input[i0] ?? 0) * (1 - t) + (input[i0 + 1] ?? input[i0] ?? 0) * t;
  }
  return out;
}

export type Window = { start: number; end: number; silent: boolean };

/**
 * Windows of at most `max` seconds, each ending at the quietest 100 ms
 * between `min` and `max` seconds in, so cuts fall between words. Windows
 * with no sound above the noise floor are marked silent (Whisper invents
 * text for silence, so they are skipped).
 */
export function speechWindows(samples: Float32Array, rate = SAMPLE_RATE, min = 20, max = 29.5): Window[] {
  const frame = Math.round(rate / 10);
  const frames = Math.ceil(samples.length / frame);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const a = f * frame;
    const b = Math.min(samples.length, a + frame);
    for (let i = a; i < b; i++) s += (samples[i] ?? 0) ** 2;
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  const out: Window[] = [];
  let start = 0;
  while (start < frames) {
    let end = frames;
    if (frames - start > max * 10) {
      let best = start + min * 10;
      for (let f = start + min * 10; f < start + max * 10; f++) if ((rms[f] ?? 0) < (rms[best] ?? 0)) best = f;
      end = best + 1;
    }
    let loud = 0;
    for (let f = start; f < end; f++) loud = Math.max(loud, rms[f] ?? 0);
    out.push({ start: (start * frame) / rate, end: Math.min(samples.length, end * frame) / rate, silent: loud < 0.004 });
    start = end;
  }
  return out;
}

export type Segment = { start: number; end: number; text: string };

function stamp(seconds: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(r, 3)}`;
}

/** Joins tiny fragments and drops empty ones so subtitles read well. */
export function tidySegments(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const text = s.text.replace(/\s+/g, ' ').trim();
    if (!text || /^\[?(BLANK_AUDIO|MUSIC|Music|silence)\]?$/i.test(text)) continue;
    const end = Math.max(s.end, s.start + 0.3);
    out.push({ start: s.start, end, text });
  }
  return out;
}

export function toSrt(segments: readonly Segment[]): string {
  return segments.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text}\n`).join('\n');
}

export function toVtt(segments: readonly Segment[]): string {
  return `WEBVTT\n\n${segments.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text}\n`).join('\n')}`;
}

export function toText(segments: readonly Segment[], timestamps: boolean): string {
  if (timestamps) return `${segments.map((s) => `[${stamp(s.start, '.').slice(0, 8)}] ${s.text}`).join('\n')}\n`;
  // Paragraphs at pauses longer than 1.5 s.
  let out = '';
  let prev: Segment | null = null;
  for (const s of segments) {
    if (prev) out += s.start - prev.end > 1.5 ? '\n\n' : ' ';
    out += s.text;
    prev = s;
  }
  return `${out}\n`;
}

/** 16-bit PCM WAV for a slice of samples (used to send audio to a cloud transcription API). */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i] ?? 0)) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}
