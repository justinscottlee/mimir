import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { user, session, account, verification } from "./db/schema";
import { valkey } from "./cache";

/**
 * Better Auth configuration.
 *
 * - Storage: Postgres via the Drizzle adapter (the user/session/account/
 *   verification tables in lib/db/schema.ts).
 * - Secondary storage: Valkey, which keeps session lookups and rate-limit
 *   counters hot without a Postgres round-trip on every authenticated request.
 * - Auth method: email + password. Sign-ups can be turned off by setting
 *   ALLOW_SIGNUP=false once you've created your own account, leaving a
 *   single-tenant install that still requires a login.
 * - nextCookies() must stay last in the plugin list so cookies set during
 *   sign-in/up are forwarded correctly through the App Router.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    // No SMTP wired up by default, so don't block login on verification.
    requireEmailVerification: false,
    disableSignUp: process.env.ALLOW_SIGNUP === "false",
    minPasswordLength: 8,
  },

  secondaryStorage: {
    get: async (key) => {
      const v = await valkey.get(`mimir:auth:${key}`);
      return v ?? null;
    },
    set: async (key, value, ttl) => {
      const k = `mimir:auth:${key}`;
      if (ttl) await valkey.set(k, value, "EX", ttl);
      else await valkey.set(k, value);
    },
    delete: async (key) => {
      await valkey.del(`mimir:auth:${key}`);
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once a day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },

  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
