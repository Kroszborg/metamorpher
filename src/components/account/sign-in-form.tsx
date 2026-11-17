'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/account/api';
import { ACCOUNTS_MAIL } from '@/lib/account/flags';
import { afterSignIn } from '@/lib/account/session';
import { AuthShell, Field, Notice, nextPath, PasswordField } from './form-bits';

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    const r = await api('POST', '/api/auth/sign-in/email', { email: email.trim(), password, rememberMe: true });
    if (!r.ok) {
      setBusy(false);
      if (r.status === 403 && r.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
        return;
      }
      setError(r.status === 401 ? 'That email and password do not match an account.' : r.message);
      return;
    }
    await afterSignIn();
    router.push(nextPath());
  };

  const resend = async () => {
    const r = await api('POST', '/api/auth/send-verification-email', {
      email: email.trim(),
      callbackURL: '/account?verified=1',
    });
    if (r.ok) setResent(true);
    else setError(r.message);
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="An account is optional. It keeps your starred tools, history and AI chats in step across devices. Your files are never uploaded."
      footer={
        <>
          New here?{' '}
          <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {unverified ? (
          <Notice kind="info">
            <p>Confirm your email first. We sent a link when you signed up{resent ? ', and a new one just now' : ''}.</p>
            {!resent ? (
              <button type="button" onClick={resend} className="mt-1 font-medium text-primary underline-offset-4 hover:underline">
                Send a new link
              </button>
            ) : null}
          </Notice>
        ) : null}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          {ACCOUNTS_MAIL ? (
            <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          ) : (
            <span />
          )}
          <Button type="submit" size="lg" className="h-9 px-4 text-sm" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
