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
      { error: "No endpoint configured. Set one in Settings." },
      { status: 400 }
    );
  }

  let target: URL;
  try {
    // Hosted APIs (Groq, OpenAI, …) include /v1 in their base URL, but all
    // internal fetch calls go through /api/llama/v1/... — strip the leading
    // v1 segment when the base already ends with it to avoid /v1/v1/models.
    const basePath = new URL(ensureSlash(base)).pathname.replace(/\/+$/, "");
    const segments =
      basePath.endsWith("/v1") && path[0] === "v1" ? path.slice(1) : path;

    target = new URL(segments.join("/") + req.nextUrl.search, ensureSlash(base));
  } catch {
    return Response.json(
      { error: `"${base}" is not a valid URL.` },
      { status: 400 }
    );
  }

  // Hosted APIs (Groq, OpenAI, Anthropic, …) need a bearer token; local
  // llama.cpp doesn't. The key rides in a separate header so it never lands
  // in a URL or a log.
  const apiKey = req.headers.get("x-llama-key");
  const outHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) outHeaders["Authorization"] = `Bearer ${apiKey}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: outHeaders,
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
      { error: `Could not reach ${base}. Is the server running and reachable?` },
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
