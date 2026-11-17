import { SquareLock02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/kit/page-header';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { RelatedTools } from '@/components/tools/related-tools';
import { StarButton } from '@/components/tools/star-button';
import { ToolHost } from '@/components/tools/tool-host';
import { getCategory } from '@/tools/categories';
import { AVAILABLE_TOOLS, getAvailableTool } from '@/tools/registry';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return AVAILABLE_TOOLS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tool = getAvailableTool((await params).slug);
  if (!tool) return {};
  const description = `${tool.description} Free, private, runs in your browser. Files never leave your device.`;
  return {
    title: tool.title,
    description,
    keywords: [...tool.keywords],
    alternates: { canonical: `/tools/${tool.slug}` },
    openGraph: { title: tool.title, description, url: `/tools/${tool.slug}` },
  };
}

export default async function ToolPage({ params }: Props) {
  const tool = getAvailableTool((await params).slug);
  if (!tool) notFound();
  const category = getCategory(tool.category);

  return (
    <div className="page-container flex flex-col gap-8 pt-6 pb-16 sm:pt-8">
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'All tools', href: '/' },
              ...(category ? [{ label: category.title, href: `/category/${category.id}` }] : []),
            ]}
          />
        }
        title={tool.title}
        subtitle={tool.description}
        actions={
          <>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-medium text-muted-foreground">
              <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-3.5 text-primary" />
              Runs on this device
            </span>
            <StarButton slug={tool.slug} title={tool.title} showLabel />
          </>
        }
      />
      <ToolHost slug={tool.slug} />
      <RelatedTools tool={tool} />
    </div>
  );
}
