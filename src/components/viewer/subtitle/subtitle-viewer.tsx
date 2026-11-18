'use client';

import { Download04Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { baseName, downloadBlob } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, Toolbar, ViewerLoading, ViewerProblem } from '../bits';
import { type Shortcut, useKeys, useShortcuts, type ViewerProps } from '../context';
import { type Cue, parseSubtitles, toVtt } from '../media/subtitles';
import { encodingFromSniff, readPart } from '../text/parts';
import { useVirtualScroll } from '../virtual';

const ROW_H = 52;
const SHORTCUTS: Shortcut[] = [{ keys: '/', label: 'Search the subtitles' }];
/** Reading speed above which a subtitle is hard to read (characters per second). */
const FAST_CPS = 20;

const stamp = (s: number, comma: boolean) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(sec)}${comma ? ',' : '.'}${p(ms, 3)}`;
};

function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, true)} --> ${stamp(c.end, true)}\n${c.text}\n`).join('\n');
}

/** Subtitles as a timed list: search, reading-speed and overlap checks, and SRT/VTT downloads. */
export default function SubtitleViewer({ file, sniff }: ViewerProps) {
  useShortcuts(SHORTCUTS);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    readPart(file, 0, encodingFromSniff(sniff.encoding)).then(
      (p) => {
        if (!live) return;
        const c = parseSubtitles(p.text, sniff.ext);
        if (!c.length) setError('No timed subtitles were found. The file may not be SRT, WebVTT or ASS, or it is damaged.');
        else setCues(c);
      },
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'The file could not be read.'),
    );
    return () => {
      live = false;
    };
  }, [file, sniff.encoding, sniff.ext]);

  const rows = useMemo(() => {
    if (!cues) return [];
    const q = query.trim().toLowerCase();
    return cues
      .map((c, i) => {
        const dur = c.end - c.start;
        const chars = c.text.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
        const cps = dur > 0 ? chars / dur : Infinity;
        const overlap = i > 0 && c.start < cues[i - 1]!.end - 0.001;
        return { c, i, dur, cps, overlap, issue: cps > FAST_CPS || dur <= 0 || overlap };
      })
      .filter((r) => (!q || r.c.text.toLowerCase().includes(q)) && (!onlyIssues || r.issue));
  }, [cues, query, onlyIssues]);

  const vs = useVirtualScroll(scroller, rows.length * ROW_H);
  useKeys((e) => {
    if (e.key !== '/') return false;
    search.current?.focus();
    return true;
  });

  if (error) return <ViewerProblem title="These subtitles could not be read">{error}</ViewerProblem>;
  if (!cues) return <ViewerLoading label="Reading the subtitles…" />;

  const issues = cues.length ? rows.filter((r) => r.issue).length : 0;
  const total = cues[cues.length - 1]!.end;
  const first = Math.max(0, Math.floor(vs.top / ROW_H) - 4);
  const last = Math.min(rows.length, Math.ceil((vs.top + vs.height) / ROW_H) + 4);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the text"
            aria-label="Search the subtitles"
            className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <ChipButton pressed={onlyIssues} onClick={() => setOnlyIssues((v) => !v)}>
          Only problems{issues ? ` (${issues})` : ''}
        </ChipButton>
        <span className="flex-1" />
        <ChipButton onClick={() => downloadBlob(new Blob([toSrt(cues)], { type: 'application/x-subrip' }), `${baseName(file.name)}.srt`)}>
          <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
          SRT
        </ChipButton>
        <ChipButton onClick={() => downloadBlob(new Blob([toVtt(cues)], { type: 'text/vtt' }), `${baseName(file.name)}.vtt`)}>
          <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
          VTT
        </ChipButton>
      </Toolbar>
      <div ref={scroller} role="list" aria-label={`Subtitles in ${file.name}`} tabIndex={0} className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset">
        <div style={{ height: vs.spacer }} className="relative">
          {rows.slice(first, last).map((r, k) => (
            <div
              role="listitem"
              key={r.i}
              className={cn('absolute inset-x-0 grid grid-cols-[3rem_9.5rem_minmax(0,1fr)] items-start gap-3 border-b px-3 py-1.5 text-xs max-sm:grid-cols-[2.5rem_minmax(0,1fr)]', r.issue && 'bg-warning/8')}
              style={{ top: (first + k) * ROW_H + vs.shift, height: ROW_H }}
            >
              <span className="pt-0.5 text-right font-mono text-faint tabular-nums">{r.i + 1}</span>
              <span className="font-mono leading-5 text-muted-foreground tabular-nums max-sm:hidden">
                {stamp(r.c.start, false).slice(0, 11)}
                <br />
                {stamp(r.c.end, false).slice(0, 11)}
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 leading-5 whitespace-pre-wrap text-foreground">{r.c.text.replace(/<[^>]+>/g, '')}</span>
                <span className={cn('text-[0.68rem] tabular-nums', r.issue ? 'text-warning' : 'text-faint')}>
                  {r.dur.toFixed(2)} s · {Number.isFinite(r.cps) ? `${Math.round(r.cps)} chars/s` : '—'}
                  {r.overlap ? ' · overlaps the previous one' : r.cps > FAST_CPS ? ' · fast to read' : r.dur <= 0 ? ' · ends before it starts' : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <footer className="flex flex-wrap gap-x-3 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {cues.length.toLocaleString()} subtitles · {stamp(total, false).slice(0, 8)} long · {sniff.format}
        </span>
        {query ? <span className="tabular-nums">{rows.length.toLocaleString()} match</span> : null}
        <span>Drop the video and this file together in the media player to watch them.</span>
      </footer>
    </div>
  );
}
