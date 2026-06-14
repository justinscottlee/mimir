import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Mounts every Better Auth endpoint under /api/auth/* (sign-in, sign-up,
 * sign-out, get-session, …). The client in lib/auth-client.ts talks to these.
 */
export const { GET, POST } = toNextJsHandler(auth);
