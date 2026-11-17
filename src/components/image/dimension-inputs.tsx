'use client';

import { Link01Icon, Unlink01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** A whole-number input that lets the field be empty while typing. */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  unit = 'px',
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    // The value changed from outside: show it (React's "adjust state on prop change" pattern).
    setShown(value);
    setText(String(value));
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-[0.7rem] text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d]/g, '');
            setText(t);
            const n = Number(t);
            if (t && n >= min && n <= max) onCommit(n);
          }}
          onBlur={() => setText(String(value))}
          className="pr-7 font-mono tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[0.65rem] text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}

/**
 * Width and height in pixels with an aspect-ratio lock. While locked,
 * changing one side recomputes the other from `aspect` (width / height).
 */
export function DimensionInputs({
  idPrefix,
  width,
  height,
  aspect,
  locked,
  onLockedChange,
  onChange,
  max = 20000,
}: {
  idPrefix: string;
  width: number;
  height: number;
  aspect: number;
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
  onChange: (size: { width: number; height: number }) => void;
  max?: number;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(1, Math.round(n)));
  return (
    <div className="flex items-end gap-1.5">
      <NumberField
        id={`${idPrefix}-w`}
        label="Width"
        value={width}
        min={1}
        max={max}
        onCommit={(w) => onChange({ width: w, height: locked ? clamp(w / aspect) : height })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-pressed={locked}
        aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
        title={locked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
        onClick={() => {
          onLockedChange(!locked);
          if (!locked) onChange({ width, height: clamp(width / aspect) });
        }}
        className={locked ? 'text-primary' : 'text-muted-foreground'}
      >
        <HugeiconsIcon icon={locked ? Link01Icon : Unlink01Icon} strokeWidth={2} />
      </Button>
      <NumberField
        id={`${idPrefix}-h`}
        label="Height"
        value={height}
        min={1}
        max={max}
        onCommit={(h) => onChange({ width: locked ? clamp(h * aspect) : width, height: h })}
      />
    </div>
  );
}
