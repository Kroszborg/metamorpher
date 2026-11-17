import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` writes SQL migrations to /drizzle from the schema.
// `npm run db:migrate` applies them (scripts/db-migrate.mjs).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  strict: true,
});
