import { NextRequest } from "next/server";

/**
 * Runs a web search by forwarding the model's query to a self-hosted SearXNG
 * instance and returning the ranked results. The browser never talks to
 * SearXNG directly — it POSTs here, and this route makes the outbound call —
 * which sidesteps CORS and keeps the same "browser only talks to Mimir" shape
 * as the llama proxy.
 *
 * SearXNG must have the JSON format enabled (settings.yml → search.formats
 * includes `json`). The bundled searxng/config/settings.yml does this.
 */

export const dynamic = "force-dynamic";

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  publishedDate?: string | null;
}

const TIME_RANGES = new Set(["day", "week", "month", "year"]);

export async function POST(req: NextRequest) {
  let body: {
    query?: string;
    searxngUrl?: string;
    maxResults?: number;
    safeSearch?: number;
    timeRange?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return Response.json({ error: "A non-empty 'query' is required." }, { status: 400 });
  }

  // Resolve SearXNG from the server's own environment first. In compose this is
  // set to the internal service (http://searxng:8080), so search works with no
  // user configuration and a stale browser setting (e.g. localhost) can't break
  // it. Falls back to the URL the client sends when no env is set (host dev).
  const base = (process.env.SEARXNG_URL || body.searxngUrl || "").trim();
  if (!base) {
    return Response.json(
      {
        error:
          "No SearXNG URL configured. Set SEARXNG_URL on the server, or a URL in the Tools window.",
      },
      { status: 400 }
    );
  }

  const maxResults = clampInt(body.maxResults ?? 5, 1, 10);
  const safeSearch = clampInt(body.safeSearch ?? 1, 0, 2);

  let target: URL;
  try {
    target = new URL("/search", ensureSlash(base));
  } catch {
    return Response.json({ error: `"${base}" is not a valid URL.` }, { status: 400 });
  }
  target.searchParams.set("q", query);
  target.searchParams.set("format", "json");
  target.searchParams.set("safesearch", String(safeSearch));
  if (body.timeRange && TIME_RANGES.has(body.timeRange)) {
    target.searchParams.set("time_range", body.timeRange);
  }

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // SearXNG rejects requests without a normal-looking UA by default.
        "User-Agent": "Mimir/0.1 (+self-hosted)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      // 403 here almost always means the JSON format isn't enabled.
      const hint =
        upstream.status === 403
          ? " SearXNG refused the JSON request — make sure `json` is in search.formats in settings.yml, then restart it."
          : "";
      return Response.json(
        { error: `SearXNG responded ${upstream.status}.${hint}` },
        { status: 502 }
      );
    }

    const json = await upstream.json();
    const raw: SearxResult[] = Array.isArray(json.results) ? json.results : [];
    const results = raw
      .filter((r) => r.url && r.title)
      .slice(0, maxResults)
      .map((r) => ({
        title: r.title!.trim(),
        url: r.url!.trim(),
        snippet: (r.content ?? "").trim(),
        engine: r.engine,
        publishedDate: r.publishedDate ?? undefined,
      }));

    // Some queries (definitions, conversions) come back with a direct answer.
    const answers: string[] = Array.isArray(json.answers)
      ? json.answers.map((a: unknown) => String(a)).filter(Boolean)
      : [];

    return Response.json({ query, results, answers });
  } catch (e) {
    const msg =
      (e as Error).name === "TimeoutError"
        ? "SearXNG timed out."
        : `Could not reach SearXNG at ${base}. Is it running?`;
    return Response.json({ error: msg }, { status: 502 });
  }
}

function ensureSlash(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
