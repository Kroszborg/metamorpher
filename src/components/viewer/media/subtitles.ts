/** Subtitle files (SRT, WebVTT, ASS/SSA) as cues, and as WebVTT for a <track>. */

export type Cue = { start: number; end: number; text: string };

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})|(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function seconds(t: string): number {
  const m = TIME.exec(t.trim());
  if (!m) return NaN;
  if (m[1] !== undefined) return +m[1] * 3600 + +m[2]! * 60 + +m[3]! + +m[4]!.padEnd(3, '0') / 1000;
  return +m[5]! * 60 + +m[6]! + +m[7]!.padEnd(3, '0') / 1000;
}

function assTime(t: string): number {
  const m = /(\d+):(\d{2}):(\d{2})\.(\d{1,2})/.exec(t.trim());
  return m ? +m[1]! * 3600 + +m[2]! * 60 + +m[3]! + +m[4]!.padEnd(2, '0') / 100 : NaN;
}

/** SRT and WebVTT: blocks with "start --> end" then text lines. */
function parseBlocks(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at]!.split('-->');
    const start = seconds(a ?? '');
    const end = seconds((b ?? '').trim().split(/\s+/)[0] ?? '');
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    cues.push({ start, end, text: lines.slice(at + 1).join('\n').trim() });
  }
  return cues;
}

/** ASS/SSA: [Events] Dialogue lines, override tags removed. */
function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let format: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^Format:/i.test(line)) format = line.slice(7).split(',').map((s) => s.trim().toLowerCase());
    if (!/^Dialogue:/i.test(line) || !format.length) continue;
    const parts = line.slice(9).split(',');
    const fields = parts.slice(0, format.length - 1);
    fields.push(parts.slice(format.length - 1).join(','));
    const get = (k: string) => fields[format.indexOf(k)]?.trim() ?? '';
    const start = assTime(get('start'));
    const end = assTime(get('end'));
    const t = get('text').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ');
    if (!Number.isNaN(start) && !Number.isNaN(end) && t.trim()) cues.push({ start, end, text: t });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(text: string, ext: string): Cue[] {
  const body = text.replace(/^﻿/, '');
  if (ext === 'ass' || ext === 'ssa' || /^\[Script Info\]/im.test(body)) return parseAss(body);
  return parseBlocks(body);
}

const vttTime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
};

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text.replace(/-->/g, '→')}`).join('\n\n')}\n`;
}

export function formatClock(s: number): string {
  if (!Number.isFinite(s)) return '0:00';
  const sign = s < 0 ? '-' : '';
  const v = Math.abs(s);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = Math.floor(v % 60);
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${sign}${m}:${String(sec).padStart(2, '0')}`;
}
