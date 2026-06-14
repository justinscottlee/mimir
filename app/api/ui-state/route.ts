import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { saveUiState } from "@/lib/server/state";
import { UserUiState } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Replace the user's UI layout (tabs, active tab, floating windows, z-stack). */
export async function PUT(req: Request) {
  try {
    const u = await requireUser(req);
    const body = (await req.json()) as UserUiState;
    await saveUiState(u.id, body);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
