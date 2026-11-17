'use client';

import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Component, type ReactNode, Suspense, use, useEffect } from 'react';
import { EmptyState } from '@/components/kit/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { emit } from '@/lib/events';
import { recordRecent } from '@/lib/tool-prefs';
import { getAvailableTool, toInfo } from '@/tools/registry';
import type { ToolInfo, ToolModule } from '@/tools/types';

// One module promise per tool for the life of the page: `use()` needs a stable
// promise, and revisits should not refetch.
const modules = new Map<string, Promise<ToolModule>>();

function loadTool(slug: string): Promise<ToolModule> | null {
  const tool = getAvailableTool(slug);
  if (!tool) return null;
  let mod = modules.get(slug);
  if (!mod) {
    mod = tool.load();
    // Let a failed chunk load be retried on the next visit.
    mod.catch(() => modules.delete(slug));
    modules.set(slug, mod);
  }
  return mod;
}

function ToolBody({ pending, info }: { pending: Promise<ToolModule>; info: ToolInfo }) {
  const { default: Tool } = use(pending);
  return <Tool tool={info} />;
}

export function WorkbenchSkeleton() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-busy="true">
      <div className="rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="p-5">
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}

class ToolErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState
          icon={<HugeiconsIcon icon={Alert02Icon} strokeWidth={1.8} />}
          title="This tool could not load"
          description="Check your connection and reload. If you are offline, the tool may not have been cached yet."
          action={
            <Button size="lg" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      </div>
    );
  }
}

/** Loads a tool's component from the registry and renders it. Records the visit in Recent. */
export function ToolHost({ slug }: { slug: string }) {
  useEffect(() => recordRecent(slug), [slug]);
  useEffect(() => emit({ type: 'tool_open', tool: slug }), [slug]);
  const tool = getAvailableTool(slug);
  const pending = loadTool(slug);
  if (!tool || !pending) return null;
  return (
    <ToolErrorBoundary>
      <Suspense fallback={<WorkbenchSkeleton />}>
        <ToolBody pending={pending} info={toInfo(tool)} />
      </Suspense>
    </ToolErrorBoundary>
  );
}
