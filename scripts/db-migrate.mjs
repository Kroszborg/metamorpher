// Applies the SQL migrations in /drizzle.
//
//   DATABASE_URL=postgres://… npm run db:migrate   -> Neon (or any Postgres reachable by Neon's driver)
//   npm run db:migrate                             -> the local development database in .data/pglite
//
// Reads DATABASE_URL from the environment, then from .env.local / .env (never prints it).
// The local PGlite database can only be opened by one process: stop `npm run dev` first
// (the dev server also applies migrations to it automatically on start).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = path.join(root, 'drizzle');

function fromEnvFiles(name) {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(root, file);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`, 'm'));
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const url = process.env.DATABASE_URL || fromEnvFiles('DATABASE_URL');

if (url) {
  const { Pool } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  const { migrate } = await import('drizzle-orm/neon-serverless/migrator');
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
    console.log(`Migrations applied to ${new URL(url).host}.`);
  } finally {
    await pool.end();
  }
} else {
  const dir = path.join(root, '.data', 'pglite');
  mkdirSync(dir, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(dir);
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
    console.log('Migrations applied to the local PGlite database (.data/pglite).');
  } finally {
    await client.close();
  }
}
