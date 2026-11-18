'use client';

import { StarIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { removeFromList } from '@/lib/motion';
import { toggleStar, useStarred } from '@/lib/tool-prefs';
import { cn } from '@/lib/utils';

export function StarButton({
  slug,
  title,
  showLabel = false,
  className,
}: {
  slug: string;
  title: string;
  showLabel?: boolean;
  className?: string;
}) {
  const starred = useStarred().includes(slug);
  // Bumped on each click so the icon re-mounts; it pops only when it becomes starred.
  const [presses, setPresses] = useState(0);
  return (
    <Button
      type="button"
      variant={showLabel ? 'outline' : 'ghost'}
      size={showLabel ? 'lg' : 'icon-sm'}
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${title}` : `Star ${title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPresses((n) => n + 1);
        // On the Starred page, unstarring lets the card leave and the grid close up smoothly.
        const list = starred ? e.currentTarget.closest('[data-exit-on-unstar]') : null;
        if (list) {
          removeFromList(list, e.currentTarget.closest<HTMLElement>('[data-vt-key]'), () => toggleStar(slug));
        } else {
          toggleStar(slug);
        }
      }}
      className={cn(!showLabel && 'text-faint hover:text-foreground', starred && 'text-warning', className)}
    >
      <HugeiconsIcon
        key={presses}
        icon={StarIcon}
        strokeWidth={2}
        className={cn(starred && '[&_path]:fill-current', starred && presses > 0 && 'animate-pop')}
      />
      {showLabel ? (starred ? 'Starred' : 'Star') : null}
    </Button>
  );
}
