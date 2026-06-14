import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Single shared Postgres pool + Drizzle instance for the whole server.
 * In dev, Next.js hot-reload re-evaluates modules, so we stash the pool on globalThis
 * to avoid exhausting connections with a new pool per reload.
 */
const globalForDb = globalThis as unknown as {
  __mimirPool?: Pool;
};

const connectionString = process.env.DATABASE_URL ?? "postgres://mimir:mimir@localhost:5432/mimir";

export const pool =
  globalForDb.__mimirPool ??
  new Pool({
    connectionString,
    max: 10,
  });

// CRITICAL: a pg Pool emits an 'error' event when an *idle* pooled client is
// disconnected by the backend (Postgres restart, network blip, auth failure,
// idle timeout, etc.). Node's EventEmitter rethrows an 'error' that has no
// listener, which crashes the entire Next.js server process — manifesting as
// the dev server exiting the moment a request touches the DB.
// Attaching a listener turns that fatal event into a logged, recoverable one;
// the pool discards the dead client and the next query gets a fresh one.
if (!globalForDb.__mimirPool) {
  pool.on("error", (err) => {
    console.error("[db] idle client error (pool will recover):", err.message);
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForDb.__mimirPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
