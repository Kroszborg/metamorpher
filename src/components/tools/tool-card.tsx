import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { getCategory } from '@/tools/categories';
import type { ToolInfo } from '@/tools/types';
import { cn } from '@/lib/utils';
import { categoryTint } from './category-tint';
import { StarButton } from './star-button';

/** The icon on a tinted tile; the tint says which kind of tool it is. */
export function ToolIcon({
  tool,
  className,
  muted = false,
}: {
  tool: Pick<ToolInfo, 'icon' | 'category'>;
  className?: string;
  muted?: boolean;
}) {
  const tint = muted ? { icon: 'text-faint', tile: 'bg-muted/60' } : categoryTint(tool.category);
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-[0.6rem]', tint.tile, tint.icon, className)}>
      <HugeiconsIcon icon={tool.icon} strokeWidth={1.8} className="size-[1.15rem]" />
    </span>
  );
}

/**
 * A tool in a list: tinted icon, title, one-line description. The whole item
 * is the link; the star shows on hover and focus, and stays once starred.
 * A planned tool renders quietly, without a link.
 */
export function ToolCard({
  tool,
  showCategory = false,
  className,
}: {
  tool: ToolInfo;
  showCategory?: boolean;
  className?: string;
}) {
  if (tool.status === 'planned') return <PlannedToolCard tool={tool} className={className} />;
  return (
    <div
      data-slot="card"
      className={cn(
        'group relative flex min-w-0 items-start gap-3 rounded-xl p-3 transition-colors hover:bg-muted/70 has-[a:focus-visible]:bg-muted/70 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring',
        className,
      )}
    >
      <ToolIcon tool={tool} />
      <div className="min-w-0 flex-1 pt-px">
        <h3 className="truncate text-sm font-semibold text-foreground">
          <Link href={`/tools/${tool.slug}`} className="outline-none after:absolute after:inset-0 after:rounded-xl">
            {tool.title}
          </Link>
        </h3>
        <p className="mt-0.5 line-clamp-2 text-[0.8rem]/snug text-muted-foreground">{tool.description}</p>
        {showCategory ? (
          <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{getCategory(tool.category)?.title}</p>
        ) : null}
      </div>
      <StarButton
        slug={tool.slug}
        title={tool.title}
        className="relative z-10 -mt-1 -mr-1 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100 pointer-coarse:opacity-100"
      />
    </div>
  );
}

function PlannedToolCard({ tool, className }: { tool: ToolInfo; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-start gap-3 rounded-xl p-3', className)}>
      <ToolIcon tool={tool} muted />
      <div className="min-w-0 flex-1 pt-px">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <span className="truncate">{tool.title}</span>
          <span className="shrink-0 rounded-full border px-1.5 py-px text-[0.68rem] font-medium text-muted-foreground">
            Coming soon
          </span>
        </h3>
        <p className="mt-0.5 line-clamp-2 text-[0.8rem]/snug text-muted-foreground">{tool.description}</p>
      </div>
    </div>
  );
}

export function ToolCardGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('-mx-3 grid gap-x-2 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', className)}>
      {children}
    </div>
  );
}
