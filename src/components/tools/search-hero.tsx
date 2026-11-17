'use client';

import { Search01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { searchTools, STRONG_MATCH } from '@/lib/tool-search';
import { getCategory } from '@/tools/categories';
import { FEATURED_SLUGS, getTool, TOOLS } from '@/tools/registry';
import type { ToolDefinition } from '@/tools/types';
import { ToolIcon } from './tool-card';

const LIMIT = 7;
const RELATED_LIMIT = 3;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

type Section = { label?: string; tools: ToolDefinition[] };

/**
 * What to show for a query: real matches; or, when nothing matches well, a
 * plain "no match" note followed by loosely related tools and popular tools.
 * Planned tools are searchable too and are shown as coming soon.
 */
function resultsFor(query: string): { matched: boolean; sections: Section[] } {
  const hits = searchTools(TOOLS, query);
  const strong = hits
    .filter((h) => h.score >= STRONG_MATCH)
    .slice(0, LIMIT)
    .map((h) => h.tool);
  if (strong.length) return { matched: true, sections: [{ tools: strong }] };
  const related = hits.slice(0, RELATED_LIMIT).map((h) => h.tool);
  const popular = FEATURED_SLUGS.map((s) => getTool(s))
    .filter((t): t is ToolDefinition => t !== undefined && t.status === 'available' && !related.includes(t))
    .slice(0, 5);
  return {
    matched: false,
    sections: [
      ...(related.length ? [{ label: 'Related', tools: related }] : []),
      { label: 'Popular tools', tools: popular },
    ],
  };
}

/**
 * The home page search: filters tools as you type, with the same ranking as
 * the command palette. Arrow keys move through results, Enter opens one,
 * Escape clears. "/" focuses it from anywhere on the page.
 */
export function SearchHero({ className, autoFocusKey = true }: { className?: string; autoFocusKey?: boolean }) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  const { matched, sections } = useMemo(() => resultsFor(query), [query]);
  const flat = sections.flatMap((s) => s.tools);
  const choosable = flat.flatMap((t, i) => (t.status === 'available' ? [i] : []));
  const open = focused && query.trim().length > 0;
  const current = choosable.includes(active) ? active : (choosable[0] ?? -1);

  useEffect(() => {
    if (!autoFocusKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], dialog[open]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [autoFocusKey]);

  const move = (step: number) => {
    if (!choosable.length) return;
    const at = Math.max(choosable.indexOf(current), 0);
    setActive(choosable[(at + step + choosable.length) % choosable.length]!);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      const hit = flat[current];
      if (hit && open) {
        e.preventDefault();
        router.push(`/tools/${hit.slug}`);
      }
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault();
        setQuery('');
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className={cn('relative w-full', className)}>
      <div
        className={cn(
          'flex h-14 items-center gap-3 rounded-2xl border bg-card pr-3 pl-5 shadow-[0_1px_0_0_var(--border),0_12px_32px_-16px_rgb(0_0_0/0.25)] transition-[border-color,box-shadow] sm:h-16 sm:pl-6',
          'focus-within:border-primary focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)]',
          open && 'rounded-b-none',
        )}
      >
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2.2} className="size-5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && current >= 0 ? `${id}-opt-${current}` : undefined}
          aria-label="Search tools"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="What do you want to do?"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-lg [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear
          </button>
        ) : autoFocusKey ? (
          <kbd
            aria-hidden
            className="hidden h-7 min-w-7 place-items-center rounded-md border bg-background px-2 font-mono text-xs text-muted-foreground sm:grid"
          >
            /
          </kbd>
        ) : null}
      </div>

      <div
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
        className="absolute inset-x-0 top-full z-20 overflow-hidden rounded-b-2xl border border-t-0 border-primary bg-popover text-left shadow-[0_24px_48px_-24px_rgb(0_0_0/0.45)]"
      >
        <div className="border-t" />
        {!matched ? (
          <p role="status" className="px-5 pt-4 pb-1 text-sm text-foreground">
            No tool matches “{query.trim()}” yet.{' '}
            <span className="text-muted-foreground">Try a format or a task, like jpg, mp4 or merge.</span>
          </p>
        ) : null}
        <div id={listId} role="listbox" aria-label="Matching tools" className="flex flex-col gap-1 p-2">
          {sections.map((section, si) => {
            const base = sections.slice(0, si).reduce((n, sec) => n + sec.tools.length, 0);
            return (
              <div key={section.label ?? 'matches'} role="group" aria-label={section.label ?? 'Matches'}>
                {section.label ? (
                  <p aria-hidden className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {section.label}
                  </p>
                ) : null}
                <ul>
                  {section.tools.map((t, ti) => {
                    const i = base + ti;
                    const planned = t.status === 'planned';
                    const row = (
                      <>
                        <ToolIcon tool={t} muted={planned} className="size-8 [&_svg]:size-4" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                'truncate text-sm font-semibold',
                                planned ? 'text-muted-foreground' : 'text-foreground',
                              )}
                            >
                              {t.title}
                            </span>
                            {planned ? (
                              <span className="shrink-0 rounded-full border px-1.5 py-px text-[0.68rem] font-medium text-muted-foreground">
                                Coming soon
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{t.description}</span>
                        </span>
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                          {getCategory(t.category)?.title}
                        </span>
                      </>
                    );
                    return (
                      <li
                        key={t.slug}
                        id={`${id}-opt-${i}`}
                        role="option"
                        aria-selected={i === current}
                        aria-disabled={planned || undefined}
                        onMouseMove={() => !planned && i !== current && setActive(i)}
                      >
                        {planned ? (
                          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">{row}</div>
                        ) : (
                          <Link
                            href={`/tools/${t.slug}`}
                            tabIndex={-1}
                            className={cn(
                              'flex items-center gap-3 rounded-xl px-3 py-2.5',
                              i === current && 'bg-accent',
                            )}
                          >
                            {row}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
