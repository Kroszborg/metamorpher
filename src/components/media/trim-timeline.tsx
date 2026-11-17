'use client';

import { PlayIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatTime, parseTime } from '@/engines/media';
import { cn } from '@/lib/utils';
import type { PlayerControl } from './media-player';

export type TrimRange = { start: number; end: number };

/** Clamps a range into [0, duration] with at least `minLength` between in and out. */
export function clampRange(r: TrimRange, duration: number, minLength = 0.1): TrimRange {
  const min = Math.min(minLength, duration);
  const start = Math.min(Math.max(0, r.start), Math.max(0, duration - min));
  const end = Math.max(Math.min(duration, r.end), start + min);
  return { start, end };
}

const STEP = 0.1;

/**
 * A timeline for choosing an in and an out point: video frames or the audio
 * waveform as the strip, two draggable handles (arrow keys nudge by 0.1 s,
 * Shift by 1 s), a playhead that follows the player, and exact time fields.
 */
export function TrimTimeline({
  duration,
  value,
  onChange,
  player,
  thumbs,
  peaks,
  disabled,
  minLength = 0.1,
}: {
  duration: number;
  value: TrimRange;
  onChange: (r: TrimRange) => void;
  player?: PlayerControl;
  thumbs?: string[] | null;
  peaks?: number[] | null;
  disabled?: boolean;
  minLength?: number;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'start' | 'end' | null>(null);
  const pct = (t: number) => `${(Math.min(Math.max(t / (duration || 1), 0), 1) * 100).toFixed(3)}%`;
  const timeAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1) * duration;
  };
  const set = (which: 'start' | 'end', t: number) => {
    const next = which === 'start' ? { start: Math.min(t, value.end - minLength), end: value.end } : { start: value.start, end: Math.max(t, value.start + minLength) };
    onChange(clampRange(next, duration, minLength));
    player?.seek(which === 'start' ? next.start : next.end);
  };

  const handle = (which: 'start' | 'end') => (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={which === 'start' ? 'In point' : 'Out point'}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 1000) / 1000}
      aria-valuenow={Math.round(value[which] * 1000) / 1000}
      aria-valuetext={formatTime(value[which])}
      aria-disabled={disabled || undefined}
      onPointerDown={(e) => {
        if (disabled) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(which);
      }}
      onPointerMove={(e) => {
        if (drag === which) set(which, timeAt(e.clientX));
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = e.shiftKey ? 1 : STEP;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(which, value[which] - step);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(which, value[which] + step);
        else if (e.key === 'Home') set(which, 0);
        else if (e.key === 'End') set(which, duration);
        else return;
        e.preventDefault();
      }}
      style={{ left: pct(value[which]) }}
      className={cn(
        'absolute inset-y-0 z-10 flex w-3 -translate-x-1/2 touch-none items-center justify-center rounded-sm bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        disabled ? 'cursor-default opacity-60' : 'cursor-ew-resize',
      )}
    >
      <span className="h-5 w-px bg-primary-foreground/70" />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={strip}
        className={cn('relative h-14 touch-none select-none overflow-hidden rounded-lg border bg-muted', !disabled && 'cursor-pointer')}
        onPointerDown={(e) => {
          if (!disabled && player?.playable) player.seek(timeAt(e.clientX));
        }}
      >
        <StripBackground thumbs={thumbs} peaks={peaks} />
        <div className="absolute inset-y-0 left-0 bg-background/70" style={{ width: pct(value.start) }} />
        <div className="absolute inset-y-0 right-0 bg-background/70" style={{ left: pct(value.end) }} />
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-primary"
          style={{ left: pct(value.start), right: `calc(100% - ${pct(value.end)})` }}
        />
        {player?.playable ? (
          <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: pct(player.time) }} />
        ) : null}
        {handle('start')}
        {handle('end')}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <TimeField label="In" value={value.start} disabled={disabled} onCommit={(t) => set('start', t)} />
        <TimeField label="Out" value={value.end} disabled={disabled} onCommit={(t) => set('end', t)} />
        <div className="flex flex-col gap-1">
          <span className="text-[0.7rem] text-muted-foreground">Length</span>
          <span className="flex h-7 items-center font-mono text-xs tabular-nums">{formatTime(value.end - value.start)}</span>
        </div>
        {player?.playable ? (
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => set('start', player.time)}>
              Set in
            </Button>
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => set('end', player.time)}>
              Set out
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => player.playRange(value.start, value.end)}
            >
              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
              Play selection
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StripBackground({ thumbs, peaks }: { thumbs?: string[] | null; peaks?: number[] | null }) {
  if (thumbs && thumbs.length > 0) {
    return (
      <div className="absolute inset-0 flex">
        {thumbs.map((u) => (
          // eslint-disable-next-line @next/next/no-img-element -- local object URLs, not optimisable
          <img key={u} src={u} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
        ))}
      </div>
    );
  }
  if (peaks && peaks.length > 0) {
    const n = peaks.length;
    return (
      <svg className="absolute inset-0 size-full text-primary/60" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden>
        {peaks.map((p, i) => {
          const h = Math.max(2, p * 92);
          return <rect key={i} x={i + 0.15} width={0.7} y={50 - h / 2} height={h} fill="currentColor" />;
        })}
      </svg>
    );
  }
  return <div className="absolute inset-0 animate-pulse bg-muted" />;
}

function TimeField({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (t: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseTime(draft) === null;
  const commit = () => {
    if (draft === null) return;
    const t = parseTime(draft);
    if (t !== null) onCommit(t);
    setDraft(null);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.7rem] text-muted-foreground">{label}</span>
      <Input
        value={draft ?? formatTime(value, 3)}
        disabled={disabled}
        aria-label={`${label} time`}
        aria-invalid={invalid || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
        className="w-28 font-mono tabular-nums"
      />
    </label>
  );
}
