import "server-only";
import Valkey from "iovalkey";

/**
 * Valkey client (Redis protocol). Used for two things:
 *
 *  1. Application caching — the per-user state snapshot served by /api/state is
 *     cached here so repeat hydrations don't re-query Postgres. Any write to a
 *     user's data invalidates their snapshot key.
 *  2. Better Auth secondary storage — see lib/auth.ts, which uses this same
 *     client to keep sessions / rate-limit counters hot.
 *
 * The client is stashed on globalThis so Next.js hot-reload doesn't open a new
 * connection on every change.
 */
const globalForCache = globalThis as unknown as {
  __mimirValkey?: Valkey;
};

const url = process.env.VALKEY_URL ?? "redis://localhost:6379";

export const valkey: Valkey =
  globalForCache.__mimirValkey ??
  new Valkey(url, {
    // Fail fast instead of buffering forever if Valkey is down; callers treat
    // cache errors as a miss and fall back to Postgres.
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

// Avoid an unhandled 'error' event crashing the process when Valkey is briefly
// unreachable; reads/writes degrade to a cache miss instead.
valkey.on("error", (err: Error) => {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[valkey] connection error:", err.message);
  }
});

if (process.env.NODE_ENV !== "production") {
  globalForCache.__mimirValkey = valkey;
}

/** TTL for the per-user state snapshot, in seconds. */
const STATE_TTL_SECONDS = 60 * 30;

export function userStateKey(userId: string): string {
  return `mimir:state:${userId}`;
}

/** Reads and parses a JSON value, returning null on miss or any error. */
export async function cacheGetJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await valkey.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Stores a JSON value with the state TTL. Swallows errors (cache is best-effort). */
export async function cacheSetJSON(key: string, value: unknown): Promise<void> {
  try {
    await valkey.set(key, JSON.stringify(value), "EX", STATE_TTL_SECONDS);
  } catch {
    /* best-effort */
  }
}

/** Drops a cache key. Swallows errors. */
export async function cacheDel(key: string): Promise<void> {
  try {
    await valkey.del(key);
  } catch {
    /* best-effort */
  }
}

/** Invalidates a user's cached state snapshot after a write. */
export async function invalidateUserState(userId: string): Promise<void> {
  await cacheDel(userStateKey(userId));
}
