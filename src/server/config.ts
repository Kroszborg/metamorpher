import 'server-only';

/**
 * Server configuration read from the environment. Every backend feature is
 * optional: without a database the site is the static tool site it always was,
 * and the account and analytics endpoints answer 503.
 */
const env = process.env;
const isDev = env.NODE_ENV === 'development';

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const serverConfig = {
  isDev,
  isProd: env.NODE_ENV === 'production',
  /** Neon (or any Postgres reachable over Neon's serverless driver). */
  databaseUrl: env.DATABASE_URL || null,
  /** Development without DATABASE_URL: an embedded PGlite database under .data/. */
  usePglite: !env.DATABASE_URL && isDev,
  authSecret: env.BETTER_AUTH_SECRET || null,
  authUrl: env.BETTER_AUTH_URL || null,
  resendKey: env.RESEND_API_KEY || null,
  /** SMTP (for example a Gmail address with an app password). Host and port default to Gmail. */
  smtpUser: env.SMTP_USER || null,
  smtpPass: env.SMTP_PASS ? env.SMTP_PASS.replace(/\s+/g, '') : null,
  smtpHost: env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(env.SMTP_PORT) || 465,
  emailFrom: env.EMAIL_FROM || (env.SMTP_USER ? `Metamorpher <${env.SMTP_USER}>` : null),
  adminEmails: list(env.ADMIN_EMAILS),
  cronSecret: env.CRON_SECRET || null,
  analyticsOff: env.ANALYTICS_DISABLED === '1' || env.ANALYTICS_DISABLED === 'true',
};

/** Master switch, mirrored in next.config.ts: the backend is off unless ENABLE_BACKEND=1. */
export const backendEnabled = env.ENABLE_BACKEND === '1';

/** A database is available: Neon in production, PGlite in development (both only with the switch on). */
export const hasDatabase = backendEnabled && (Boolean(serverConfig.databaseUrl) || serverConfig.usePglite);

/** Accounts need a database and, in production, a secret for signing cookies. */
export const accountsEnabled = hasDatabase && (Boolean(serverConfig.authSecret) || isDev);

/** Real email delivery (Resend). In development without a key, links are printed to the console. */
export const smtpConfigured = Boolean(serverConfig.smtpUser && serverConfig.smtpPass);
export const mailConfigured = smtpConfigured || Boolean(serverConfig.resendKey && serverConfig.emailFrom);
export const mailProvider = smtpConfigured ? 'SMTP' : 'Resend';

/** Email verification and password reset need a way to deliver links. */
export const mailAvailable = mailConfigured || isDev;

export const analyticsEnabled = hasDatabase && !serverConfig.analyticsOff;

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && serverConfig.adminEmails.includes(email.toLowerCase());
}

/** Configuration problems shown to admins on /admin/system. Names only, never values. */
export function configWarnings(): string[] {
  const w: string[] = [];
  if (!serverConfig.databaseUrl) {
    w.push(
      isDev
        ? 'DATABASE_URL is not set: using the local PGlite database in .data/ (development only).'
        : 'DATABASE_URL is not set: accounts and analytics are switched off.',
    );
  }
  if (!serverConfig.authSecret) w.push('BETTER_AUTH_SECRET is not set.');
  if (!mailConfigured) {
    w.push(
      isDev
        ? 'No email service is set (SMTP_USER + SMTP_PASS, or RESEND_API_KEY + EMAIL_FROM): verification and reset links are printed to the server console.'
        : 'No email service is set (SMTP_USER + SMTP_PASS, or RESEND_API_KEY + EMAIL_FROM): sign-up works without email verification and password reset is unavailable.',
    );
  }
  if (serverConfig.adminEmails.length === 0) w.push('ADMIN_EMAILS is empty: nobody can open /admin.');
  if (!serverConfig.cronSecret) w.push('CRON_SECRET is not set: the daily analytics rollup route rejects every call.');
  if (!serverConfig.authUrl && !env.NEXT_PUBLIC_SITE_URL && !env.VERCEL_PROJECT_PRODUCTION_URL) {
    w.push('BETTER_AUTH_URL (or NEXT_PUBLIC_SITE_URL) is not set: links in emails use http://localhost:3000.');
  }
  if (serverConfig.analyticsOff) w.push('ANALYTICS_DISABLED is set: usage statistics are not collected.');
  return w;
}
