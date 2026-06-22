import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { deleteImageStudios } from "@/lib/server/state";

export const dynamic = "force-dynamic";

/** Delete several image studios at once (the Library's Select mode). */
export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    const { ids } = (await req.json()) as { ids: string[] };
    await deleteImageStudios(u.id, Array.isArray(ids) ? ids : []);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
