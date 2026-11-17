import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, schema } from './db';
import { classifyUserAgent } from './user-agent';

/* --------------------------------------------------------------- input */

export const EVENT_TYPES = ['pageview', 'tool_open', 'run_start', 'run_success', 'run_fail', 'run_cancel'] as const;
export const SIZE_BUCKETS = ['lt1mb', '1-10mb', '10-100mb', '100mb-1gb', 'gt1gb'] as const;

const host = z
  .string()
  .max(253)
  .regex(/^[a-z0-9.-]+$/i);

export const beaconBody = z
  .array(
    z.object({
      t: z.enum(EVENT_TYPES),
      p: z.string().max(300).optional(),
      tl: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
        .optional(),
      e: z
        .string()
        .regex(/^[a-z0-9_]{1,32}$/)
        .optional(),
      d: z.number().int().min(0).max(86_400_000).optional(),
      s: z.enum(SIZE_BUCKETS).optional(),
      r: host.optional(),
    })
    // Unknown fields reject the whole batch: nothing unexpected is ever stored.
    .strict(),
  )
  .min(1)
  .max(20);

const KNOWN_PATH =
  /^\/$|^\/(tools|category)\/[a-z0-9-]{1,64}$|^\/(recent|starred|settings\/ai|privacy|history|account|sign-in|sign-up|forgot-password|reset-password)$/;

/** Only known routes are recorded as such; anything else (404s, typos, query strings) becomes "/other". */
export function normalizePath(p: string | undefined): string {
  if (!p) return '/other';
  const path = p.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  return KNOWN_PATH.test(path) ? path : '/other';
}

/* ---------------------------------------------------------------- salt */

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

const saltCache = new Map<string, string>();

/**
 * Today's random salt. It is created on the first event of the day and
 * deleted by the next rollup after the day ends, so visitor hashes cannot be
 * linked across days or traced back to an IP address afterwards.
 */
async function saltFor(db: Db, day: string): Promise<string> {
  const cached = saltCache.get(day);
  if (cached) return cached;
  await db
    .insert(schema.analyticsSalt)
    .values({ day, salt: randomBytes(32).toString('base64url') })
    .onConflictDoNothing();
  const [row] = await db.select().from(schema.analyticsSalt).where(eq(schema.analyticsSalt.day, day)).limit(1);
  if (!row) throw new Error('analytics salt missing');
  saltCache.clear();
  saltCache.set(day, row.salt);
  return row.salt;
}

function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || headers.get('x-real-ip') || '0.0.0.0';
}

/** True when the browser asks not to be tracked (Do Not Track or Global Privacy Control). */
export function optedOut(headers: Headers): boolean {
  return headers.get('dnt') === '1' || headers.get('sec-gpc') === '1';
}

/**
 * Stores one beacon batch. The IP address and user-agent string are used only
 * in memory here (for the daily visitor hash and the coarse browser/OS/device
 * labels) and are never written anywhere.
 */
export async function ingest(db: Db, headers: Headers, events: z.infer<typeof beaconBody>): Promise<number> {
  const ua = headers.get('user-agent');
  const coarse = classifyUserAgent(ua, headers.get('sec-ch-ua-mobile'));
  if (coarse.bot) return 0;
  const day = utcDay();
  const salt = await saltFor(db, day);
  const visitor = createHash('sha256')
    .update(`${salt}|${clientIp(headers)}|${ua ?? ''}|${headers.get('host') ?? ''}`)
    .digest('hex')
    .slice(0, 16);
  const countryHeader = headers.get('x-vercel-ip-country');
  const country = countryHeader && /^[A-Z]{2}$/.test(countryHeader) ? countryHeader : null;
  const ownHost = (headers.get('host') ?? '').split(':')[0];

  const rows = events.map((e) => {
    const toolEvent = e.t !== 'pageview';
    const ref = e.r?.toLowerCase().replace(/^www\./, '');
    return {
      day,
      visitor,
      type: e.t,
      path: toolEvent ? null : normalizePath(e.p),
      tool: toolEvent ? (e.tl ?? null) : null,
      errorCode: e.t === 'run_fail' ? (e.e ?? 'error') : null,
      durationMs: e.t === 'run_success' || e.t === 'run_fail' ? (e.d ?? null) : null,
      sizeBucket: e.t.startsWith('run_') ? (e.s ?? null) : null,
      browser: coarse.browser,
      os: coarse.os,
      device: coarse.device,
      country,
      referrer: !toolEvent && ref && ref !== ownHost ? ref : null,
    };
  });
  const valid = rows.filter((r) => r.type === 'pageview' || r.tool);
  if (valid.length) await db.insert(schema.analyticsEvent).values(valid);
  return valid.length;
}

/* -------------------------------------------------------------- rollup */

