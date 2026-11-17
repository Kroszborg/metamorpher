'use client';

import {
  ComputerIcon,
  Delete02Icon,
  Download04Icon,
  Logout03Icon,
  SmartPhone01Icon,
  UserCircleIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/kit/empty-state';
import { PageHeader } from '@/components/kit/page-header';
import { SectionCard } from '@/components/kit/section-card';
import { StatusBadge } from '@/components/kit/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/account/api';
import { setHint } from '@/lib/account/hint';
import { forgetAccount, signOut } from '@/lib/account/session';
import type { Me, SyncSettings } from '@/lib/account/sync';
import { cn } from '@/lib/utils';
import { inputClass, Notice, PASSWORD_HINT, PasswordField } from './form-bits';

type SessionRow = { id: string; token: string; userAgent: string | null; createdAt: string; updatedAt: string };

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function SyncRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
  indent,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  indent?: boolean;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-3.5', indent && 'pl-4 sm:pl-6')}>
      <div className="min-w-0">
        <label htmlFor={id} className={cn('text-sm font-medium', disabled && 'text-muted-foreground')}>
          {label}
        </label>
        <p className="mt-0.5 text-xs/relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-1" />
    </div>
  );
}

function Profile({ me, onRenamed }: { me: Me; onRenamed: (name: string) => void }) {
  const [name, setName] = useState(me.user.name);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== me.user.name && name.trim().length > 0;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await api('POST', '/api/auth/update-user', { name: name.trim() });
    setBusy(false);
    if (r.ok) {
      onRenamed(name.trim());
      toast.success('Name saved.');
    } else toast.error(r.message);
  };
  return (
    <SectionCard title="Profile">
      <div className="flex flex-col gap-5">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate font-medium">{me.user.email}</span>
            {me.user.emailVerified ? (
              <StatusBadge kind="success">Verified</StatusBadge>
            ) : (
              <StatusBadge kind="warning">Not verified</StatusBadge>
            )}
          </dd>
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{dateFmt.format(me.user.createdAt)}</dd>
        </dl>
        <form onSubmit={save} className="flex flex-col gap-1.5 sm:max-w-sm">
          <label htmlFor="acct-name" className="text-xs font-medium">
            Display name
          </label>
          <div className="flex gap-2">
            <Input
              id="acct-name"
              value={name}
              maxLength={60}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
            <Button type="submit" variant="outline" size="lg" className="h-9" disabled={!dirty || busy}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </SectionCard>
  );
}

