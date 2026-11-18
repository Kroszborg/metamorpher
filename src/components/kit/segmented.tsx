'use client';

import { useRef } from 'react';
import { useSlidingIndicator } from '@/components/ui/sliding-indicator';
import { cn } from '@/lib/utils';

/** A small row of mutually exclusive choices, such as Live / Test. The highlight slides to the choice. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const box = useRef<HTMLFieldSetElement>(null);
  const indicator = useSlidingIndicator(box, value, { className: 'bg-muted ring-1 ring-border' });
  return (
    <fieldset ref={box} className="group/seg relative inline-flex gap-1 rounded-lg border bg-background p-1">
      <legend className="sr-only">{label}</legend>
      {indicator}
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            data-indicator-active={active ? '' : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-[1] rounded-md px-3 py-1 text-xs font-medium outline-none transition-[color,scale] duration-(--dur-2) ease-enter focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.96] pointer-coarse:py-1.5',
              active
                ? 'bg-muted text-foreground ring-1 ring-border group-data-[indicator-ready]/seg:bg-transparent group-data-[indicator-ready]/seg:ring-0'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}
