'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { runRollupNow } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';

export function RollupButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await runRollupNow();
          toast[r.ok ? 'success' : 'error'](r.message);
          router.refresh();
        })
      }
    >
      {pending ? 'Running…' : 'Run rollup now'}
    </Button>
  );
}
