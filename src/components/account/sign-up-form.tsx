'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/account/api';
import { ACCOUNTS_MAIL } from '@/lib/account/flags';
import { afterSignIn } from '@/lib/account/session';
import { AuthShell, Field, Notice, PASSWORD_HINT, PasswordField } from './form-bits';

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError('Use at least 10 characters for the password.');
      return;
    }
    setBusy(true);
    setError(null);
    const address = email.trim();
    const r = await api<{ token: string | null }>('POST', '/api/auth/sign-up/email', {
      name: name.trim() || address.split('@')[0],
      email: address,
      password,
      callbackURL: '/account?verified=1',
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.code === 'USER_ALREADY_EXISTS' || r.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
        ? 'An account with this email already exists. Sign in instead.'
        : r.message);
      return;
    }
    if (ACCOUNTS_MAIL && !r.data.token) {
      setSentTo(address);
      return;
    }
    await afterSignIn();
    router.push('/account');
  };

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle={<>We sent a confirmation link to <strong className="text-foreground">{sentTo}</strong>.</>}>
        <div className="flex flex-col gap-3 text-sm/relaxed text-muted-foreground">
          <p>Open the link to finish creating your account; it signs you in on this device. The link expires in an hour.</p>
          <p>
            Nothing arrived? Check spam, or{' '}
            <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
              sign in
            </Link>{' '}
            to request a new link.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create an account"
      subtitle="Optional. Keep starred tools, run history and AI chats on every device you use. Files are still processed on your device and never uploaded."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Field
          label="Name (optional)"
          autoComplete="name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
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
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          hint={PASSWORD_HINT}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" size="lg" className="h-9 text-sm" disabled={busy || !email || !password}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-xs/relaxed text-muted-foreground">
          We store your email, name and a hash of your password. See{' '}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
            privacy
          </Link>{' '}
          for everything else.
        </p>
      </form>
    </AuthShell>
  );
}
