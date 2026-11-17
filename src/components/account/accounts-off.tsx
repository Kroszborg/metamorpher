import { UserBlock01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { EmptyState } from '@/components/kit/empty-state';
import { Button } from '@/components/ui/button';

/** Shown on account pages when this deployment has no accounts (no database). */
export function AccountsOff() {
  return (
    <div className="page-container pt-10 pb-20">
      <div className="mx-auto max-w-md rounded-2xl border border-dashed">
        <EmptyState
          className="py-14"
          icon={<HugeiconsIcon icon={UserBlock01Icon} strokeWidth={1.8} />}
          title="Accounts are not available here"
          description="This copy of Metamorpher runs without a database, so there are no accounts. Every tool works without one: your files are processed on your device either way."
          action={
            <Button asChild size="lg" variant="outline">
              <Link href="/">Browse all tools</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
