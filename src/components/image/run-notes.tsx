'use client';

import { Alert02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import type { SourceInfo } from '@/engines/image';
import { baseName, extensionOf } from '@/lib/files';
import { cn } from '@/lib/utils';

export type Note = { text: string; tone?: 'info' | 'warn' };
/** Adds notes for one input file during a run. Passed to jobs through their options. */
export type Reporter = (input: { id: string; name: string }, notes: Note[]) => void;
/** Returns `name`, or "name (2).ext" when an earlier output of the same run already has it. */
export type NameClaimer = (name: string) => string;

/**
 * Per-file notes collected during a run, and output names kept unique within
 * the run (photo.jpg and photo.heic both becoming photo.jpg). Call `clear`
 * when a run starts.
 */
export function useRunNotes() {
  const [entries, setEntries] = useState<{ id: string; name: string; notes: Note[] }[]>([]);
  const names = useRef(new Set<string>());
  const report = useCallback<Reporter>((input, notes) => {
    if (!notes.length) return;
    setEntries((prev) => [...prev.filter((e) => e.id !== input.id), { id: input.id, name: input.name, notes }]);
  }, []);
  const claim = useCallback<NameClaimer>((name) => {
    const ext = extensionOf(name);
    let unique = name;
    for (let n = 2; names.current.has(unique.toLowerCase()); n += 1) {
      unique = ext ? `${baseName(name)} (${n}).${ext}` : `${name} (${n})`;
    }
    names.current.add(unique.toLowerCase());
    return unique;
  }, []);
  const clear = useCallback(() => {
    names.current.clear();
    setEntries([]);
  }, []);
  return useMemo(() => ({ entries, report, claim, clear }), [entries, report, claim, clear]);
}

/** Notes worth telling people about a decoded source (colour, animation, EXIF). */
export function sourceNotes(info: SourceInfo, { colourMatters = true } = {}): Note[] {
  const notes: Note[] = [];
  if (info.animated && info.animationKept) {
    notes.push({ text: `Animation kept${info.frames ? `: ${info.frames} frames` : ''}, with the original timing and loop count.` });
  } else if (info.animated) {
    notes.push({
      text: info.animationKeepable
        ? 'Animated image: only the first frame was used. Save as GIF, WebP or PNG to keep the animation.'
        : 'Animated AVIF or HEIF image: only the first frame was used (animation is kept for GIF, WebP and APNG sources).',
      tone: 'warn',
    });
  }
  if (colourMatters && info.colour === 'kept') {
    notes.push({ text: `Colour profile kept (${info.profile ?? 'embedded profile'}), so colours do not shift.` });
  } else if (colourMatters && info.colour === 'converted') {
    notes.push({
      text: `Converted from ${info.profile ?? 'its colour profile'} to sRGB; very saturated colours outside sRGB are clipped.`,
      tone: 'warn',
    });
  }
  return notes;
}

/** The notes of the last run, one row per file. Renders nothing when empty. */
export function RunNotes({ entries, title = 'Notes' }: { entries: ReturnType<typeof useRunNotes>['entries']; title?: string }) {
  if (!entries.length) return null;
  return (
    <SectionCard title={title} contentClassName="p-0">
      <ul className="divide-y">
        {entries.map((e) => (
          <li key={e.id} className="flex min-w-0 flex-col gap-1 px-5 py-2.5">
            <p className="truncate text-sm font-medium" title={e.name}>
              {e.name}
            </p>
            {e.notes.map((n, i) => (
              <p
                key={i}
                className={cn(
                  'flex items-start gap-1.5 text-xs/relaxed',
                  n.tone === 'warn' ? 'text-warning' : 'text-muted-foreground',
                )}
              >
                <HugeiconsIcon
                  icon={n.tone === 'warn' ? Alert02Icon : InformationCircleIcon}
                  strokeWidth={2}
                  className="mt-0.5 size-3.5 shrink-0"
                />
                {n.text}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
