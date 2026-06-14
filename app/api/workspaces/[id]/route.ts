import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { upsertWorkspace, deleteWorkspace } from "@/lib/server/state";
import { Workspace } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const u = await requireUser(req);
    const body = (await req.json()) as Workspace;
    await upsertWorkspace(u.id, { ...body, id: params.id });
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
    await deleteWorkspace(u.id, params.id);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
