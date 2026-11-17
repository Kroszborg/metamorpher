import 'server-only';
import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { hasDatabase, serverConfig } from '../config';
import * as schema from './schema';

export { schema };
export type Db = NeonHttpDatabase<typeof schema>;

type Holder = { db?: Promise<Db | null> };
// One connection per server process. Next.js can evaluate this module more
// than once in development (route handlers and pages), so the handle lives on
// globalThis; PGlite in particular must only be opened once.
const holder: Holder = ((globalThis as { __metamorpherDb?: Holder }).__metamorpherDb ??= {});

async function connect(): Promise<Db | null> {
  if (serverConfig.databaseUrl) {
    return drizzle({ client: neon(serverConfig.databaseUrl), schema });
  }
  if (process.env.NODE_ENV === 'development') {
    // Local fallback: an embedded Postgres (PGlite) in .data/, migrated on first use.
    const { openPglite } = await import('./pglite');
    return (await openPglite(schema)) as unknown as Db;
  }
  return null;
}

/**
 * The database, or null when none is configured (production without
 * DATABASE_URL). Callers must handle null by switching the feature off.
 */
export function getDb(): Promise<Db | null> {
  if (!hasDatabase) return Promise.resolve(null);
  if (!holder.db) {
    holder.db = connect().catch((err: unknown) => {
      holder.db = undefined;
      throw err;
    });
  }
  return holder.db;
}
