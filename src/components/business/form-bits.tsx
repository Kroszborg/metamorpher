'use client';

import { Download04Icon, FileImportIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useId, useRef } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { downloadBlob } from '@/lib/files';
import { cn } from '@/lib/utils';

/** A compact labelled field with an optional hint or error line. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[0.7rem] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[0.7rem]/relaxed text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[0.7rem]/relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** A text input bound to a string, with label. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  className,
  inputMode,
  type,
  maxLength = 200,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: React.ReactNode;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  type?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} className={className} htmlFor={id}>
      <Input
        id={id}
        value={value}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </Field>
  );
}

export function AreaField({
  label,
  value,
  onChange,
  placeholder,
  className,
  rows = 2,
  maxLength = 2000,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Field label={label} className={className} htmlFor={id}>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        className="min-h-0"
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </Field>
  );
}

/** A native select (good pickers on phones) styled like the inputs. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  className,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  className?: string;
  hint?: React.ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} className={className} hint={hint} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 md:text-xs/relaxed dark:bg-input/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** "Save as JSON" and "Open JSON" buttons for a form. */
export function JsonButtons({
  fileName,
  serialize,
  onLoad,
  saveLabel = 'Save as JSON',
  loadLabel = 'Open JSON',
}: {
  fileName: () => string;
  serialize: () => string;
  /** Throws an Error with a human message when the text is not valid. */
  onLoad: (text: string) => void;
  saveLabel?: string;
  loadLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => downloadBlob(new Blob([serialize()], { type: 'application/json' }), fileName())}
      >
        <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
        {saveLabel}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />
        {loadLabel}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label={loadLabel}
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          try {
            if (file.size > 20 * 1024 * 1024) throw new Error('This file is too large to be a saved form.');
            onLoad(await file.text());
            toast.success(`Opened ${file.name}.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'This file could not be opened.');
          }
        }}
      />
    </div>
  );
}

/** Safe file-name stem: "INV/2026/01" → "INV-2026-01". */
export function fileStem(text: string, fallback: string): string {
  const s = text.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s.slice(0, 80) || fallback;
}

/** Reads a Blob as a data: URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('This file could not be read.'));
    r.readAsDataURL(blob);
  });
}
