import { cn } from '@/lib/utils';

export type FilterPill<K extends string> = { key: K; label: string; count: number };

/** Count-pill filter tabs (the paizy-admin pattern), as buttons for client-side filtering. */
export function FilterPills<K extends string>({
  label,
  pills,
  value,
  onChange,
  className,
}: {
  label: string;
  pills: readonly FilterPill<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {pills.map((t) => {
        const isActive = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs/relaxed font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-[0.68rem] tabular-nums',
                isActive ? 'bg-primary-foreground/20' : 'bg-muted text-foreground',
              )}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
