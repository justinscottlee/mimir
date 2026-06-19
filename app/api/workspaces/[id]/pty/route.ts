import { requireUser, jsonOk, jsonError } from "@/lib/server/session";
import {
  userOwnsWorkspace,
  getWorkspaceSandboxOverride,
} from "@/lib/server/state";
import { sandbox } from "@/lib/server/sandbox";
import { WorkspaceFile } from "@/lib/types";

/**
 * Interactive terminal for a workspace, backed by a real TTY shell in the
 * workspace's sandbox container.
 *
 *   POST { action: "open", cols, rows, files }  → { ptyId }   (also syncs files in)
 *   GET  ?ptyId=…                                → SSE stream of output
 *   POST { action: "input",  ptyId, data }       → write bytes (base64) to stdin
 *   POST { action: "resize", ptyId, cols, rows } → resize the TTY
 *   POST { action: "close",  ptyId, files }      → close + sync files back → { files }
 *
 * Output is server→client over Server-Sent Events (one long-lived GET); input
 * and control are client→server over short POSTs. Output chunks are base64 so
 * arbitrary terminal bytes (control codes, partial UTF-8) survive SSE framing.
 * Auth + ownership are enforced on every call.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser(req);
  } catch (err) {
    return jsonError(err);
  }
  if (!(await userOwnsWorkspace(user.id, params.id))) {
    return Response.json({ error: "Workspace not found." }, { status: 404 });
  }

  const ptyId = new URL(req.url).searchParams.get("ptyId") || "";
  if (!ptyId) {
    return Response.json({ error: "ptyId is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let detach: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          /* controller closed */
        }
      };

      const attached = sandbox.attachPty(ptyId, (chunk: Buffer) => {
        if (chunk.length > 0) send("out", chunk.toString("base64"));
        // A zero-length chunk is the manager's "stream ended" wake-up.
        if (!sandbox.hasPty(ptyId)) {
          send("exit", "");
          cleanup();
        }
      });

      if (!attached.ok) {
        send("exit", "");
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        return;
      }
      detach = attached.detach;
      if (attached.closed) {
        send("exit", "");
        cleanup();
        return;
      }

      // Periodic comment keeps proxies from buffering/closing the stream and
      // lets us notice when the shell has exited.
      heartbeat = setInterval(() => {
        if (!sandbox.hasPty(ptyId)) {
          send("exit", "");
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);

      function cleanup() {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        detach();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      detach();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const u = await requireUser(req);
    if (!(await userOwnsWorkspace(u.id, params.id))) {
      return Response.json({ error: "Workspace not found." }, { status: 404 });
    }

    const body = (await req.json()) as {
      action?: string;
      ptyId?: string;
      data?: string;
      cols?: number;
      rows?: number;
      files?: WorkspaceFile[];
    };
    const action = body.action ?? "";

    if (action === "open") {
      const files = Array.isArray(body.files) ? body.files : [];
      const override = await getWorkspaceSandboxOverride(u.id, params.id);
      const { ptyId } = await sandbox.openPty(params.id, files, {
        cols: clampDim(body.cols, 80),
        rows: clampDim(body.rows, 24),
        override,
      });
      return jsonOk({ ptyId });
    }

    if (action === "input") {
      if (!body.ptyId || typeof body.data !== "string") {
        return Response.json({ error: "ptyId and data are required." }, { status: 400 });
      }
      const ok = sandbox.writePty(body.ptyId, Buffer.from(body.data, "base64"));
      return jsonOk({ ok });
    }

    if (action === "resize") {
      if (!body.ptyId) {
        return Response.json({ error: "ptyId is required." }, { status: 400 });
      }
      const ok = await sandbox.resizePty(
        body.ptyId,
        clampDim(body.cols, 80),
        clampDim(body.rows, 24)
      );
      return jsonOk({ ok });
    }

    if (action === "close") {
      if (!body.ptyId) {
        return Response.json({ error: "ptyId is required." }, { status: 400 });
      }
      const files = Array.isArray(body.files) ? body.files : [];
      const result = await sandbox.closePty(body.ptyId, files);
      return jsonOk(result);
    }

    return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (err) {
    return jsonError(err);
  }
}

function clampDim(v: number | undefined, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(400, Math.max(1, n));
}
