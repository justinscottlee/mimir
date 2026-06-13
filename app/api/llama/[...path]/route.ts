import { NextRequest } from "next/server";

/**
 * Proxies /api/llama/<path> to the llama.cpp server named in the
 * `x-llama-base` header (set client-side from Settings). Streaming bodies
 * pass straight through, so SSE token streams work unchanged.
 */

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, path: string[]) {
  const base = req.headers.get("x-llama-base");
  if (!base) {
    return Response.json(
      { error: "No llama.cpp endpoint configured. Set one in Settings." },
      { status: 400 }
    );
  }

  let target: URL;
  try {
    target = new URL(path.join("/") + req.nextUrl.search, ensureSlash(base));
  } catch {
    return Response.json(
      { error: `"${base}" is not a valid URL.` },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // @ts-expect-error - duplex is required by undici for streaming bodies
      duplex: "half",
      cache: "no-store",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return Response.json(
      { error: `Could not reach ${base}. Is the llama.cpp server running?` },
      { status: 502 }
    );
  }
}

function ensureSlash(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params.path);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy(req, params.path);
}
