import { NextRequest } from "next/server";
import { clampInt, extractTitle, htmlToText } from "@/lib/server/http";

/**
 * Downloads a single URL server-side and returns its readable text. Search
 * results are only snippets; when the model needs the actual content of a page
 * it calls web_fetch, which lands here. Doing the fetch server-side avoids CORS
 * and keeps the browser talking only to Mimir.
 *
 * Extraction is deliberately dependency-free: strip scripts/styles, drop tags,
 * decode the common entities, collapse whitespace, cap the length. It won't
 * rival a full readability pass, but it's enough for a model to read a page.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { url?: string; maxChars?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const rawUrl = (body.url ?? "").trim();
  if (!rawUrl) {
    return Response.json({ error: "A 'url' is required." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return Response.json({ error: `"${rawUrl}" is not a valid URL.` }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return Response.json(
      { error: "Only http and https URLs can be fetched." },
      { status: 400 }
    );
  }

  const maxChars = clampInt(body.maxChars ?? 8000, 500, 50000);

  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; Mimir/0.1; +self-hosted AI workbench)",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return Response.json(
        { error: `The page responded ${upstream.status}.` },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const isText =
      contentType.includes("text/") ||
      contentType.includes("application/xhtml") ||
      contentType.includes("application/json") ||
      contentType.includes("application/xml");
    if (!isText) {
      return Response.json(
        {
          url: target.toString(),
          title: "",
          text: `(Skipped: the URL returned non-text content of type "${
            contentType || "unknown"
          }", which web_fetch cannot read.)`,
          truncated: false,
        },
        { status: 200 }
      );
    }

    const html = await upstream.text();
    const title = extractTitle(html);
    const full = htmlToText(html);
    const truncated = full.length > maxChars;
    const text = truncated ? full.slice(0, maxChars) : full;

    return Response.json({ url: target.toString(), title, text, truncated });
  } catch (e) {
    const msg =
      (e as Error).name === "TimeoutError"
        ? "The page timed out."
        : `Could not fetch ${target.toString()}.`;
    return Response.json({ error: msg }, { status: 502 });
  }
}
