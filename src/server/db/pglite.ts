import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/**
 * Development-only embedded Postgres stored in .data/pglite (gitignored).
 * Applies the migrations in /drizzle on open, so `npm run dev` works with no
 * database set up. Only one process can open the directory at a time.
 */
export async function openPglite<S extends Record<string, unknown>>(schema: S) {
  const dir = path.join(process.cwd(), '.data', 'pglite');
  await mkdir(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  return db;
}
