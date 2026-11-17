'use client';

import { StarIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';
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
        toggleStar(slug);
      }}
      className={cn(!showLabel && 'text-faint hover:text-foreground', starred && 'text-warning', className)}
    >
      <HugeiconsIcon
        icon={StarIcon}
        strokeWidth={2}
        className={cn(starred && '[&_path]:fill-current')}
      />
      {showLabel ? (starred ? 'Starred' : 'Star') : null}
    </Button>
  );
}
