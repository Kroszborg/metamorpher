'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A danger button that must be held (pointer, Enter or Space) for `holdMs`
 * before it confirms: for irreversible actions such as deleting an account.
 * A ring and a sweep fill while held; letting go early rewinds them.
 * The fill is functional feedback, so it also runs under reduced motion.
 */
export function HoldButton({
  onConfirm,
  holdMs = 1200,
  disabled,
  className,
  children,
}: {
  onConfirm: () => void;
  holdMs?: number;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ring = useRef<SVGCircleElement>(null);
  const sweep = useRef<HTMLSpanElement>(null);
  const anims = useRef<Animation[]>([]);
  const holding = useRef(false);
  const [held, setHeld] = useState(false);
  const hintId = useId();

  // Closing the dialog mid-hold must never confirm.
  useEffect(
    () => () => {
      holding.current = false;
      for (const a of anims.current) a.cancel();
      anims.current = [];
    },
    [],
  );

  const start = () => {
    if (disabled || holding.current) return;
    holding.current = true;
    setHeld(true);
    const opts: KeyframeAnimationOptions = { duration: holdMs, easing: 'linear', fill: 'forwards' };
    if (anims.current.length) {
      // Resume from wherever a quick release left the fill.
      for (const a of anims.current) a.updatePlaybackRate(1);
      return;
    }
    const a = ring.current?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], opts);
    const b = sweep.current?.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], opts);
    anims.current = [a, b].filter((x): x is Animation => Boolean(x));
    a?.addEventListener('finish', () => {
      if (!holding.current) {
        // Rewound to the start.
        for (const x of anims.current) x.cancel();
        anims.current = [];
        return;
      }
      holding.current = false;
      setHeld(false);
      for (const x of anims.current) x.cancel();
      anims.current = [];
      onConfirm();
    });
  };

  const stop = () => {
    if (!holding.current) return;
    holding.current = false;
    setHeld(false);
    for (const a of anims.current) a.updatePlaybackRate(-4);
  };

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="lg"
        disabled={disabled}
        aria-describedby={hintId}
        data-holding={held ? '' : undefined}
        onPointerDown={(e) => {
          if (e.button === 0) start();
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') stop();
        }}
        onBlur={stop}
        onContextMenu={(e) => e.preventDefault()}
        className={cn('relative touch-none overflow-hidden select-none', className)}
      >
        <span
          ref={sweep}
          aria-hidden
          className="pointer-events-none absolute inset-0 origin-left scale-x-0 bg-black/15 dark:bg-white/25"
        />
        <svg viewBox="0 0 16 16" aria-hidden className="relative size-4 -rotate-90">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} />
          <circle
            ref={ring}
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1}
          />
        </svg>
        <span className="relative">{children}</span>
      </Button>
      <span id={hintId} className="sr-only">
        Press and hold to confirm.
      </span>
    </>
  );
}
