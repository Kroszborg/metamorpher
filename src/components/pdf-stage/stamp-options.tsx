'use client';

import { ImageUpload01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useRef, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { OptionField } from '@/components/workbench';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { type FontFamily, type GridPosition, pageRangeError, type TextStyle } from '@/engines/pdf-stamp';
import { cn } from '@/lib/utils';

/**
 * A compact number input. While typing, only in-range values are reported (so
 * "12" can be typed when the minimum is 4); on blur the text snaps back to the
 * clamped value.
 */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = false,
  suffix,
  className,
}: {
  id?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  suffix?: string;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const clamp = (v: number) => {
    const n = integer ? Math.round(v) : v;
    return Math.min(max ?? n, Math.max(min ?? n, n));
  };
  const shown = focused ? text : String(value);
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Input
        id={id}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={shown}
        min={min}
        max={max}
        step={step}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          setText(raw);
          const v = Number(raw);
          if (raw.trim() !== '' && Number.isFinite(v) && clamp(v) === (integer ? Math.round(v) : v)) onChange(clamp(v));
        }}
        onBlur={() => {
          setFocused(false);
          const v = Number(text);
          if (text.trim() !== '' && Number.isFinite(v)) onChange(clamp(v));
        }}
        className="font-mono tabular-nums"
      />
      {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

/** A slider with its value shown at the right. */
export function RangeField({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = (v) => String(v),
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="h-1.5 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
      />
      <span className="w-12 text-right font-mono text-xs tabular-nums">{format(value)}</span>
    </div>
  );
}

/** An <img> showing a Blob; owns (and revokes) its object URL. */
export function BlobImage({ blob, className, alt = '' }: { blob: Blob; className?: string; alt?: string }) {
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = img.current;
    if (!el) return;
    const url = URL.createObjectURL(blob);
    el.src = url;
    return () => {
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} alt={alt} className={className} draggable={false} />;
}

/** Picks one image file; shows its name and a thumbnail. */
export function ImagePicker({
  id,
  value,
  onChange,
  label = 'Choose image',
}: {
  id: string;
  value: Blob | null;
  onChange: (file: File | null) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <BlobImage
          blob={value}
          className="size-10 shrink-0 rounded-md border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:10px_10px] object-contain"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => input.current?.click()}>
          <HugeiconsIcon icon={ImageUpload01Icon} strokeWidth={2} />
          {value ? 'Replace image' : label}
        </Button>
        {value instanceof File ? <span className="truncate text-[0.7rem] text-muted-foreground">{value.name}</span> : null}
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) onChange(file);
        }}
      />
    </div>
  );
}

/** A labelled on/off row. */
export function SwitchRow({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {hint ? <p className="text-[0.7rem]/relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const FONTS: { value: FontFamily; label: string }[] = [
  { value: 'helvetica', label: 'Sans' },
  { value: 'times', label: 'Serif' },
  { value: 'courier', label: 'Mono' },
];

/** CSS stacks that match the standard PDF fonts' metrics, for on-screen previews. */
export const CSS_FONT: Record<FontFamily, string> = {
  helvetica: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  times: '"Times New Roman", "Liberation Serif", Times, serif',
  courier: '"Courier New", "Liberation Mono", Courier, monospace',
};

/** Font, weight, size and colour. */
export function TextStyleFields({
  id,
  value,
  onChange,
  sizeLabel = 'Font size',
  maxSize = 72,
  showBold = true,
}: {
  id: string;
  value: TextStyle;
  onChange: (v: TextStyle) => void;
  sizeLabel?: string;
  maxSize?: number;
  showBold?: boolean;
}) {
  return (
    <>
      <OptionField label="Font">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Font" value={value.font} options={FONTS} onChange={(font) => onChange({ ...value, font })} />
          {showBold ? (
            <label className="flex items-center gap-1.5 text-xs">
              <Switch checked={value.bold} onCheckedChange={(bold) => onChange({ ...value, bold })} aria-label="Bold" />
              Bold
            </label>
          ) : null}
        </div>
      </OptionField>
      <div className="grid grid-cols-2 gap-3">
        <OptionField label={sizeLabel} htmlFor={`${id}-size`}>
          <NumberInput
            id={`${id}-size`}
            value={value.size}
            min={4}
            max={maxSize}
            suffix="pt"
            onChange={(size) => onChange({ ...value, size })}
          />
        </OptionField>
        <OptionField label="Colour" htmlFor={`${id}-color`}>
          <div className="flex items-center gap-2">
            <input
              id={`${id}-color`}
              type="color"
              value={value.color}
              onChange={(e) => onChange({ ...value, color: e.currentTarget.value })}
              className="h-7 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <span className="font-mono text-xs text-muted-foreground uppercase">{value.color}</span>
          </div>
        </OptionField>
      </div>
    </>
  );
}

const GRID_LABELS: Record<GridPosition, string> = {
  tl: 'Top left',
  tc: 'Top centre',
  tr: 'Top right',
  ml: 'Middle left',
  mc: 'Centre',
  mr: 'Middle right',
  bl: 'Bottom left',
  bc: 'Bottom centre',
  br: 'Bottom right',
};

/** A 3×3 (or 2×3 without the middle row) position picker. */
export function PositionGrid<T extends GridPosition>({
  label,
  value,
  onChange,
  positions,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  positions: readonly T[];
}) {
  const rows = positions.length > 6 ? 3 : 2;
  return (
    <fieldset
      className={cn('grid w-fit grid-cols-3 gap-1 rounded-lg border bg-background p-1', rows === 3 ? 'grid-rows-3' : 'grid-rows-2')}
    >
      <legend className="sr-only">{label}</legend>
      {positions.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={value === p}
          aria-label={GRID_LABELS[p]}
          title={GRID_LABELS[p]}
          onClick={() => onChange(p)}
          className={cn(
            'grid h-6 w-9 place-items-center rounded-md transition-colors',
            value === p ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/60',
          )}
        >
          <span className={cn('size-1.5 rounded-full', value === p ? 'bg-primary' : 'bg-muted-foreground/40')} />
        </button>
      ))}
    </fieldset>
  );
}

/** Page range input with inline validation. */
export function PageRangeField({
  id,
  value,
  onChange,
  hint = 'For example 1-3, 7, 10-. Leave empty for every page.',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const error = pageRangeError(value);
  return (
    <OptionField label="Pages" htmlFor={id} hint={error ?? hint}>
      <Input
        id={id}
        value={value}
        placeholder="All pages"
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </OptionField>
  );
}

/** Today's date in the user's locale, for {date}. */
export function todayString(): string {
  return new Date().toLocaleDateString();
}
