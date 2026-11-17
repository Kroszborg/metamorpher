'use client';

import {
  Clock01Icon,
  Home01Icon,
  Key01Icon,
  Moon02Icon,
  Search01Icon,
  StarIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { rankMatch, searchValue } from '@/lib/tool-search';
import { getCategory } from '@/tools/categories';
import { activeCategories, AVAILABLE_TOOLS } from '@/tools/registry';

/** Fired on window to open the palette from anywhere (search buttons, dashboard). */
export const OPEN_PALETTE_EVENT = 'metamorpher:command-palette';

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

type Item = {
  id: string;
  label: string;
  hint?: string;
  icon?: IconSvgElement;
  run: () => void;
  keywords?: string[];
};

const itemClass =
  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground aria-selected:bg-muted data-[disabled=true]:opacity-50';

const itemValue = (it: Item) => searchValue(it.label, it.hint, it.id);
const rank = rankMatch;

/** ⌘K / Ctrl+K: jump to any tool or category, or switch theme. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  const go = (href: string) => () => {
    setOpen(false);
    router.push(href);
  };

  const tools: Item[] = AVAILABLE_TOOLS.map((t) => ({
    id: `t-${t.slug}`,
    label: t.title,
    hint: getCategory(t.category)?.title,
    icon: t.icon,
    run: go(`/tools/${t.slug}`),
    keywords: [...t.keywords, t.description],
  }));
  const categories: Item[] = activeCategories().map((c) => ({
    id: `c-${c.id}`,
    label: c.title,
    hint: 'Category',
    icon: c.icon,
    run: go(`/category/${c.id}`),
  }));
  const pages: Item[] = [
    { id: 'home', label: 'All tools', icon: Home01Icon, run: go('/'), keywords: ['home', 'dashboard'] },
    { id: 'recent', label: 'Recent', icon: Clock01Icon, run: go('/recent'), keywords: ['history'] },
    { id: 'starred', label: 'Starred', icon: StarIcon, run: go('/starred'), keywords: ['favourites', 'favorites'] },
    {
      id: 'ai-settings',
      label: 'AI settings',
      icon: Key01Icon,
      run: go('/settings/ai'),
      keywords: ['api key', 'keys', 'claude', 'anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'ollama', 'models', 'download'],
    },
  ];
  const actions: Item[] = [
    {
      id: 'a-theme',
      label: resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      icon: Moon02Icon,
      run: () => {
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
        setOpen(false);
      },
      keywords: ['theme', 'appearance', 'dark', 'light'],
    },
  ];

  // cmdk sorts items within a group but not the groups themselves, so the
  // best-matching group is moved to the top here.
  const best = (items: Item[]) =>
    Math.max(0, ...items.map((it) => rank(itemValue(it), search, it.keywords)));
  const sections: [string, Item[]][] = [
    ['Tools', tools],
    ['Categories', categories],
    ['Go to', pages],
    ['Appearance', actions],
  ];
  if (search.trim()) sections.sort((a, b) => best(b[1]) - best(a[1]));

  const group = (heading: string, items: Item[]) =>
    items.length ? (
      <Command.Group
        key={heading}
        heading={heading}
        className="px-2 py-1.5 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
      >
        {items.map((it) => (
          <Command.Item
            key={it.id}
            value={itemValue(it)}
            keywords={it.keywords}
            onSelect={it.run}
            className={itemClass}
          >
            {it.icon ? (
              <HugeiconsIcon
                icon={it.icon}
                strokeWidth={2}
                className="size-4 shrink-0 text-muted-foreground"
              />
            ) : null}
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint ? (
              <span className="truncate text-xs text-muted-foreground">{it.hint}</span>
            ) : null}
          </Command.Item>
        ))}
      </Command.Group>
    ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <DialogContent
        className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showClose={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search tools, categories and settings.</DialogDescription>
        <Command loop filter={rank} className="flex flex-col">
          <div className="flex items-center gap-2 border-b px-4">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="size-4 text-muted-foreground"
            />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search tools, formats and settings…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
              Esc
            </kbd>
          </div>
          <Command.List className="scroll-slim max-h-[min(60vh,26rem)] overflow-y-auto py-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
              No tool matches. More tools are on the way.
            </Command.Empty>
            {sections.map(([heading, items]) => group(heading, items))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Top-bar button that opens the palette and shows its shortcut. Icon-only below `sm`. */
export function CommandTrigger({ className }: { className?: string }) {
  const mac = useIsMac();
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Search tools"
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      className={cn(
        'flex size-9 items-center justify-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-auto sm:justify-start sm:border sm:bg-card sm:pr-1.5 sm:pl-3',
        className,
      )}
    >
      <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-[1.1rem] shrink-0 sm:size-4" />
      <span className="hidden pr-8 sm:inline">Search</span>
      <kbd className="hidden h-6 items-center rounded-md border bg-background px-1.5 font-mono text-[0.68rem] text-muted-foreground sm:inline-flex">
        {mac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  );
}

const noSubscribe = () => () => {};
/** True on Apple platforms, for the ⌘ vs Ctrl hint. False during SSR. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
}
