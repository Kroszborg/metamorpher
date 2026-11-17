import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { accountsEnabled, mailAvailable, serverConfig } from './config';
import { type Db, getDb, schema } from './db';
import { sendResetMail, sendVerificationMail } from './mail';
import { passwordProblem } from './password-policy';
import { sessionLabel } from './user-agent';

const DAY = 60 * 60 * 24;

/** Runs mail delivery after the response, so response time does not reveal whether an address exists. */
function deliverLater(task: () => Promise<void>) {
  const run = () => task().catch((err: unknown) => console.error('[mail]', err instanceof Error ? err.message : 'send failed'));
  try {
    after(run);
  } catch {
    void run();
  }
}

function trustedOrigins(): string[] {
  const out = new Set<string>([SITE_URL]);
  if (serverConfig.authUrl) out.add(new URL(serverConfig.authUrl).origin);
  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) out.add(`https://${host}`);
  }
  return [...out];
}

function createAuth(db: Db) {
  return betterAuth({
    appName: SITE_NAME,
    baseURL: serverConfig.authUrl ?? SITE_URL,
    basePath: '/api/auth',
    secret: serverConfig.authSecret ?? undefined,
    trustedOrigins: trustedOrigins(),
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Without any way to deliver mail (production with no Resend key) sign-up
      // works without verification and password reset is switched off.
      requireEmailVerification: mailAvailable,
      autoSignIn: !mailAvailable,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      ...(mailAvailable
        ? {
            sendResetPassword: async ({ user, url }) => deliverLater(() => sendResetMail(user.email, url)),
          }
        : {}),
    },
    ...(mailAvailable
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            expiresIn: 60 * 60,
            sendVerificationEmail: async ({ user, url }) => deliverLater(() => sendVerificationMail(user.email, url)),
          },
        }
      : {}),
    user: {
      additionalFields: {
        disabled: { type: 'boolean', required: false, defaultValue: false, input: false },
        lastSeenAt: { type: 'date', required: false, input: false },
      },
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: 10 },
        '/request-password-reset': { window: 15 * 60, max: 3 },
        '/send-verification-email': { window: 15 * 60, max: 3 },
        '/reset-password': { window: 15 * 60, max: 10 },
        '/change-password': { window: 15 * 60, max: 10 },
        '/delete-user': { window: 15 * 60, max: 5 },
        '/get-session': false,
      },
    },
    advanced: {
      cookiePrefix: 'metamorpher',
      useSecureCookies: serverConfig.isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: serverConfig.isProd, path: '/' },
    },
    databaseHooks: {
      session: {
        create: {
          // Keep no IP address and only a coarse device label with each session.
          before: async (s) => {
            const [row] = await db
              .select({ disabled: schema.user.disabled })
              .from(schema.user)
              .where(eq(schema.user.id, s.userId))
              .limit(1);
            if (!row || row.disabled) return false;
            return { data: { ...s, ipAddress: null, userAgent: sessionLabel(s.userAgent) } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (ctx.path === '/sign-up/email') {
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (name.length > 60) throw new APIError('BAD_REQUEST', { message: 'Name must be 60 characters or fewer.' });
          const problem = passwordProblem(String(body.password ?? ''), String(body.email ?? ''));
          if (problem) throw new APIError('BAD_REQUEST', { message: problem, code: 'WEAK_PASSWORD' });
        }
        if (ctx.path === '/reset-password' || ctx.path === '/change-password') {
          const problem = passwordProblem(String(body.newPassword ?? ''), '');
          if (problem) throw new APIError('BAD_REQUEST', { message: problem, code: 'WEAK_PASSWORD' });
        }
        if (ctx.path === '/update-user' && typeof body.name === 'string' && body.name.trim().length > 60) {
          throw new APIError('BAD_REQUEST', { message: 'Name must be 60 characters or fewer.' });
        }
        if (ctx.path === '/sign-in/email' && typeof body.email === 'string') {
          const [row] = await db
            .select({ disabled: schema.user.disabled })
            .from(schema.user)
            .where(eq(schema.user.email, body.email.trim().toLowerCase()))
            .limit(1);
          if (row?.disabled) {
            throw new APIError('FORBIDDEN', { message: 'This account has been disabled.', code: 'ACCOUNT_DISABLED' });
          }
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

type Holder = { auth?: Auth };
const holder: Holder = ((globalThis as { __metamorpherAuth?: Holder }).__metamorpherAuth ??= {});

/** The Better Auth instance, or null when accounts are switched off. */
export async function getAuth(): Promise<Auth | null> {
  if (!accountsEnabled) return null;
  if (holder.auth) return holder.auth;
  const db = await getDb();
  if (!db) return null;
  holder.auth = createAuth(db);
  return holder.auth;
}
