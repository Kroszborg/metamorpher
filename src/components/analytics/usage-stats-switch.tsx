'use client';

import { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { ANALYTICS_ENABLED } from '@/lib/account/flags';
import { setStatsSwitch, useStatsSwitch } from '@/lib/analytics/prefs';
import { cn } from '@/lib/utils';

/**
 * The visitor's switch for anonymous usage statistics, stored in this browser.
 * Shows as off (and locked) when the browser sends Do Not Track or Global
 * Privacy Control. Renders nothing on deployments without statistics.
 */
export function UsageStatsSwitch({ className, withHint = false }: { className?: string; withHint?: boolean }) {
  const id = useId();
  const state = useStatsSwitch();
  if (!ANALYTICS_ENABLED) return null;
  const on = !!state && state.on && !state.blocked;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-2.5">
        <Switch
          id={id}
          checked={on}
          disabled={!state || state.blocked}
          onCheckedChange={(v) => setStatsSwitch(v)}
          aria-describedby={withHint ? `${id}-hint` : undefined}
        />
        <label htmlFor={id} className="text-sm">
          Usage statistics
        </label>
      </div>
      {withHint ? (
        <p id={`${id}-hint`} className="text-xs/relaxed text-muted-foreground">
          {state?.blocked
            ? 'Off: your browser asks sites not to track you (Do Not Track or Global Privacy Control), so nothing is sent.'
            : on
              ? 'On: anonymous page and tool counts help decide what to improve. No cookies, no identifiers, no file details.'
              : 'Off: this browser sends no usage statistics.'}
        </p>
      ) : null}
    </div>
  );
}
