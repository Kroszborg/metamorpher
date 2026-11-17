'use client';

import { ArrowDown01Icon, Clock01Icon, StarIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AccountButton } from '@/components/account/account-button';
import { Wordmark } from '@/components/brand';
import { CommandTrigger } from '@/components/command-palette';
import { ThemeToggle } from '@/components/theme-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getAvailableTool } from '@/tools/registry';
import { MenuPanel } from './menu-panel';
import { MobileMenu } from './mobile-menu';
import { activeGroupId, buildNavGroups } from './nav-groups';

const groups = buildNavGroups();
const categoryOfTool = (slug: string) => getAvailableTool(slug)?.category;

function IconLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: IconSvgElement;
  active: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'grid size-9 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-muted text-foreground',
          )}
        >
          <HugeiconsIcon icon={icon} strokeWidth={2} className="size-[1.1rem]" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Category menus for wide screens: disclosure buttons that open a full-width panel. */
function DesktopMenus({ pathname }: { pathname: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const current = activeGroupId(groups, pathname, categoryOfTool);

  // Close on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpenId(null);
  }

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenId(null);
      triggers.current.get(openId)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId]);

  const close = () => setOpenId(null);

  return (
    <nav aria-label="Tool categories" className="hidden h-full lg:block">
      <ul className="flex h-full items-center gap-0.5">
        {groups.map((g) => {
          const open = openId === g.id;
          const panelId = `menu-${g.id}`;
          return (
            <li
              key={g.id}
              className="h-full"
              onBlur={(e) => {
                // Close when focus moves somewhere else on the page (not on clicks into empty space).
                const next = e.relatedTarget as Node | null;
                if (open && next && !e.currentTarget.contains(next)) close();
              }}
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) triggers.current.set(g.id, el);
                  else triggers.current.delete(g.id);
                }}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : g.id)}
                onPointerEnter={(e) => {
                  // Once a menu is open, pointing at a neighbour switches to it.
                  if (e.pointerType === 'mouse' && openId && !open) setOpenId(g.id);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  setOpenId(g.id);
                  requestAnimationFrame(() =>
                    document.getElementById(panelId)?.querySelector<HTMLElement>('a')?.focus(),
                  );
                }}
                className={cn(
                  'relative flex h-full items-center gap-1 px-3 text-sm font-medium outline-none transition-colors',
                  'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors',
                  'focus-visible:after:bg-ring focus-visible:text-foreground',
                  open || current === g.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  open ? 'after:bg-primary' : current === g.id && 'after:bg-foreground/70',
                )}
              >
                {g.label}
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  strokeWidth={2}
                  className={cn('size-3.5 transition-transform', open && 'rotate-180')}
                />
              </button>
              {open ? (
                <>
                  <div
                    aria-hidden
                    onClick={close}
                    className="fixed inset-x-0 top-14 bottom-0 bg-background/70 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in-0"
                  />
                  <div
                    id={panelId}
                    className="scroll-slim absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-y bg-popover shadow-[0_32px_64px_-32px_rgb(0_0_0/0.5)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
                  >
                    <div className="page-container py-7">
                      <MenuPanel group={g} onNavigate={close} />
                    </div>
                  </div>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The site header: wordmark, category menus, search, saved tools, theme. Stays put while <main> scrolls. */
export function TopBar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const scroller = document.querySelector('[data-shell-scroll]');
    if (!scroller) return;
    const onScroll = () => setScrolled(scroller.scrollTop > 2);
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'relative z-40 h-14 shrink-0 border-b bg-background transition-[border-color] duration-200',
        scrolled ? 'border-border' : 'border-transparent',
      )}
    >
      <div className="page-container flex h-full items-center gap-2">
        <Link
          href="/"
          aria-label="Metamorpher, all tools"
          className="-ml-1 mr-3 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wordmark />
        </Link>
        <DesktopMenus pathname={pathname} />
        <div className="ml-auto flex items-center gap-1">
          <CommandTrigger className="sm:mr-1.5" />
          <div className="hidden items-center gap-1 lg:flex">
            <IconLink href="/starred" label="Starred tools" icon={StarIcon} active={pathname === '/starred'} />
            <IconLink href="/recent" label="Recent tools" icon={Clock01Icon} active={pathname === '/recent'} />
          </div>
          <ThemeToggle className="size-9 rounded-lg text-muted-foreground focus-visible:ring-ring" />
          <div data-slot="account" className="flex items-center empty:hidden">
            <AccountButton />
          </div>
          <MobileMenu groups={groups} pathname={pathname} />
        </div>
      </div>
    </header>
  );
}
