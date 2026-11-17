'use client';

import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ToolIcon } from '@/components/tools/tool-card';
import { matchesAccept } from '@/lib/files';
import { cn } from '@/lib/utils';
import { AVAILABLE_TOOLS } from '@/tools/registry';
import type { AvailableTool } from '@/tools/types';
import { handOff } from './handoff';
import { KIND_INFO, VIEWER_SLUGS } from './kinds';
import { type Sniffed, sniffedAlias } from './sniff';

/**
 * Tools that take this file, from their registry `accept` lists, matched by
 * the file's name and type and by what its content really is. The viewer for
 * its kind comes first, other viewers next, then everything else.
 */
export function toolsFor(file: { name: string; type: string }, sniff: Sniffed | null, exclude?: string): AvailableTool[] {
  const alias = sniff ? sniffedAlias(sniff) : null;
  const best = sniff ? KIND_INFO[sniff.kind].slug : '';
  const hits = AVAILABLE_TOOLS.filter(
    (t) =>
      t.slug !== exclude &&
      t.slug !== 'open-file' &&
      t.accept.length > 0 &&
      // A mismatched extension should not offer tools for the wrong format.
      ((!sniff?.mismatch && matchesAccept(file, t.accept)) || (alias !== null && matchesAccept(alias, t.accept))),
  );
  const rank = (t: AvailableTool) => (t.slug === best ? 0 : t.category === 'view' ? 1 : 2);
  return hits.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map(({ t }) => t);
}

const SHOWN = 6;

/** "Open with" chips under a viewer; each hands the file to that tool. */
export function OpenWith({ files, sniff, current }: { files: File[]; sniff: Sniffed | null; current: string }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const file = files[0];
  if (!file) return null;
  const tools = toolsFor(file, sniff, current);
  if (!tools.length) return null;
  const shown = all ? tools : tools.slice(0, SHOWN);
  return (
    <nav aria-label="Open with another tool" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-muted-foreground">Open with</span>
      {shown.map((t) => (
        <button
          key={t.slug}
          type="button"
          onClick={() => handOff(t.slug, files, (href) => router.push(href), VIEWER_SLUGS)}
          className="group flex h-8 items-center gap-1.5 rounded-full border bg-card py-0.5 pr-3 pl-0.5 text-xs font-medium outline-none transition-colors hover:border-input hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
          title={t.description}
        >
          <ToolIcon tool={t} className="size-6 rounded-full [&_svg]:size-3.5" />
          {t.title}
        </button>
      ))}
      {tools.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className={cn(
            'flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
          )}
          aria-expanded={all}
        >
          {all ? 'Fewer' : `${tools.length - SHOWN} more`}
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className={cn('size-3.5 transition-transform', all && 'rotate-180')} />
        </button>
      ) : null}
    </nav>
  );
}
