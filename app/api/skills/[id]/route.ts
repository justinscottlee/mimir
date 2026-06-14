import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { upsertSkill, deleteSkill } from "@/lib/server/state";
import { Skill } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const u = await requireUser(req);
    const body = (await req.json()) as Skill;
    await upsertSkill(u.id, { ...body, id: params.id });
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
    await deleteSkill(u.id, params.id);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
