import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { upsertConversation, deleteConversations } from "@/lib/server/state";
import { Conversation } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Upsert a whole conversation (metadata + full message list). */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const u = await requireUser(req);
    const body = (await req.json()) as Conversation;
    await upsertConversation(u.id, { ...body, id: params.id });
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const u = await requireUser(req);
    await deleteConversations(u.id, [params.id]);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
