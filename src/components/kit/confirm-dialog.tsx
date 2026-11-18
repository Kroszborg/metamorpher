'use client';

import { Delete02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HoldButton } from './hold-button';

/**
 * The one confirm pattern for destructive actions: a danger mark, a plain
 * title and consequence, Cancel first, and a solid red confirm button.
 * `hold` turns the confirm into press-and-hold for the irreversible ones.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  action,
  cancel = 'Cancel',
  onConfirm,
  hold = false,
  icon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  body: React.ReactNode;
  /** Confirm button label, such as "Delete". */
  action: string;
  cancel?: string;
  onConfirm: () => void;
  hold?: boolean;
  icon?: React.ReactNode;
}) {
  const confirm = () => {
    onOpenChange(false);
    onConfirm();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
        <div className="flex items-start gap-3.5">
          <DangerMark>{icon}</DangerMark>
          <DialogHeader className="min-w-0 flex-1 pt-0.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-sm/relaxed">{body}</DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter>
          <Button variant="outline" size="lg" className="h-9 text-sm" onClick={() => onOpenChange(false)}>
            {cancel}
          </Button>
          {hold ? (
            <HoldButton onConfirm={confirm} className="h-9 text-sm">
              {action}
            </HoldButton>
          ) : (
            <Button variant="danger" size="lg" className="h-9 text-sm" onClick={confirm}>
              {action}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The round danger mark that heads destructive confirms. */
export function DangerMark({ children }: { children?: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 animate-pop place-items-center rounded-full bg-destructive/12 text-destructive [animation-delay:60ms] [&_svg]:size-[1.1rem]"
    >
      {children ?? <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />}
    </span>
  );
}
