import "server-only";

/**
 * Small helpers shared by the web-facing API routes (`/api/websearch`,
 * `/api/webfetch`). These used to be copy-pasted in each route; collecting them
 * here keeps one definition of integer clamping and the dependency-free
 * HTML→text extraction so the two routes can't drift apart.
 */

/** Round and clamp a possibly-bogus number into [min, max] (min on NaN). */
export function clampInt(v: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Ensure a base URL ends in a slash so `new URL(path, base)` resolves cleanly. */
export function ensureSlash(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}

/** Strip all HTML tags, leaving a space where each tag was. */
export function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function safeFromCode(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Decode the common named + numeric HTML entities to plain characters. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (_, d) => safeFromCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCode(parseInt(h, 16)));
}

/** Pull the document <title>, decoded and length-capped. */
export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(stripTags(m[1])).trim().slice(0, 200) : "";
}

/** Reduce an HTML document to readable plain text (dependency-free). */
export function htmlToText(html: string): string {
  let s = html;
  // Drop whole non-content regions outright.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Turn block-level boundaries into newlines so paragraphs survive.
  s = s.replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Strip everything else.
  s = stripTags(s);
  s = decodeEntities(s);
  // Collapse runs of blank lines and trailing spaces.
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
