'use client';

import { Switch } from '@/components/ui/switch';

/** A labelled on/off option with an optional hint, for image tool option panels. */
export function SwitchField({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {hint ? <p className="text-[0.7rem]/relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
