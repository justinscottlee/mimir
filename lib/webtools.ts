import { ToolHandler } from "./tools";
import { WebFetchConfig, WebSearchConfig } from "./types";

/**
 * Global web-search throttle. Searches are serialized through a single promise
 * chain and spaced at least `minMs` apart, across every conversation and agent,
 * so a self-hosted search engine is less likely to rate-limit or captcha-block
 * you. The state is module-level on purpose: it must span all callers.
 */
let searchLock: Promise<void> = Promise.resolve();
let nextSearchAllowedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Waits for this search's turn given the configured minimum interval. Chaining
 * off `searchLock` serializes concurrent callers so each gets its own slot,
 * spaced `minMs` apart, rather than all firing at once.
 */
async function awaitSearchSlot(minMs: number): Promise<void> {
  if (!minMs || minMs <= 0) return;
  const mine = searchLock.then(async () => {
    const now = Date.now();
    const start = Math.max(now, nextSearchAllowedAt);
    nextSearchAllowedAt = start + minMs;
    const wait = start - now;
    if (wait > 0) await sleep(wait);
  });
  // Swallow errors on the shared chain so one failure can't wedge the gate.
  searchLock = mine.catch(() => {});
  await mine;
}


/**
 * The two web tools that give the model reach beyond its training data:
 *
 *   web_search — turns a query into ranked results (title/url/snippet) from a
 *                self-hosted SearXNG instance. Discovery only: snippets, not
 *                full pages.
 *   web_fetch  — downloads one URL and returns its readable text, so the model
 *                can actually read a result (or any link the user pasted).
 *
 * Both are intercepted by Mimir exactly like `remember`: the model only emits
 * an intent, Mimir performs the network call (server-side, via /api/websearch
 * and /api/webfetch), and the result is fed back through the tool loop. Like
 * every other tool this is just a registry entry — the loop is unchanged.
 *
 * Privacy note: the only thing that leaves the machine is the search query (to
 * your SearXNG, which you also host) and the URL the model chooses to fetch.
 * Both are visible in the inline tool chip, so every outbound call is auditable.
 */

/** Detailed when/how-to-use guidance, in the same spirit as the remember tool. */
const WEB_SEARCH_DESCRIPTION =
  "Search the web and get back a ranked list of results (title, URL, and a short snippet for each). Use this to reach information that is outside your training data or that may have changed since then — you do NOT have live knowledge of the world, so reach for this whenever fresh or external facts would make your answer correct instead of guessed.\n" +
  "\n" +
  "CALL THIS when:\n" +
  "- The question involves current or recent events, prices, releases, versions, schedules, or anything time-sensitive ('latest', 'current', 'today', 'this year').\n" +
  "- You are asked about a specific named product, library, person, company, paper, or API whose details you are not certain are current.\n" +
  "- You are unsure of a fact and a quick lookup would let you answer correctly rather than from memory.\n" +
  "- The user explicitly asks you to look something up, search, or 'check online'.\n" +
  "\n" +
  "HOW to use it well:\n" +
  "- Write a focused keyword query, not a full sentence. Prefer 2–6 specific terms ('Next.js 15 release date', not 'when was the latest version of Next.js released').\n" +
  "- If the first results are thin or off-target, search again with different terms rather than giving up.\n" +
  "- The snippets are previews only. When you need the actual content of a promising result — exact figures, quotes, steps, or detail the snippet cuts off — call web_fetch on its URL to read the page.\n" +
  "- Cite or link the sources you used so the user can verify them.\n" +
  "\n" +
  "DO NOT call this for:\n" +
  "- Stable knowledge you already hold confidently (basic math, definitions, well-known history, how to write ordinary code).\n" +
  "- Things only the user can know (their private files, their local state) — searching the public web won't help.\n" +
  "- Re-running a near-identical query you just ran; refine it instead.";

