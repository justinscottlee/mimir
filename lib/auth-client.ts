"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Client-side Better Auth handle. Components use these to sign in / up / out and
 * to read the current session reactively (useSession). baseURL is inferred from
 * the current origin in the browser, so it works in dev and prod without config.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
