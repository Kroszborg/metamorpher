/**
 * Database schema (Drizzle, PostgreSQL). Migrations are generated from this
 * file into /drizzle with `npm run db:generate`.
 *
 * Nothing here ever holds file contents. Account tables follow Better Auth's
 * core schema; the rest is opt-in sync data and anonymous usage counts.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* ---------------------------------------------------------------- auth */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  /** Set by an admin: the user cannot sign in and has no sessions. */
  disabled: boolean('disabled').notNull().default(false),
  /** Last authenticated request, updated at most every few minutes. */
  lastSeenAt: ts('last_seen_at'),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    /** Always null: the IP address is not kept with sessions. */
    ipAddress: text('ip_address'),
    /** A coarse label such as "Chrome on Windows", never the raw user-agent string. */
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** Better Auth rate-limit counters (key = client IP + path), pruned hourly by the cron job. */
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/* ------------------------------------------------------- opt-in sync */

/** Sync switches. Every switch is off until the user turns it on. */
export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  syncTools: boolean('sync_tools').notNull().default(false),
  syncHistory: boolean('sync_history').notNull().default(false),
  historyFileNames: boolean('history_file_names').notNull().default(false),
  syncChats: boolean('sync_chats').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Starred and recent tool slugs. */
export const userTools = pgTable('user_tools', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  starred: jsonb('starred').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  recent: jsonb('recent').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** One tool run: what ran and how it went. File names only when the user allows it; never contents. */
export const runHistory = pgTable(
  'run_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    at: ts('at').notNull().defaultNow(),
    fileCount: integer('file_count').notNull(),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    outcome: text('outcome').$type<'success' | 'failed' | 'cancelled'>().notNull(),
    errorCode: text('error_code'),
    fileNames: jsonb('file_names').$type<string[]>(),
  },
  (t) => [index('run_history_user_at_idx').on(t.userId, t.at)],
);

export type StoredChatTurn = {
  question: string;
  answer: string;
  sources: { n: number; docName: string; unit: 'page' | 'section'; page: number }[];
  via: string;
  at: number;
};

/** A chat-with-pdf conversation: questions, answers and page citations. Never the document. */
export const chatConversation = pgTable(
  'chat_conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** SHA-256 fingerprint of the document set, computed on the device. */
    docKey: text('doc_key').notNull(),
    title: text('title').notNull(),
    turns: jsonb('turns').$type<StoredChatTurn[]>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('chat_conversation_user_doc_idx').on(t.userId, t.docKey)],
);

/* ------------------------------------------------ anonymous analytics */

/**
 * Raw usage events, kept for a few days and then rolled up into
 * analytics_daily. No IP address, no user-agent string, no user id.
 */
export const analyticsEvent = pgTable(
  'analytics_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: ts('at').notNull().defaultNow(),
    day: date('day', { mode: 'string' }).notNull(),
    /** Salted hash that changes every day; the salt is deleted the next day. */
    visitor: text('visitor').notNull(),
    type: text('type').notNull(),
    path: text('path'),
    tool: text('tool'),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms'),
    sizeBucket: text('size_bucket'),
    browser: text('browser').notNull(),
    os: text('os').notNull(),
    device: text('device').notNull(),
    country: text('country'),
    referrer: text('referrer'),
  },
  (t) => [index('analytics_event_day_idx').on(t.day)],
);

/** Today's random salt for visitor hashes. Older salts are deleted. */
export const analyticsSalt = pgTable('analytics_salt', {
  day: date('day', { mode: 'string' }).primaryKey(),
  salt: text('salt').notNull(),
});

/** Daily aggregates: one row per (day, kind, key, sub). */
export const analyticsDaily = pgTable(
  'analytics_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    key: text('key').notNull().default(''),
    sub: text('sub').notNull().default(''),
    count: integer('count').notNull().default(0),
    visitors: integer('visitors').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.kind, t.key, t.sub] }), index('analytics_daily_kind_day_idx').on(t.kind, t.day)],
);

/** Days that have been rolled up, and when. */
export const analyticsRollup = pgTable('analytics_rollup', {
  day: date('day', { mode: 'string' }).primaryKey(),
  rolledAt: ts('rolled_at').notNull().defaultNow(),
  events: integer('events').notNull().default(0),
});