const WEB_FETCH_DESCRIPTION =
  "Fetch a single web page and return its readable text. Use this to read the full content of a page when a snippet isn't enough — most often a promising result from web_search, or a URL the user pasted and asked about.\n" +
  "\n" +
  "CALL THIS when:\n" +
  "- A web_search result looks like it holds the answer and you need the actual page text (exact numbers, quotes, full instructions, detail the snippet truncates).\n" +
  "- The user gives you a URL and asks you to read, summarize, or extract from it.\n" +
  "- You need to follow a link from a page you already fetched to get the real detail.\n" +
  "\n" +
  "HOW to use it well:\n" +
  "- Pass one complete, absolute URL including the scheme (https://…). Don't pass search-result titles or partial URLs.\n" +
  "- Prefer fetching the most authoritative or specific result rather than many pages; read one, and only fetch another if it falls short.\n" +
  "- The returned text is extracted and may be truncated; if the part you need seems cut off, say so rather than inventing the rest.\n" +
  "\n" +
  "DO NOT call this for:\n" +
  "- URLs you haven't actually seen (don't guess at addresses) — search first to find the real link.\n" +
  "- Non-web resources, file downloads, or anything that isn't an http/https page.";

/**
 * Builds the web_search registry entry. The handler POSTs to /api/websearch,
 * which forwards to SearXNG, then formats the results into text for the model.
 */
export function webSearchTool(config: WebSearchConfig): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "web_search",
        description: WEB_SEARCH_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "The search query. Use focused keywords (2–6 terms), not a full natural-language question.",
            },
            time_range: {
              type: "string",
              enum: ["day", "week", "month", "year"],
              description:
                "Optional. Restrict results to a recent window — use it for fast-moving or 'latest' topics. Omit for general queries.",
            },
          },
          required: ["query"],
        },
      },
    },
    run: async (args) => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return "Error: a non-empty 'query' is required.";
      const timeRange =
        typeof args.time_range === "string" ? args.time_range : undefined;

      // Throttle: hold here until this search's spaced-out slot, so we don't
      // hammer the search engine into rate-limiting or captcha-blocking us.
      await awaitSearchSlot(config.throttleMs ?? 0);

      const res = await fetch("/api/websearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          maxResults: config.maxResults,
          safeSearch: config.safeSearch,
          timeRange,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return `Error: ${data.error ?? `search failed (${res.status}).`}`;
      }

      const results: {
        title: string;
        url: string;
        snippet: string;
        engine?: string;
        publishedDate?: string;
      }[] = data.results ?? [];
      const answers: string[] = data.answers ?? [];

      if (results.length === 0 && answers.length === 0) {
        return `No results for "${query}". Try different or broader keywords.`;
      }

      const lines: string[] = [`Search results for "${query}":`];
      if (answers.length > 0) {
        lines.push("", "Direct answer(s):");
        for (const a of answers) lines.push(`- ${a}`);
      }
      lines.push("");
      results.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}`);
        lines.push(`   ${r.url}`);
        // Attribute the source engine and date when SearXNG reports them, so
        // the model can weigh and cite results.
        const meta = [
          r.engine ? `via ${r.engine}` : "",
          r.publishedDate ? `published ${r.publishedDate}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        if (meta) lines.push(`   (${meta})`);
        if (r.snippet) lines.push(`   ${r.snippet}`);
        lines.push("");
      });
      lines.push(
        "To read any result in full, call web_fetch with its URL. Cite the sources you use."
      );
      return lines.join("\n").trim();
    },
  };
}

/**
 * Builds the web_fetch registry entry. The handler POSTs to /api/webfetch,
 * which downloads the URL and extracts readable text.
 */
export function webFetchTool(config: WebFetchConfig): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "web_fetch",
        description: WEB_FETCH_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description:
                "The complete absolute URL to fetch, including https://. Usually a URL returned by web_search or one the user provided.",
            },
          },
          required: ["url"],
        },
      },
    },
    run: async (args) => {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!url) return "Error: a 'url' is required.";

      const res = await fetch("/api/webfetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, maxChars: config.maxChars }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return `Error: ${data.error ?? `fetch failed (${res.status}).`}`;
      }

      const header = data.title
        ? `Content of ${data.url} — "${data.title}":`
        : `Content of ${data.url}:`;
      const footer = data.truncated
        ? "\n\n(Content was truncated to fit. If you need more, say so rather than guessing the rest.)"
        : "";
      return `${header}\n\n${data.text ?? ""}${footer}`.trim();
    },
  };
}
