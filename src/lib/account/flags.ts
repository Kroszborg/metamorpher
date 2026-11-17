/**
 * Build-time switches (set in next.config.ts from the server environment), so
 * signed-out visitors never need a request to learn whether accounts exist.
 */
export const ACCOUNTS_ENABLED = process.env.NEXT_PUBLIC_ACCOUNTS === '1';
/** Email delivery is set up: verification and password reset are available. */
export const ACCOUNTS_MAIL = process.env.NEXT_PUBLIC_ACCOUNTS_MAIL === '1';
export const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS === '1';
