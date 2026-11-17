import type { ReactNode } from 'react';
import { CommandPalette } from '@/components/command-palette';
import { SiteFooter } from './site-footer';
import { TopBar } from './top-bar';

/**
 * App frame: a slim top bar over one scrolling column. Only <main> scrolls
 * (marked `data-shell-scroll`), so the bar stays put and tool sidebars that
 * use `sticky top-0` pin to the top of the content area.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Skip to content
      </a>
      <TopBar />
      <main
        id="main"
        tabIndex={-1}
        data-shell-scroll
        className="scroll-slim flex flex-1 flex-col overflow-y-auto outline-none"
      >
        <div className="route-enter flex-1">{children}</div>
        <SiteFooter />
      </main>
      <CommandPalette />
    </div>
  );
}
