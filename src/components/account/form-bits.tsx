'use client';

import { Alert02Icon, CheckmarkCircle02Icon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type ReactNode, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Centered card for the sign-in, sign-up and password pages. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="page-container flex justify-center pt-8 pb-20 sm:pt-16">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-[-0.03em]">{title}</h1>
          {subtitle ? <p className="text-sm/relaxed text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="rounded-2xl border bg-card p-5 sm:p-6">{children}</div>
        {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}

export const inputClass = 'h-9 text-sm md:text-sm';

export function Field({
  label,
  hint,
  error,
  className,
  ...props
}: React.ComponentProps<'input'> & { label: string; hint?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        className={inputClass}
        {...props}
      />
      {error || hint ? (
        <p id={`${id}-hint`} className={cn('text-xs/relaxed', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordField({
  label,
  hint,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { label: string; hint?: ReactNode }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? 'text' : 'password'}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(inputClass, 'pr-9')}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HugeiconsIcon icon={shown ? ViewOffSlashIcon : ViewIcon} strokeWidth={2} className="size-4" />
        </button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs/relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A message box above or below a form: errors, confirmations, notices. */
export function Notice({
  kind,
  children,
  className,
}: {
  kind: 'error' | 'success' | 'info';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm/relaxed',
        kind === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        kind === 'success' && 'border-success/30 bg-success/10 text-foreground',
        kind === 'info' && 'bg-muted/60 text-foreground',
        className,
      )}
    >
      <HugeiconsIcon
        icon={kind === 'error' ? Alert02Icon : CheckmarkCircle02Icon}
        strokeWidth={2}
        className={cn('mt-0.5 size-4 shrink-0', kind === 'success' && 'text-success', kind === 'info' && 'text-primary')}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const PASSWORD_HINT = 'At least 10 characters. A few unrelated words make a strong, memorable password.';

/** A same-site path to continue to after signing in, from ?next=. */
export function nextPath(fallback = '/account'): string {
  if (typeof window === 'undefined') return fallback;
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
