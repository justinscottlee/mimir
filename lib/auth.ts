import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { user, session, account, verification } from "./db/schema";
import { valkey } from "./cache";

/**
 * Social / OAuth providers, registered only when their credentials are present
 * in the environment. Keeping this conditional means a default install (no
 * OAuth app configured) still boots cleanly with email + password only, while
 * setting GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET lights up "Continue with
 * Google" with no code change. Better Auth links an OAuth identity to the
 * `account` table (which already carries the access/refresh/id-token columns),
 * so social and password accounts coexist for the same user row.
 *
 * The sign-in screen learns which providers are live from /api/auth-config
 * (see socialProvidersConfigured), so a button is only shown when it will work.
 */
function buildSocialProviders() {
  const providers: NonNullable<
    Parameters<typeof betterAuth>[0]["socialProviders"]
  > = {};

  const googleId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (googleId && googleSecret) {
    providers.google = { clientId: googleId, clientSecret: googleSecret };
  }

  return providers;
}

const socialProviders = buildSocialProviders();

/** Which social providers are configured — surfaced to the sign-in UI. */
export function socialProvidersConfigured(): { google: boolean } {
  return { google: Boolean(socialProviders.google) };
}

/**
 * Better Auth configuration.
 *
 * - Storage: Postgres via the Drizzle adapter (the user/session/account/
 *   verification tables in lib/db/schema.ts).
 * - Secondary storage: Valkey, which keeps session lookups and rate-limit
 *   counters hot without a Postgres round-trip on every authenticated request.
 * - Auth method: email + password, plus any OAuth providers configured via
 *   environment variables (see buildSocialProviders). Sign-ups can be turned
 *   off by setting ALLOW_SIGNUP=false once you've created your own account,
 *   leaving a single-tenant install that still requires a login.
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

  socialProviders,

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
