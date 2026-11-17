'use client';

import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  Clock01Icon,
  Home01Icon,
  Key01Icon,
  Menu01Icon,
  Search01Icon,
  StarIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Wordmark } from '@/components/brand';
import { openCommandPalette } from '@/components/command-palette';
import { categoryTint } from '@/components/tools/category-tint';
import { AUTHOR, SOURCE_URL } from '@/lib/site';
import { cn } from '@/lib/utils';
import { toolsInCategory } from '@/tools/registry';
import type { NavGroup } from './nav-groups';

const row =
  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.95rem] outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Full-screen menu for narrow screens, built on a modal <dialog>: the browser
 * traps focus, Escape closes it, and focus returns to the menu button.
 */
export function MobileMenu({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Close on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const close = () => setOpen(false);
  const page = (href: string) => (pathname === href ? 'page' : undefined);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-lg text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} className="size-5" />
      </button>

      <dialog
        ref={dialog}
        aria-label="Menu"
        onClose={close}
        onCancel={close}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-transparent open:flex open:flex-col motion-safe:open:animate-in motion-safe:open:fade-in-0 motion-safe:open:slide-in-from-top-2"
      >
        {open ? (
          <>
            <div className="page-container flex h-14 shrink-0 items-center justify-between border-b">
              <Link
                href="/"
                onClick={close}
                className="-ml-1 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Wordmark />
              </Link>
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="grid size-9 place-items-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-5" />
              </button>
            </div>

            <div className="scroll-slim flex-1 overflow-y-auto">
              <div className="page-container flex flex-col gap-6 py-5">
                <button
                  type="button"
                  onClick={() => {
                    close();
                    openCommandPalette();
                  }}
                  className="flex h-12 items-center gap-3 rounded-xl border bg-card px-4 text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-5" />
                  Search tools
                </button>

                <ul className="-mx-3 grid grid-cols-2 gap-1">
                  {[
                    { href: '/', label: 'All tools', icon: Home01Icon },
                    { href: '/starred', label: 'Starred', icon: StarIcon },
                    { href: '/recent', label: 'Recent', icon: Clock01Icon },
                    { href: '/settings/ai', label: 'AI settings', icon: Key01Icon },
                  ].map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={close}
                        aria-current={page(l.href)}
                        className={cn(row, 'aria-[current=page]:bg-muted')}
                      >
                        <HugeiconsIcon icon={l.icon} strokeWidth={2} className="size-5 text-muted-foreground" />
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col border-t">
                  {groups.map((g) => (
                    <details key={g.id} name="mobile-menu-group" className="group border-b">
                      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg py-4 font-display text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        {g.label}
                        <span className="text-sm font-normal text-muted-foreground tabular-nums">{g.toolCount}</span>
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          strokeWidth={2}
                          className="ml-auto size-5 text-muted-foreground transition-transform group-open:rotate-180"
                        />
                      </summary>
                      <div className="flex flex-col gap-5 pb-5">
                        {g.categories.map((c) => {
                          const tint = categoryTint(c.id);
                          return (
                            <div key={c.id} className="flex flex-col">
                              {g.categories.length > 1 ? (
                                <Link
                                  href={`/category/${c.id}`}
                                  onClick={close}
                                  className={cn(row, '-mx-3 py-1.5 text-sm font-semibold')}
                                >
                                  <HugeiconsIcon icon={c.icon} strokeWidth={2} className={cn('size-4', tint.icon)} />
                                  {c.title}
                                </Link>
                              ) : null}
                              <ul className="-mx-3 grid sm:grid-cols-2">
                                {toolsInCategory(c.id).map((t) => (
                                  <li key={t.slug}>
                                    <Link
                                      href={`/tools/${t.slug}`}
                                      onClick={close}
                                      aria-current={page(`/tools/${t.slug}`)}
                                      className={cn(
                                        row,
                                        'py-2 text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground',
                                      )}
                                    >
                                      <HugeiconsIcon
                                        icon={t.icon}
                                        strokeWidth={1.8}
                                        className={cn('size-[1.1rem] shrink-0', tint.icon)}
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
                    </details>
                  ))}
                </div>

                <div className="flex flex-col gap-2 pb-4 text-sm text-muted-foreground">
                  <a
                    href={SOURCE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 self-start rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Source code (AGPL-3.0)
                    <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-3.5" />
                  </a>
                  <p>
                    Made by{' '}
                    <a
                      href={AUTHOR.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {AUTHOR.name}
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
