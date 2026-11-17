'use client';

import type * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** One labelled option in a tool's options panel. */
export function OptionField({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[0.7rem]/relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A 0–1 quality slider shown as a percentage. */
export function QualitySlider({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={10}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-1.5 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
      />
      <span className="w-10 text-right font-mono text-xs tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}

/** A full-width select over a fixed list of string values. */
export function OptionSelect<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
