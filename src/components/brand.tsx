import { cn } from '@/lib/utils';

/**
 * The Metamorpher mark: a square and a circle joined by two turning arrows,
 * one shape becoming another. Inherits currentColor.
 */
export function MetamorpherMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <circle cx="16.5" cy="16.5" r="4.25" />
      <path d="M14.5 4.5h1.5a3 3 0 0 1 3 3V10m-2-2 2 2 2-2" />
      <path d="M9.5 19.5H8a3 3 0 0 1-3-3V14m-2 2 2-2 2 2" />
    </svg>
  );
}

/** Mark on an accent tile plus the wordmark. */
export function Wordmark({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <MetamorpherMark className="size-5" />
      </span>
      <div className="leading-tight">
        <div className="font-display text-[0.95rem] font-bold tracking-tight">Metamorpher</div>
        {subtitle ? (
          <div className="text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
