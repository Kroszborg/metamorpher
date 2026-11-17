'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { deleteUserAccount, revokeUserSessions, setUserDisabled } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Disable/enable, sign out everywhere, delete. No impersonation. */
export function UserActions({ id, email, disabled, self }: { id: string; email: string; disabled: boolean; self: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      router.refresh();
    });

  if (self) return <span className="text-xs text-muted-foreground">You</span>;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setUserDisabled(id, !disabled))}>
        {disabled ? 'Enable' : 'Disable'}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => revokeUserSessions(id))}>
        Sign out
      </Button>
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => setConfirm(true)}>
        Delete
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle>Delete {email}?</DialogTitle>
            <DialogDescription className="text-sm/relaxed">
              Deletes the account and every row stored with it (sessions, settings, synced tools, history, chats). This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="lg" className="h-9" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="h-9"
              onClick={() => {
                setConfirm(false);
                run(() => deleteUserAccount(id));
              }}
            >
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
