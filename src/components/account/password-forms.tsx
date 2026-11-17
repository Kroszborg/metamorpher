'use client';

import Link from 'next/link';
import { type FormEvent, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/account/api';
import { ACCOUNTS_MAIL } from '@/lib/account/flags';
import { AuthShell, Field, Notice, PASSWORD_HINT, PasswordField } from './form-bits';

function MailOff() {
  return (
    <AuthShell title="Password reset is unavailable" subtitle="This site cannot send email right now.">
      <p className="text-sm/relaxed text-muted-foreground">
        If you are signed in on another device you can change your password on the account page there. Otherwise, contact
        the site owner.
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ACCOUNTS_MAIL) return <MailOff />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api('POST', '/api/auth/request-password-reset', {
      email: email.trim(),
      redirectTo: '/reset-password',
    });
    setBusy(false);
    // Same answer whether or not the address has an account.
    if (r.ok || r.status === 400 || r.status === 404) setSent(true);
    else setError(r.message);
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we will send a link to choose a new password."
      footer={
        <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Notice kind="success">
          If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. It expires in an hour.
        </Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" size="lg" className="h-9 text-sm" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

const noop = () => () => {};

export function ResetPasswordForm() {
  // The reset link lands here as /reset-password?token=… (or ?error=… when expired).
  const search = useSyncExternalStore(noop, () => window.location.search, () => null);
  const q = search === null ? null : new URLSearchParams(search);
  const token = q?.get('token') ?? null;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ACCOUNTS_MAIL) return <MailOff />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api('POST', '/api/auth/reset-password', { newPassword: password, token });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.code === 'INVALID_TOKEN' ? 'This link has expired or was already used. Request a new one.' : r.message);
  };

  if (done) {
    return (
      <AuthShell title="Password changed" subtitle="You were signed out everywhere. Sign in with your new password.">
        <Button asChild size="lg" className="h-9 w-full text-sm">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  if (q === null) return <div className="min-h-96" aria-busy="true" />;
  if (q.has('error') || !token) {
    return (
      <AuthShell title="This link does not work" subtitle="Reset links expire after an hour and work once.">
        <Button asChild size="lg" className="h-9 w-full text-sm">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <PasswordField
          label="New password"
          autoComplete="new-password"
          required
          hint={PASSWORD_HINT}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordField
          label="Repeat new password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button type="submit" size="lg" className="h-9 text-sm" disabled={busy || !password || !confirm}>
          {busy ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </AuthShell>
  );
}
