import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config. Migrations are generated from `lib/db/schema.ts` into
 * `drizzle/` and applied with `npm run db:migrate` (or pushed directly in dev
 * with `npm run db:push`).
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mimir:mimir@localhost:5432/mimir",
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
