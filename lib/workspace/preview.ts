import { WorkspaceFile } from "../types";
import * as fs from "./fs";

/**
 * Assembles a self-contained, render-ready HTML document from a workspace file
 * and its sibling assets, so an .html file in the sandbox can be previewed with
 * its real CSS, scripts, and images — none of which live on a server the iframe
 * could fetch from. We rewrite local references to point at inlined content:
 *
 *   <link href="style.css">          → <style>…</style>
 *   <script src="app.js">            → <script>…</script>
 *   <img src="logo.png">             → src="data:…;base64,…"  (if present as data)
 *   url(bg.png) inside CSS           → url(data:…)            (best-effort)
 *
 * Absolute URLs (http://, https://, //, data:) are left untouched. References to
 * files that don't exist in the workspace are left as-is (they'll simply not
 * load, exactly as they wouldn't in a static export). This is a pragmatic
 * preview, not a full bundler — it covers the common cases an agent produces.
 */

const ABSOLUTE_RE = /^(?:[a-z]+:)?\/\//i;

function isAbsolute(url: string): boolean {
  return ABSOLUTE_RE.test(url) || url.startsWith("data:") || url.startsWith("#");
}

/** Resolve a possibly-relative href against the HTML file's directory. */
function resolveAsset(
  files: WorkspaceFile[],
  htmlPath: string,
  ref: string
): WorkspaceFile | undefined {
  const clean = ref.split("?")[0].split("#")[0].trim();
  if (!clean) return undefined;
  const dir = fs.parentPath(htmlPath);
  const joined = clean.startsWith("/")
    ? clean
    : `${dir === "/" ? "" : dir}/${clean}`;
  return fs.findNode(files, fs.normalizePath(joined));
}

/** Guess a MIME type from a file extension for data: URLs. */
function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "css":
      return "text/css";
    case "js":
      return "text/javascript";
    case "json":
      return "application/json";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    default:
      return "text/plain";
  }
}

/** Turn a workspace file into a data: URL (text files become utf-8 data URLs). */
function toDataUrl(file: WorkspaceFile): string {
  const mime = mimeFor(file.path);
  // SVG and other text assets: inline as URI-encoded utf-8 (handles emoji etc).
  if (mime.startsWith("image/svg") || mime.startsWith("text/")) {
    return `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
  }
  // Binary-ish content isn't really stored (the FS is text), so fall back to
  // utf-8 too; in practice agents reference text assets in previews.
  return `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
}

/** Inline url(...) references inside a stylesheet against the html dir. */
function inlineCssUrls(
  css: string,
  files: WorkspaceFile[],
  htmlPath: string
): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, ref) => {
    if (isAbsolute(ref)) return m;
    const asset = resolveAsset(files, htmlPath, ref);
    if (!asset) return m;
    return `url(${toDataUrl(asset)})`;
  });
}

export interface PreviewResult {
  /** The assembled HTML, ready to drop into an iframe srcDoc. */
  html: string;
  /** Asset references that couldn't be resolved in the workspace. */
  missing: string[];
}

/** Build a render-ready document for an HTML file in the workspace. */
export function assembleHtmlPreview(
  files: WorkspaceFile[],
  htmlPath: string
): PreviewResult {
  const node = fs.findNode(files, htmlPath);
  let html = node?.content ?? "";
  const missing: string[] = [];

  // <link rel="stylesheet" href="...">  →  inline <style>
  html = html.replace(
    /<link\b[^>]*?href\s*=\s*(['"])(.*?)\1[^>]*?>/gi,
    (tag, _q, href) => {
      if (!/stylesheet/i.test(tag) && !/\.css(\?|#|$)/i.test(href)) return tag;
      if (isAbsolute(href)) return tag;
      const asset = resolveAsset(files, htmlPath, href);
      if (!asset) {
        missing.push(href);
        return tag;
      }
      const css = inlineCssUrls(asset.content, files, htmlPath);
      return `<style data-from="${href}">\n${css}\n</style>`;
    }
  );

  // <script src="..."></script>  →  inline <script>…</script>
  html = html.replace(
    /<script\b([^>]*?)\ssrc\s*=\s*(['"])(.*?)\2([^>]*)>\s*<\/script>/gi,
    (tag, pre, _q, src, post) => {
      if (isAbsolute(src)) return tag;
      const asset = resolveAsset(files, htmlPath, src);
      if (!asset) {
        missing.push(src);
        return tag;
      }
      const attrs = `${pre}${post}`.replace(/\s*\bsrc\s*=\s*(['"]).*?\1/i, "");
      return `<script${attrs} data-from="${src}">\n${asset.content}\n</script>`;
    }
  );

  // src="..." on <img>/<source> etc.  →  data: URL when the asset exists
  html = html.replace(
    /(<(?:img|source|audio|video)\b[^>]*?\ssrc\s*=\s*)(['"])(.*?)\2/gi,
    (m, head, q, src) => {
      if (isAbsolute(src)) return m;
      const asset = resolveAsset(files, htmlPath, src);
      if (!asset) {
        missing.push(src);
        return m;
      }
      return `${head}${q}${toDataUrl(asset)}${q}`;
    }
  );

  // Inline any <style> blocks' url(...) too (for embedded CSS).
  html = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, css, close) =>
      `${open}${inlineCssUrls(css, files, htmlPath)}${close}`
  );

  return { html, missing: [...new Set(missing)] };
}

/** Which preview, if any, a file path supports. */
export type PreviewKind = "html" | "markdown" | "svg" | null;

export function previewKindFor(path: string): PreviewKind {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "svg") return "svg";
  return null;
}
