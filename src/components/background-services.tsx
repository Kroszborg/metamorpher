'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { ACCOUNTS_ENABLED, ANALYTICS_ENABLED } from '@/lib/account/flags';
import { onHintChange, readHint } from '@/lib/account/hint';
import { onStatsSwitch, statsAllowed } from '@/lib/analytics/prefs';
import { emit } from '@/lib/events';

function whenIdle(fn: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 1500);
  return () => window.clearTimeout(id);
}

/**
 * Starts the optional background services after the page is idle:
 * anonymous usage statistics (unless switched off, DNT or GPC) and, for a
 * browser that has signed in, account sync. Each is a separate chunk loaded
 * only when it will run, so signed-out pages do not download the sync code.
 */
export function BackgroundServices() {
  const pathname = usePathname();

  useEffect(() => {
    emit({ type: 'pageview', path: pathname });
  }, [pathname]);

  useEffect(() => {
    const startStats = () => {
      if (ANALYTICS_ENABLED && statsAllowed()) void import('@/lib/analytics/beacon').then((m) => m.startAnalytics());
    };
    const startSync = () => {
      if (ACCOUNTS_ENABLED && readHint()) void import('@/lib/account/sync').then((m) => m.startSync());
    };
    const cancel = whenIdle(() => {
      startStats();
      startSync();
    });
    const offSwitch = onStatsSwitch(startStats);
    const offHint = onHintChange(startSync);
    return () => {
      cancel();
      offSwitch();
      offHint();
    };
  }, []);

  return null;
}
