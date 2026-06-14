import "server-only";
import { auth } from "@/lib/auth";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

/** Thrown by requireUser to short-circuit a handler with a JSON 401. */
export class Unauthorized extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "Unauthorized";
  }
}

/**
 * Resolves the signed-in user from the request's Better Auth session, or throws
 * Unauthorized. Route handlers wrap their body in try/catch and map Unauthorized
 * to a 401 (see jsonError).
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) throw new Unauthorized();
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

/** Standard JSON helpers for the state routes. */
export function jsonOk(data: unknown = { ok: true }): Response {
  return Response.json(data);
}

export function jsonError(err: unknown): Response {
  if (err instanceof Unauthorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const message = err instanceof Error ? err.message : "Server error";
  if (process.env.NODE_ENV !== "production") {
    console.error("[api] error:", err);
  }
  return Response.json({ error: message }, { status: 500 });
}
