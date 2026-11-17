'use client';

import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** A label and a switch on one row, with an optional hint below. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {hint ? <p className="text-[0.7rem]/relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * A whole-number (or decimal) field that only reports valid values. While the
 * text is empty or out of range the last valid value stays in effect.
 */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals = false,
  suffix,
  className,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  decimals?: boolean;
  suffix?: React.ReactNode;
  className?: string;
}) {
  // What is being typed; shown while it still describes `value` (or is invalid).
  const [draft, setDraft] = useState<{ text: string; base: number } | null>(null);
  const parse = (text: string): number | null => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return null;
    const v = decimals ? n : Math.round(n);
    return v >= min && v <= max ? v : null;
  };
  const active = draft && (parse(draft.text) ?? draft.base) === value ? draft : null;
  const invalid = active ? parse(active.text) === null : false;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Input
        id={id}
        type="number"
        inputMode={decimals ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        step={step}
        value={active ? active.text : String(value)}
        aria-invalid={invalid || undefined}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const text = e.target.value;
          setDraft({ text, base: value });
          const v = parse(text);
          if (v !== null && v !== value) onChange(v);
        }}
        className="w-24 font-mono tabular-nums"
      />
      {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

/** A small icon button for `PageGrid` tile actions and compact toolbars. */
export function TileAction({
  icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-6 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        tone === 'danger' && 'hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
    </button>
  );
}
