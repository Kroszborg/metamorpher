'use client';

import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

/** A password box with a show/hide toggle. Never autofilled from the browser's saved logins. */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        autoComplete="new-password"
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="pr-8"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon icon={shown ? ViewOffSlashIcon : ViewIcon} strokeWidth={2} className="size-3.5" />
      </button>
    </div>
  );
}
