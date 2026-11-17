import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import type { Category, CategoryId, ToolInfo } from '@/tools/types';
import { activeCategories, TOOLS, toInfo } from '@/tools/registry';
import { categoryTint } from './category-tint';
import { ToolCard, ToolCardGrid } from './tool-card';

/** A category's shipped tools in registry order, then its planned ones. */
export function categoryTools(id: CategoryId): ToolInfo[] {
  const inCategory = TOOLS.filter((t) => t.category === id);
  return [
    ...inCategory.filter((t) => t.status === 'available'),
    ...inCategory.filter((t) => t.status === 'planned'),
  ].map(toInfo);
}

export function shippedCount(tools: readonly ToolInfo[]): number {
  return tools.filter((t) => t.status === 'available').length;
}

/** "Page management ............ 17 tools >" heading row for a category section. */
export function CategoryHeading({
  category,
  count,
  label,
  as: Heading = 'h2',
}: {
  category: Category;
  count: number;
  /** Heading text; defaults to the category title. */
  label?: string;
  as?: 'h2' | 'h3';
}) {
  const tint = categoryTint(category.id);
  return (
    <div className="flex items-center gap-3">
      <HugeiconsIcon icon={category.icon} strokeWidth={2} className={`size-5 shrink-0 ${tint.icon}`} />
      <Heading id={`cat-${category.id}`} className="font-display text-lg font-semibold tracking-tight">
        {label ?? category.title}
      </Heading>
      <span aria-hidden className="h-px flex-1 bg-border" />
      <Link
        href={`/category/${category.id}`}
        aria-label={`All ${count} ${category.title} tools`}
        className="group/all -mr-2 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {count} {count === 1 ? 'tool' : 'tools'}
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="size-4 transition-transform group-hover/all:translate-x-0.5"
        />
      </Link>
    </div>
  );
}

/** Tools shown per section on phones; the rest are a tap away on the category page. */
const PHONE_LIMIT = 5;

/** Every category with a shipped tool, each as a titled section of tool cards. */
export function CategorySections() {
  return (
    <div className="flex flex-col gap-12">
      {activeCategories().map((category) => {
        const tools = categoryTools(category.id);
        const count = shippedCount(tools);
        return (
          <section
            key={category.id}
            id={category.id}
            aria-labelledby={`cat-${category.id}`}
            className="flex scroll-mt-6 flex-col gap-3"
          >
            <CategoryHeading category={category} count={count} />
            <ToolCardGrid>
              {tools.map((t, i) => (
                <ToolCard key={t.slug} tool={t} className={i >= PHONE_LIMIT ? 'max-sm:hidden' : undefined} />
              ))}
            </ToolCardGrid>
            {tools.length > PHONE_LIMIT ? (
              <Link
                href={`/category/${category.id}`}
                aria-label={`See all ${count} ${category.title} tools`}
                className="flex h-11 items-center justify-center gap-1 rounded-xl border text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
              >
                See all {count} tools
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4" />
              </Link>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
