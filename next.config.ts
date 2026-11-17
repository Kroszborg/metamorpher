import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function nextConfig(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const env = process.env;
  // Build-time switches for the client, so signed-out pages never ask the
  // server whether accounts exist. Development always has a database (PGlite).
  // Master switch: accounts, history sync, statistics and /admin stay off until
  // ENABLE_BACKEND=1 is set (they are not finished being verified yet).
  const backend = env.ENABLE_BACKEND === '1';
  const hasDb = backend && (dev || Boolean(env.DATABASE_URL));
  const accounts = hasDb && (dev || Boolean(env.BETTER_AUTH_SECRET));
  const mail = dev || Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  const analytics = hasDb && !(env.ANALYTICS_DISABLED === '1' || env.ANALYTICS_DISABLED === 'true');

  return {
    poweredByHeader: false,
    reactStrictMode: true,
    env: {
      NEXT_PUBLIC_ACCOUNTS: accounts ? '1' : '',
      NEXT_PUBLIC_ACCOUNTS_MAIL: mail ? '1' : '',
      NEXT_PUBLIC_ANALYTICS: analytics ? '1' : '',
    },
    // The development database (PGlite) ships its own wasm; load it from node_modules.
    serverExternalPackages: ['@electric-sql/pglite'],
    async headers() {
      const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'X-Frame-Options', value: 'DENY' },
            // Camera and microphone stay available to this origin for the planned scan/transcribe tools.
            {
              key: 'Permissions-Policy',
              value: 'camera=(self), microphone=(self), geolocation=(), payment=()',
            },
          ],
        },
        {
          // The service worker must always be revalidated so updates reach users.
          source: '/sw.js',
          headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
        },
        // Account, admin and API responses are never indexed or cached.
        { source: '/admin/:path*', headers: [...noindex, { key: 'Cache-Control', value: 'no-store' }] },
        { source: '/admin', headers: [...noindex, { key: 'Cache-Control', value: 'no-store' }] },
        { source: '/api/:path*', headers: [...noindex, { key: 'Cache-Control', value: 'no-store' }] },
        ...['/account', '/history', '/sign-in', '/sign-up', '/forgot-password', '/reset-password'].map((source) => ({
          source,
          headers: noindex,
        })),
      ];
    },
  };
}
