'use client';

import { useEffect } from 'react';

/**
 * Registers the offline service worker (public/sw.js, generated at build time
 * by Serwist). Production only: development never registers one, and a
 * missing sw.js is ignored.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
