import { ArrowRight01Icon, Key01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { categoryTint } from '@/components/tools/category-tint';
import { ToolIcon } from '@/components/tools/tool-card';
import { cn } from '@/lib/utils';
import { toolsInCategory } from '@/tools/registry';
import type { NavGroup } from './nav-groups';

const itemLink =
  'rounded-lg outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring';

/** One category's tools as a compact column: tinted icon and title per row. */
function CategoryColumn({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  return (
    <div className="grid gap-x-6 gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(12.5rem,1fr))]">
      {group.categories.map((c) => {
        const tint = categoryTint(c.id);
        const tools = toolsInCategory(c.id);
        return (
          <div key={c.id} className="flex min-w-0 flex-col gap-1">
            <Link
              href={`/category/${c.id}`}
              onClick={onNavigate}
              className={cn(itemLink, 'group/cat -mx-2 mb-1 flex items-center gap-2 px-2 py-1.5')}
            >
              <HugeiconsIcon icon={c.icon} strokeWidth={2} className={cn('size-4 shrink-0', tint.icon)} />
              <span className="truncate font-display text-[0.95rem] font-semibold">{c.title}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{tools.length}</span>
            </Link>
            <ul className="flex flex-col">
              {tools.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/tools/${t.slug}`}
                    onClick={onNavigate}
                    className={cn(
                      itemLink,
                      '-mx-2 flex items-center gap-2.5 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:text-foreground',
                    )}
                  >
                    <HugeiconsIcon
                      icon={t.icon}
                      strokeWidth={1.8}
                      className={cn('size-4 shrink-0 opacity-80', tint.icon)}
                    />
                    <span className="truncate">{t.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** A single-category menu: intro on the left, tools with descriptions on the right. */
function SingleCategory({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const c = group.categories[0]!;
  const tools = toolsInCategory(c.id);
  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="flex flex-col items-start gap-2 border-r pr-8">
        <HugeiconsIcon icon={c.icon} strokeWidth={1.8} className={cn('size-6', categoryTint(c.id).icon)} />
        <p className="mt-1 font-display text-xl font-semibold tracking-tight">{c.title}</p>
        <p className="text-sm/relaxed text-muted-foreground">{c.description}</p>
        <Link
          href={`/category/${c.id}`}
          onClick={onNavigate}
          className="group/all mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
        >
          All {tools.length} tools
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-4 transition-transform group-hover/all:translate-x-0.5"
          />
        </Link>
        {c.id === 'ai' ? (
          <Link
            href="/settings/ai"
            onClick={onNavigate}
            className="mt-auto inline-flex items-center gap-2 rounded-md pt-4 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-4" />
            AI settings and models
          </Link>
        ) : null}
      </div>
      <ul className="grid content-start gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {tools.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/tools/${t.slug}`}
              onClick={onNavigate}
              className={cn(itemLink, 'flex items-start gap-3 p-2.5')}
            >
              <ToolIcon tool={t} className="size-8 [&_svg]:size-4" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{t.title}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{t.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Contents of a top-bar menu. */
export function MenuPanel({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  return group.categories.length > 1 ? (
    <CategoryColumn group={group} onNavigate={onNavigate} />
  ) : (
    <SingleCategory group={group} onNavigate={onNavigate} />
  );
}
