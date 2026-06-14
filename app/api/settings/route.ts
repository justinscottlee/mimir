import { requireUser, jsonError, jsonOk } from "@/lib/server/session";
import { saveSettings } from "@/lib/server/state";
import { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Replace the user's settings blob (endpoints, defaults, username, tools). */
export async function PUT(req: Request) {
  try {
    const u = await requireUser(req);
    const body = (await req.json()) as Settings;
    await saveSettings(u.id, body);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
