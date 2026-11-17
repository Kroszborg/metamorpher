'use client';

import { Settings02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { AiSettingsPanel } from './ai-settings-panel';

/** "AI settings" button that opens the key and model settings in place. */
export function AiSettingsButton({ label = 'AI settings' }: { label?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-action="ai-settings">
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI settings</DialogTitle>
          <DialogDescription>
            Use your own API key for a cloud model. Downloaded on-device models are managed on the{' '}
            <Link href="/settings/ai" className="text-primary hover:underline">
              AI settings page
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <AiSettingsPanel compact />
      </DialogContent>
    </Dialog>
  );
}
