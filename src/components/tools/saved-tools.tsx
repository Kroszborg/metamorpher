'use client';

import { Clock01Icon, StarIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { EmptyState } from '@/components/kit/empty-state';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/components/theme-toggle';
import { clearRecent, useRecent, useStarred } from '@/lib/tool-prefs';
import { getAvailableTool, toInfo } from '@/tools/registry';
import type { AvailableTool } from '@/tools/types';
import { ToolCard, ToolCardGrid, ToolIcon } from './tool-card';

function resolve(slugs: readonly string[]): AvailableTool[] {
  return slugs.map((s) => getAvailableTool(s)).filter((t): t is AvailableTool => t !== undefined);
}

/** Starred or recent tools from this device's local storage. */
export function SavedTools({ kind }: { kind: 'starred' | 'recent' }) {
  const starred = useStarred();
  const recent = useRecent();
  const hydrated = useHydrated();
  const tools = resolve(kind === 'starred' ? starred : recent);

  if (!hydrated) return <div className="min-h-64" aria-busy="true" />;
  if (tools.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed">
        <EmptyState
          className="py-16"
          icon={<HugeiconsIcon icon={kind === 'starred' ? StarIcon : Clock01Icon} strokeWidth={1.8} />}
          title={kind === 'starred' ? 'No starred tools yet' : 'No recent tools yet'}
          description={
            kind === 'starred'
              ? 'Select the star on any tool to keep it here. Stars are saved in this browser only.'
              : 'Tools you open appear here. The list is kept in this browser only; files are never stored.'
          }
          action={
            <Button asChild size="lg" variant="outline">
              <Link href="/">Browse all tools</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ToolCardGrid>
        {tools.map((t) => (
          <ToolCard key={t.slug} tool={toInfo(t)} showCategory />
        ))}
      </ToolCardGrid>
      {kind === 'recent' ? (
        <div>
          <Button variant="outline" size="lg" onClick={clearRecent}>
            Clear recent
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  href,
  icon,
  tools,
}: {
  label: string;
  href: string;
  icon: typeof StarIcon;
  tools: AvailableTool[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <Link
        href={href}
        className="inline-flex w-24 shrink-0 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
        {label}
      </Link>
      <ul className="scroll-slim -my-1 flex min-w-0 gap-2 overflow-x-auto py-1">
        {tools.map((t) => (
          <li key={t.slug} className="shrink-0">
            <Link
              href={`/tools/${t.slug}`}
              className="flex items-center gap-2 rounded-full border bg-card py-1 pr-3.5 pl-1 text-sm font-medium outline-none transition-colors hover:border-input hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ToolIcon tool={t} className="size-7 rounded-full [&_svg]:size-3.5" />
              {t.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Home page rows for starred and recent tools. Renders nothing until there is something to show. */
export function HomeSavedTools() {
  const starred = resolve(useStarred());
  const recent = resolve(useRecent()).slice(0, 8);
  const hydrated = useHydrated();
  if (!hydrated || (!starred.length && !recent.length)) return null;
  return (
    <section aria-label="Your tools" className="flex flex-col gap-3 rounded-2xl border bg-card/50 p-4 sm:p-5">
      {starred.length ? <Row label="Starred" href="/starred" icon={StarIcon} tools={starred} /> : null}
      {recent.length ? <Row label="Recent" href="/recent" icon={Clock01Icon} tools={recent} /> : null}
    </section>
  );
}
