'use client';

import { Copy01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DrawnCheck } from '@/components/ui/drawn-check';
import { cn } from '@/lib/utils';

export function CopyButton({
  value,
  label = 'Copy',
  showLabel = false,
  className,
}: {
  value: string;
  label?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.');
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? 'sm' : 'icon-sm'}
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      {copied ? (
        // The copy icon flips to a check that pops and draws itself.
        <span key="copied" className="grid animate-pop place-items-center text-primary">
          <DrawnCheck className="size-3" strokeWidth={2.25} delay={40} />
        </span>
      ) : (
        <HugeiconsIcon key="copy" icon={Copy01Icon} strokeWidth={2} />
      )}
      {showLabel ? (copied ? 'Copied' : label) : null}
    </Button>
  );
}

/** A monospace value (ID, key prefix, URL) with a copy button. */
export function CopyField({ value, className }: { value: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-lg border bg-background py-0.5 pr-0.5 pl-2.5',
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}
