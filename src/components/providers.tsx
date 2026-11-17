'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { ThemeColorSync } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: ReactNode }) {
  // Light/dark follows the OS by default.
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange={false}>
      <TooltipProvider delayDuration={200}>
        <ThemeColorSync />
        {children}
      </TooltipProvider>
    </ThemeProvider>
  );
}
