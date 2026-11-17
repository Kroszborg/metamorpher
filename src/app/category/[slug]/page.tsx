import { HugeiconsIcon } from '@hugeicons/react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/kit/page-header';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { categoryTint } from '@/components/tools/category-tint';
import { ToolCard, ToolCardGrid } from '@/components/tools/tool-card';
import { categoryTools, shippedCount } from '@/components/tools/tool-grid';
import { getCategory } from '@/tools/categories';
import { activeCategories, toolsInCategory } from '@/tools/registry';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return activeCategories().map((c) => ({ slug: c.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = getCategory((await params).slug);
  if (!category) return {};
  return {
    title: category.title,
    description: `${category.description} Free and private: everything runs in your browser.`,
    alternates: { canonical: `/category/${category.id}` },
  };
}

export default async function CategoryPage({ params }: Props) {
  const category = getCategory((await params).slug);
  const tools = category ? categoryTools(category.id) : [];
  const count = shippedCount(tools);
  if (!category || count === 0) notFound();
  const others = activeCategories().filter((c) => c.id !== category.id);

  return (
    <div className="page-container flex flex-col gap-10 pt-6 pb-16 sm:pt-8">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: 'All tools', href: '/' }]} />}
        title={
          <span className="flex items-center gap-3">
            <HugeiconsIcon
              icon={category.icon}
              strokeWidth={1.8}
              className={cn('size-8 shrink-0 sm:size-9', categoryTint(category.id).icon)}
            />
            {category.title}
          </span>
        }
        subtitle={`${category.description} ${count} ${count === 1 ? 'tool' : 'tools'}, all running in your browser.`}
      />
      <ToolCardGrid>
        {tools.map((t) => (
          <ToolCard key={t.slug} tool={t} />
        ))}
      </ToolCardGrid>
      {others.length ? (
        <nav aria-labelledby="other-categories" className="flex flex-col gap-4 border-t pt-8">
          <h2 id="other-categories" className="font-display text-lg font-semibold">
            Other categories
          </h2>
          <ul className="flex flex-wrap gap-2">
            {others.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/category/${c.id}`}
                  className="flex items-center gap-2 rounded-full border bg-card/60 py-1.5 pr-3.5 pl-3 text-sm font-medium outline-none transition-colors hover:border-input hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <HugeiconsIcon icon={c.icon} strokeWidth={2} className={cn('size-4', categoryTint(c.id).icon)} />
                  {c.title}
                  <span className="text-muted-foreground tabular-nums">{toolsInCategory(c.id).length}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
