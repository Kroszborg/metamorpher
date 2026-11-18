import type * as React from 'react';
import { cn } from '@/lib/utils';

const PATHS = {
  check: 'M3.5 8.5l3 3 6-7',
  cross: 'M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5',
} as const;

/**
 * A check (or cross) whose stroke draws itself in when it mounts. Mount it
 * at the moment of success; under reduced motion it simply appears.
 */
export function DrawnCheck({
  className,
  kind = 'check',
  delay,
  strokeWidth = 2,
}: {
  className?: string;
  kind?: keyof typeof PATHS;
  /** ms before the stroke starts (default 60). */
  delay?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-4 shrink-0', className)}
      style={delay === undefined ? undefined : ({ '--draw-delay': `${delay}ms` } as React.CSSProperties)}
    >
      <path className="draw-stroke" d={PATHS[kind]} pathLength={1} />
    </svg>
  );
}
