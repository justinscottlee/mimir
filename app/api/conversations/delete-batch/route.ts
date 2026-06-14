import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { deleteConversations } from "@/lib/server/state";

export const dynamic = "force-dynamic";

/** Delete several conversations at once (the Conversations window's Select mode). */
export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    const { ids } = (await req.json()) as { ids: string[] };
    await deleteConversations(u.id, Array.isArray(ids) ? ids : []);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