function SyncSection({ me, onChange }: { me: Me; onChange: (s: SyncSettings) => void }) {
  const [pending, setPending] = useState(false);
  const s = me.settings;
  const set = async (patch: Partial<SyncSettings>) => {
    setPending(true);
    const r = await api<{ settings: SyncSettings }>('PATCH', '/api/me/settings', patch);
    setPending(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    onChange(r.data.settings);
    const { announceSettings } = await import('@/lib/account/sync');
    announceSettings(r.data.settings);
  };
  return (
    <SectionCard
      title="Sync"
      description="Everything is off until you switch it on. Files never leave your device; only what each switch names is stored on your account."
      contentClassName="py-1"
    >
      <div className="divide-y">
        <SyncRow
          id="sync-tools"
          label="Starred and recent tools"
          description="Keep the same starred and recent tools on every device you sign in on. Tool names only."
          checked={s.syncTools}
          disabled={pending}
          onChange={(v) => set({ syncTools: v })}
        />
        <SyncRow
          id="sync-history"
          label="Tool history"
          description="Record each run: tool, time, number of files, total size, duration and whether it worked. Never file contents."
          checked={s.syncHistory}
          disabled={pending}
          onChange={(v) => set({ syncHistory: v, ...(v ? {} : { historyFileNames: false }) })}
        />
        <SyncRow
          id="sync-names"
          indent
          label="Include file names"
          description="Also keep the names of the files you processed. Turning this off removes names already stored."
          checked={s.historyFileNames}
          disabled={pending || !s.syncHistory}
          onChange={(v) => set({ historyFileNames: v })}
        />
        <SyncRow
          id="sync-chats"
          label="Chat with PDF conversations"
          description="Keep questions, answers, document titles and page citations so a chat continues on another device with the same file. The document is never uploaded."
          checked={s.syncChats}
          disabled={pending}
          onChange={(v) => set({ syncChats: v })}
        />
      </div>
      <p className="pt-2 pb-3 text-xs text-muted-foreground">
        See and delete what is stored on the{' '}
        <Link href="/history" className="font-medium text-foreground underline-offset-4 hover:underline">
          history page
        </Link>
        .
      </p>
    </SectionCard>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const r = await api('POST', '/api/auth/change-password', {
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.code === 'INVALID_PASSWORD' ? 'The current password is not right.' : r.message);
      return;
    }
    setCurrent('');
    setNext('');
    setDone(true);
  };
  return (
    <SectionCard title="Password" description="Changing it signs you out on every other device.">
      <form onSubmit={submit} className="flex flex-col gap-4 sm:max-w-sm" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {done ? <Notice kind="success">Password changed. Other devices were signed out.</Notice> : null}
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <div>
          <Button type="submit" size="lg" className="h-9 px-4 text-sm" disabled={busy || !current || next.length < 10}>
            {busy ? 'Saving…' : 'Change password'}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function Sessions({ currentId }: { currentId: string | null }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<SessionRow[]>('GET', '/api/auth/list-sessions');
    setRows(r.ok ? [...r.data].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) : []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const revoke = async (token: string) => {
    const r = await api('POST', '/api/auth/revoke-session', { token });
    if (r.ok) {
      toast.success('Signed out that device.');
      void load();
    } else toast.error(r.message);
  };
  const revokeOthers = async () => {
    const r = await api('POST', '/api/auth/revoke-other-sessions', {});
    if (r.ok) {
      toast.success('Signed out everywhere else.');
      void load();
    } else toast.error(r.message);
  };

  const others = rows?.filter((s) => s.id !== currentId).length ?? 0;
  return (
    <SectionCard
      title="Signed-in devices"
      description="Each sign-in keeps only a coarse device label, never your IP address."
      action={
        others > 0 ? (
          <Button variant="ghost" size="sm" onClick={revokeOthers}>
            Sign out others
          </Button>
        ) : null
      }
      contentClassName="py-1"
    >
      {rows === null ? (
        <div className="flex flex-col gap-2 py-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((s) => {
            const mobile = /iOS|Android/.test(s.userAgent ?? '');
            const current = s.id === currentId;
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <HugeiconsIcon icon={mobile ? SmartPhone01Icon : ComputerIcon} strokeWidth={1.8} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                    {s.userAgent ?? 'Unknown device'}
                    {current ? <StatusBadge kind="success">This device</StatusBadge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Signed in {dateTimeFmt.format(Date.parse(s.createdAt))} · active {dateTimeFmt.format(Date.parse(s.updatedAt))}
                  </p>
                </div>
                {!current ? (
                  <Button variant="ghost" size="sm" onClick={() => revoke(s.token)} aria-label={`Sign out ${s.userAgent ?? 'device'}`}>
                    <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} />
                    <span className="hidden sm:inline">Sign out</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api('POST', '/api/auth/delete-user', { password });
    setBusy(false);
    if (!r.ok) {
      setError(r.code === 'INVALID_PASSWORD' ? 'That password is not right.' : r.message);
      return;
    }
    await forgetAccount();
    toast.success('Your account and everything stored with it were deleted.');
    router.push('/');
  };
  return (
    <>
      <Button variant="destructive" size="lg" className="h-9 px-3 text-sm" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        Delete account
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)]">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription className="text-sm/relaxed">
                This permanently deletes your account, synced tools, history and chat conversations, and signs out every
                device. Starred tools and chats saved in this browser stay here. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {error ? <Notice kind="error">{error}</Notice> : null}
            <PasswordField
              label="Enter your password to confirm"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" className="h-9" onClick={() => setOpen(false)}>
                Keep account
              </Button>
              <Button type="submit" variant="destructive" size="lg" className="h-9" disabled={busy || !password}>
                {busy ? 'Deleting…' : 'Delete everything'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | 'signed-out' | 'error'>(null);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<Me>('GET', '/api/me');
      if (!live) return;
      if (!r.ok) {
        if (r.status === 401) void forgetAccount();
        setMe(r.status === 401 ? 'signed-out' : 'error');
        return;
      }
      setMe(r.data);
      setHint(r.data.user, r.data.admin);
      // The account was just confirmed from an email link: start sync in this tab.
      if (new URLSearchParams(window.location.search).has('verified')) {
        setVerified(true);
        window.history.replaceState(null, '', '/account');
      }
      void import('@/lib/account/sync').then((m) => m.startSync());
      const s = await api<{ session: { id: string } } | null>('GET', '/api/auth/get-session');
      if (live && s.ok && s.data) setCurrentSession(s.data.session.id);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (me === null) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (me === 'signed-out' || me === 'error') {
    return (
      <div className="rounded-2xl border border-dashed">
        <EmptyState
          className="py-16"
          icon={<HugeiconsIcon icon={UserCircleIcon} strokeWidth={1.8} />}
          title={me === 'error' ? 'Your account could not be loaded' : 'You are not signed in'}
          description={
            me === 'error'
              ? 'Check your connection and reload the page.'
              : 'Sign in to manage sync, your history and your account. The tools work without an account.'
          }
          action={
            me === 'signed-out' ? (
              <div className="flex gap-2">
                <Button asChild size="lg">
                  <Link href="/sign-in?next=/account">Sign in</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/sign-up">Create an account</Link>
                </Button>
              </div>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {verified ? <Notice kind="success">Email confirmed. You are signed in.</Notice> : null}
      <Profile me={me} onRenamed={(name) => setMe({ ...me, user: { ...me.user, name } })} />
      <SyncSection me={me} onChange={(settings) => setMe({ ...me, settings })} />
      <ChangePassword />
      <Sessions currentId={currentSession} />
      <SectionCard title="Your data" description="Everything stored for this account, in one JSON file. Files are never stored, so none are included.">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="lg" className="h-9 px-3 text-sm">
              <a href="/api/me/export" download>
                <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                Export my data
              </a>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-9 px-3 text-sm"
              onClick={async () => {
                await signOut();
                router.push('/');
              }}
            >
              <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} />
              Sign out
            </Button>
          </div>
          <div className="flex flex-col gap-2 border-t pt-5">
            <p className="text-sm font-medium">Delete account</p>
            <p className="max-w-prose text-xs/relaxed text-muted-foreground">
              Removes the account and every row stored with it. Anonymous usage counts are not linked to accounts, so there
              is nothing of yours to remove there.
            </p>
            <div className="mt-1">
              <DeleteAccount />
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

export function AccountHeader() {
  return (
    <PageHeader
      title="Account"
      subtitle="Your profile, what syncs between your devices, and your data."
    />
  );
}
