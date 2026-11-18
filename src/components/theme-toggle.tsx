'use client';

import { ComputerIcon, Moon02Icon, Sun01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { useSlidingIndicator } from '@/components/ui/sliding-indicator';
import { syncThemeColor } from '@/lib/theme-color';
import { crossFadeNextThemeChange, switchTheme } from '@/lib/theme-transition';
import { cn } from '@/lib/utils';

const emptySubscribe = () => () => {};
export const useHydrated = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

/** Switches theme with the animated transition; for the toggle, the selector and the command palette. */
export function useThemeSwitch() {
  const { setTheme } = useTheme();
  return (next: string, origin?: Element | { x: number; y: number } | null) => switchTheme(next, setTheme, origin);
}

/**
 * Icon button that flips between dark and light. Both icons are rendered and
 * CSS picks one from the `.dark` class, so the right icon shows before
 * hydration and nothing animates on load; the new icon turns in on a switch.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const switchTo = useThemeSwitch();
  const hydrated = useHydrated();
  const dark = !hydrated || resolvedTheme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      data-theme-toggle=""
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={(e) => switchTo(dark ? 'light' : 'dark', e.currentTarget)}
      className={cn('grid place-items-center', className)}
    >
      <span className="theme-icon col-start-1 row-start-1 hidden dark:block" aria-hidden>
        <HugeiconsIcon icon={Sun01Icon} strokeWidth={2} className="size-[1.1rem]" />
      </span>
      <span className="theme-icon col-start-1 row-start-1 block dark:hidden" aria-hidden>
        <HugeiconsIcon icon={Moon02Icon} strokeWidth={2} className="size-[1.1rem]" />
      </span>
    </Button>
  );
}

const OPTIONS = [
  { value: 'dark', label: 'Dark', icon: Moon02Icon },
  { value: 'light', label: 'Light', icon: Sun01Icon },
  { value: 'system', label: 'System', icon: ComputerIcon },
] as const;

/** Three-way theme selector. */
export function ThemeSelector() {
  const { theme } = useTheme();
  const switchTo = useThemeSwitch();
  const hydrated = useHydrated();
  const list = useRef<HTMLFieldSetElement>(null);
  const indicator = useSlidingIndicator(list, hydrated ? theme : undefined, {
    className: 'bg-muted ring-1 ring-border',
  });
  return (
    <fieldset ref={list} className="group/seg relative inline-flex gap-1 rounded-lg border bg-background p-1">
      <legend className="sr-only">Theme</legend>
      {indicator}
      {OPTIONS.map((o) => {
        const active = hydrated && theme === o.value;
        return (
          <label
            key={o.value}
            data-indicator-active={active ? '' : undefined}
            className={cn(
              'relative z-[1] inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-(--dur-2) active:scale-[0.97] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              active
                ? 'bg-muted text-foreground ring-1 ring-border group-data-[indicator-ready]/seg:bg-transparent group-data-[indicator-ready]/seg:ring-0'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name="theme"
              value={o.value}
              checked={active}
              onChange={(e) => switchTo(o.value, e.currentTarget.parentElement)}
              className="sr-only"
            />
            <HugeiconsIcon icon={o.icon} strokeWidth={2} className="size-3.5" />
            {o.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Keeps <meta name="theme-color"> on the active background when the theme
 * changes, and cross-fades a theme change that comes from the OS. Its media
 * listener is created before next-themes' own (child effects run first), so
 * the fade is in place when next-themes swaps the class.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    // Wait a frame so next-themes has applied the class before we read the token.
    const raf = requestAnimationFrame(syncThemeColor);
    return () => cancelAnimationFrame(raf);
  }, [resolvedTheme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem('theme');
      } catch {}
      if (!stored || stored === 'system') crossFadeNextThemeChange();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return null;
}
