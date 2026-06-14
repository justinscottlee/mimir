import { requireUser, jsonError } from "@/lib/server/session";
import { getUserState } from "@/lib/server/state";

// Always run on the server, never statically cached.
export const dynamic = "force-dynamic";

/** Returns the signed-in user's full workbench snapshot (seeds on first call). */
export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    const username = u.name?.trim() || u.email.split("@")[0] || "admin";
    const state = await getUserState(u.id, username);
    return Response.json(state);
  } catch (err) {
    return jsonError(err);
  }
}
