import { requireUser, jsonOk, jsonError } from "@/lib/server/session";
import { userOwnsWorkspace } from "@/lib/server/state";
import { sandbox } from "@/lib/server/sandbox";
import { WorkspaceFile } from "@/lib/types";

/**
 * Runs a shell command inside the workspace's execution sandbox (a per-workspace
 * Docker container). The browser POSTs the command plus the current virtual
 * filesystem; this route writes those files into the container, runs the
 * command, and returns its output along with the post-run filesystem so the
 * store stays in sync. Auth + ownership are enforced — a user can only execute
 * against their own workspace.
 *
 *   GET    → sandbox status (configured? Docker reachable?)
 *   POST   → run a command
 *   DELETE → reset (stop + remove) the workspace's container
 */

export const dynamic = "force-dynamic";
// Container ops and pulls can take a while; don't let the platform time us out.
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const status = await sandbox.status();
    return jsonOk(status);
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const u = await requireUser(req);
    if (!(await userOwnsWorkspace(u.id, params.id))) {
      return Response.json({ error: "Workspace not found." }, { status: 404 });
    }

    const body = (await req.json()) as {
      command?: string;
      files?: WorkspaceFile[];
    };
    const command = (body.command ?? "").trim();
    if (!command) {
      return Response.json(
        { error: "A non-empty 'command' is required." },
        { status: 400 }
      );
    }
    const files = Array.isArray(body.files) ? body.files : [];

    const { result, files: updated } = await sandbox.exec(
      params.id,
      command,
      files
    );
    return jsonOk({ result, files: updated });
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
    if (!(await userOwnsWorkspace(u.id, params.id))) {
      return Response.json({ error: "Workspace not found." }, { status: 404 });
    }
    await sandbox.reset(params.id);
    return jsonOk();
  } catch (err) {
    return jsonError(err);
  }
}
