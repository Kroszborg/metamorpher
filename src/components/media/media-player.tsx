'use client';

import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Playback state and controls shared by a `MediaPlayer` and the timeline next to it. */
export type PlayerControl = {
  /** Current playback position in seconds. */
  time: number;
  /** False when the browser cannot play this file (the timeline still works). */
  playable: boolean;
  seek: (t: number) => void;
  /** Plays from `start` and pauses at `end`. */
  playRange: (start: number, end: number) => void;
  /** Internal: wired up by `MediaPlayer`. */
  bind: {
    elementRef: RefObject<HTMLMediaElement | null>;
    setTime: (t: number) => void;
    setPlayable: (v: boolean) => void;
    stopAtRef: RefObject<number | null>;
  };
};

export function usePlayer(): PlayerControl {
  const element = useRef<HTMLMediaElement | null>(null);
  const stopAt = useRef<number | null>(null);
  const [time, setTime] = useState(0);
  const [playable, setPlayable] = useState(true);
  const seek = useCallback((t: number) => {
    stopAt.current = null;
    const m = element.current;
    if (m) {
      m.pause();
      m.currentTime = t;
    }
    setTime(t);
  }, []);
  const playRange = useCallback((start: number, end: number) => {
    const m = element.current;
    if (!m) return;
    m.currentTime = start;
    stopAt.current = end;
    void m.play().catch(() => undefined);
  }, []);
  return { time, playable, seek, playRange, bind: { elementRef: element, setTime, setPlayable, stopAtRef: stopAt } };
}

/**
 * A native video or audio player for one local file. The file is played from
 * an object URL (nothing is uploaded); formats the browser cannot play show a
 * note instead, and the timeline keeps working from the engine's probe.
 */
export function MediaPlayer({
  file,
  kind,
  control,
  className,
  fallback,
}: {
  /** The file, or a playable stand-in for it (same timeline). */
  file: Blob;
  kind: 'video' | 'audio';
  control: PlayerControl;
  className?: string;
  /** Shown under the "cannot play" note (a button that builds a playable preview). */
  fallback?: React.ReactNode;
}) {
  const { elementRef, setTime, setPlayable, stopAtRef } = control.bind;
  const local = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  useEffect(() => {
    const m = local.current;
    if (!m) return;
    // Remount (key) the player for a new file; its state starts fresh.
    elementRef.current = m;
    setPlayable(true);
    const url = URL.createObjectURL(file);
    m.src = url;
    let raf = 0;
    // timeupdate fires only a few times a second; follow playback per frame for the playhead and range stops.
    const tick = () => {
      setTime(m.currentTime);
      const stop = stopAtRef.current;
      if (stop !== null && m.currentTime >= stop) {
        m.pause();
        m.currentTime = stop;
        stopAtRef.current = null;
      }
      if (!m.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onSeeked = () => setTime(m.currentTime);
    const onError = () => setPlayable(false);
    m.addEventListener('play', onPlay);
    m.addEventListener('seeked', onSeeked);
    m.addEventListener('error', onError);
    return () => {
      cancelAnimationFrame(raf);
      m.removeEventListener('play', onPlay);
      m.removeEventListener('seeked', onSeeked);
      m.removeEventListener('error', onError);
      m.pause();
      m.removeAttribute('src');
      m.load();
      URL.revokeObjectURL(url);
      if (elementRef.current === m) elementRef.current = null;
    };
  }, [file, elementRef, setTime, setPlayable, stopAtRef]);

  return (
    <div className={cn('relative overflow-hidden rounded-lg border bg-muted/40', className)}>
      {kind === 'video' ? (
        <video
          ref={local}
          controls
          playsInline
          preload="metadata"
          className={cn('mx-auto block max-h-[22rem] w-full bg-black', !control.playable && 'invisible h-0')}
        />
      ) : (
        <audio ref={local} controls preload="metadata" className={cn('block w-full', !control.playable && 'hidden')} />
      )}
      {!control.playable ? (
        <p className="flex items-start gap-1.5 px-3 py-2.5 text-[0.7rem]/relaxed text-muted-foreground">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
          This browser cannot play this format, so there is no preview. The timeline and the times below still work.
        </p>
      ) : null}
      {!control.playable && fallback ? <div className="px-3 pb-2.5">{fallback}</div> : null}
    </div>
  );
}
