'use client';

import { Cancel01Icon, FileViewIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ToolIcon } from '@/components/tools/tool-card';
import { formatBytes } from '@/lib/files';
import { handOff } from './handoff';
import { VIEWER_SLUGS } from './kinds';
import { toolsFor } from './open-with';
import { type Sniffed, sniffFile } from './sniff';

const SHOWN = 7;

/**
 * Drop (or paste) a file anywhere on the home page: it is identified from its
 * content and offered to "Open" (the universal viewer) and to every tool that
 * takes it. The file goes to the chosen tool in memory; nothing is uploaded.
 */
export function HomeDrop() {
  const router = useRouter();
  const [files, setFiles] = useState<File[] | null>(null);
  const [sniff, setSniff] = useState<Sniffed | null>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const take = (list: File[]) => {
      if (!list.length) return;
      setFiles(list);
      setSniff(null);
      sniffFile(list[0]!).then(setSniff, () => undefined);
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      take(Array.from(e.dataTransfer!.files));
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const list = Array.from(e.clipboardData?.files ?? []);
      if (list.length) {
        e.preventDefault();
        take(list);
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const go = (slug: string) => files && handOff(slug, files, (href) => router.push(href), VIEWER_SLUGS);
  const file = files?.[0];
  const tools = file && sniff ? toolsFor(file, sniff).slice(0, SHOWN) : [];

  return (
    <>
      {over ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
          <p className="rounded-2xl border-2 border-dashed border-primary bg-card px-8 py-6 text-base font-semibold text-foreground">
            Drop to open. Nothing is uploaded.
          </p>
        </div>
      ) : null}
      {file ? (
        <section
          aria-label="The file you dropped"
          aria-live="polite"
          className="mt-6 w-full max-w-2xl rounded-2xl border bg-card p-4 text-left shadow-[0_12px_32px_-20px_rgb(0_0_0/0.35)]"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <HugeiconsIcon icon={FileViewIcon} strokeWidth={1.9} className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {file.name || 'Pasted file'}
                {files!.length > 1 ? <span className="font-normal text-muted-foreground"> and {files!.length - 1} more</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {sniff ? sniff.format : 'Identifying…'} · {formatBytes(file.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => go('open-file')}
              className="h-9 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Open
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setFiles(null)}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
            </button>
          </div>
          {tools.length ? (
            <ul aria-label="Tools for this file" className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
              {tools.map((t) => (
                <li key={t.slug}>
                  <button
                    type="button"
                    onClick={() => go(t.slug)}
                    title={t.description}
                    className="flex h-8 items-center gap-1.5 rounded-full border bg-background py-0.5 pr-3 pl-0.5 text-xs font-medium outline-none transition-colors hover:border-input hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <ToolIcon tool={t} className="size-6 rounded-full [&_svg]:size-3.5" />
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground max-sm:hidden">Or drop a file anywhere on this page to open it or find the tools for it.</p>
      )}
    </>
  );
}
