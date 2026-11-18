'use client';

import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Checkbox with a check that draws itself in (a dash when indeterminate).
 * `checked` may be true, false or 'indeterminate'; listen with `onCheckedChange`.
 * On touch screens the hit area grows to about 40px without changing layout.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative inline-grid size-4 shrink-0 place-items-center rounded-[0.3rem] border border-input bg-background text-primary-foreground outline-none dark:data-[state=unchecked]:bg-input/30',
        'transition-[background-color,border-color,box-shadow,scale] duration-(--dur-1) ease-enter active:scale-[0.88]',
        'hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50',
        'before:absolute before:-inset-3 before:content-[""] pointer-fine:before:hidden',
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="pointer-events-none size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path className="cb-mark cb-check" d="M3.5 8.5l3 3 6-7" pathLength={1} />
        <path className="cb-mark cb-dash" d="M4 8h8" pathLength={1} />
      </svg>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
