'use client';

import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatPageRanges, parsePageSelection } from './page-range';

const same = (a: ReadonlySet<number>, b: ReadonlySet<number>) => a.size === b.size && [...a].every((n) => b.has(n));

/**
 * A page-range text field ("1-3, 8, 12-") bound to a set of 0-based page
 * indices. Typing updates the selection as soon as the text is valid; changing
 * the selection elsewhere (clicking thumbnails) rewrites the text.
 */
export function PageRangeInput({
  id,
  total,
  value,
  onChange,
  placeholder = 'e.g. 1-3, 8, 12-',
  quickPicks = true,
  className,
}: {
  id?: string;
  total: number;
  value: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  placeholder?: string;
  /** Show All / Odd / Even / None shortcuts under the field. */
  quickPicks?: boolean;
  className?: string;
}) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const errorId = `${inputId}-error`;
  // What the user typed, and the selection it produced. Shown only while the
  // selection is still the one it produced (or the text is invalid).
  const [draft, setDraft] = useState<{ text: string; produced: ReadonlySet<number> | null; base: ReadonlySet<number> } | null>(null);

  const active =
    draft && (draft.produced ? same(draft.produced, value) : draft.base === value) ? draft : null;
  const text = active ? active.text : formatPageRanges(value);
  const error = active && active.produced === null ? parsePageSelection(active.text, total).error : null;

  const set = (next: Set<number>) => {
    setDraft(null);
    onChange(next);
  };
  const all = Array.from({ length: total }, (_, i) => i);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Input
        id={inputId}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          const next = e.target.value;
          const parsed = parsePageSelection(next, total);
          if (parsed.error) {
            setDraft({ text: next, produced: null, base: value });
            return;
          }
          setDraft({ text: next, produced: parsed.pages, base: value });
          if (!same(parsed.pages, value)) onChange(parsed.pages);
        }}
        className="font-mono"
      />
      {error ? (
        <p id={errorId} className="text-[0.7rem]/relaxed text-destructive">
          {error}
        </p>
      ) : null}
      {quickPicks ? (
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['All', all],
              ['Odd', all.filter((i) => i % 2 === 0)],
              ['Even', all.filter((i) => i % 2 === 1)],
              ['None', []],
            ] as const
          ).map(([label, pages]) => (
            <button
              key={label}
              type="button"
              onClick={() => set(new Set(pages))}
              className="rounded-md border px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </button>
          ))}
          <span className="ml-auto self-center font-mono text-[0.7rem] text-muted-foreground tabular-nums">
            {value.size} of {total}
          </span>
        </div>
      ) : null}
    </div>
  );
}
