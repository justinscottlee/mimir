import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { upsertImageStudio, deleteImageStudios } from "@/lib/server/state";
import { ImageStudio } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Upsert a whole image studio (metadata + full image gallery). */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const u = await requireUser(req);
    const body = (await req.json()) as ImageStudio;
    await upsertImageStudio(u.id, { ...body, id: params.id });
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
    await deleteImageStudios(u.id, [params.id]);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