/** Upper edges (ms) of the duration histogram buckets used for the median. */
export const DURATION_EDGES = [250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000, 300000, 600000];
const RAW_KEEP_DAYS = 3;

async function rollupDay(db: Db, day: string): Promise<number> {
  const ev = schema.analyticsEvent;
  const edges = sql.raw(`array[${DURATION_EDGES.join(',')}]`);
  await db.delete(schema.analyticsDaily).where(eq(schema.analyticsDaily.day, day));
  await db.execute(sql`
    insert into ${schema.analyticsDaily} (day, kind, key, sub, count, visitors)
    select ${day}::date, 'total', '', '', count(*) filter (where type = 'pageview'), count(distinct visitor)
      from ${ev} where day = ${day} having count(*) > 0
    union all
    select ${day}::date, 'page', path, '', count(*), count(distinct visitor)
      from ${ev} where day = ${day} and type = 'pageview' group by path
    union all
    select ${day}::date, 'tool', tool, type, count(*), count(distinct visitor)
      from ${ev} where day = ${day} and tool is not null group by tool, type
    union all
    select ${day}::date, 'tool_error', tool, coalesce(error_code, 'error'), count(*), count(distinct visitor)
      from ${ev} where day = ${day} and type = 'run_fail' and tool is not null group by tool, error_code
    union all
    select ${day}::date, 'tool_duration', tool, width_bucket(duration_ms, ${edges})::text, count(*), 0
      from ${ev} where day = ${day} and type = 'run_success' and tool is not null and duration_ms is not null
      group by tool, width_bucket(duration_ms, ${edges})
    union all
    select ${day}::date, 'browser', browser, '', count(*), count(distinct visitor)
      from ${ev} where day = ${day} and type = 'pageview' group by browser
    union all
    select ${day}::date, 'os', os, '', count(*), count(distinct visitor)
      from ${ev} where day = ${day} and type = 'pageview' group by os
    union all
    select ${day}::date, 'device', device, '', count(*), count(distinct visitor)
      from ${ev} where day = ${day} and type = 'pageview' group by device
    union all
    select ${day}::date, 'country', coalesce(country, ''), '', count(*), count(distinct visitor)
      from ${ev} where day = ${day} and type = 'pageview' group by country
    union all
    select ${day}::date, 'referrer', referrer, '', count(*), count(distinct visitor)
      from ${ev} where day = ${day} and type = 'pageview' and referrer is not null group by referrer
  `);
  const [n] = await db
    .select({ n: sql<number>`count(*)` })
    .from(ev)
    .where(eq(ev.day, day));
  const events = Number(n?.n ?? 0);
  await db
    .insert(schema.analyticsRollup)
    .values({ day, events, rolledAt: new Date() })
    .onConflictDoUpdate({ target: schema.analyticsRollup.day, set: { events, rolledAt: new Date() } });
  return events;
}

/**
 * Rolls raw events up into daily aggregates and deletes what is no longer
 * needed: raw events older than a few days (once rolled up), past salts,
 * stale rate-limit counters and expired sessions. Safe to run any number of
 * times. `onlyToday` refreshes just today's numbers (used by the admin pages).
 */
export async function rollup(db: Db, { onlyToday = false } = {}) {
  const today = utcDay();
  let days: string[];
  if (onlyToday) days = [today];
  else {
    const pending = await db.execute<{ day: string }>(sql`
      select distinct e.day::text as day from ${schema.analyticsEvent} e
      left join ${schema.analyticsRollup} r on r.day = e.day
      where r.day is null or e.day >= ${addDays(today, -1)}
      order by 1`);
    days = pending.rows.map((r) => String(r.day).slice(0, 10));
  }
  let events = 0;
  for (const day of days) events += await rollupDay(db, day);

  let purged = 0;
  if (!onlyToday) {
    const cutoff = addDays(today, -RAW_KEEP_DAYS);
    const rolled = await db
      .select({ day: schema.analyticsRollup.day })
      .from(schema.analyticsRollup)
      .where(lt(schema.analyticsRollup.day, cutoff));
    if (rolled.length) {
      const res = await db
        .delete(schema.analyticsEvent)
        .where(
          and(
            lt(schema.analyticsEvent.day, cutoff),
            inArray(
              schema.analyticsEvent.day,
              rolled.map((r) => r.day),
            ),
          ),
        )
        .returning({ id: schema.analyticsEvent.id });
      purged = res.length;
    }
    await db.delete(schema.analyticsSalt).where(lt(schema.analyticsSalt.day, today));
    await db.delete(schema.rateLimit).where(lt(schema.rateLimit.lastRequest, Date.now() - 60 * 60 * 1000));
    await db.delete(schema.session).where(lt(schema.session.expiresAt, new Date()));
    await db.delete(schema.verification).where(lt(schema.verification.expiresAt, new Date()));
  }
  return { days, events, purged };
}
