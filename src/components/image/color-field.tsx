'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const SWATCHES = ['#ffffff', '#000000', '#f4f4f5'];

/** A background colour: native picker, hex text and a few quick swatches. */
export function ColorField({
  id,
  value,
  onChange,
  swatches = SWATCHES,
}: {
  id: string;
  value: string;
  onChange: (hex: string) => void;
  swatches?: readonly string[];
}) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Pick a colour"
        value={valid ? value : '#ffffff'}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
      />
      <Input
        id={id}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value.trim();
          onChange(v.startsWith('#') ? v : `#${v}`);
        }}
        aria-invalid={!valid}
        className="w-24 font-mono"
      />
      <div className="flex gap-1">
        {swatches.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Use ${s}`}
            onClick={() => onChange(s)}
            className={cn(
              'size-6 rounded-md border transition-shadow',
              value.toLowerCase() === s && 'ring-2 ring-ring/40',
            )}
            style={{ backgroundColor: s }}
          />
        ))}
      </div>
    </div>
  );
}

export const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
