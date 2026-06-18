import { WorkspaceFile } from "../types";

/**
 * Pure operations over a workspace's virtual filesystem — a flat array of
 * `WorkspaceFile` nodes keyed by a normalized POSIX path. Nothing here touches
 * the store, the network, or the host: every function takes the current file
 * list and returns a new one (immutably), so the same logic powers the
 * filesystem tool the agent calls, the file-explorer UI, and the system-prompt
 * manifest. Keeping it pure also means it can be lifted onto a real container
 * backend later by reimplementing just the tool handlers, not this module.
 *
 * Paths are always normalized to a rooted, slash-separated form with no
 * trailing slash ("/" for the root, "/src/main.py" for a file). Directories are
 * explicit nodes (type "dir"); writing a file auto-creates its ancestors.
 */

/* ------------------------------ path helpers ----------------------------- */

/** Normalize any user/model-supplied path to "/a/b/c" (root is "/"). */
export function normalizePath(input: string): string {
  const raw = (input ?? "").replace(/\\/g, "/").trim();
  const segments: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return "/" + segments.join("/");
}

/** The parent directory path of a node ("/" for top-level nodes and root). */
export function parentPath(path: string): string {
  const p = normalizePath(path);
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

/** The final path segment ("main.py", or "" for the root). */
export function baseName(path: string): string {
  const p = normalizePath(path);
  if (p === "/") return "";
  return p.slice(p.lastIndexOf("/") + 1);
}

/** All ancestor directory paths of a node, root-first, excluding root and self. */
export function ancestorDirs(path: string): string[] {
  const p = normalizePath(path);
  if (p === "/") return [];
  const parts = p.split("/").filter(Boolean);
  const out: string[] = [];
  let acc = "";
  // Every segment except the last is an ancestor directory.
  for (let i = 0; i < parts.length - 1; i++) {
    acc += "/" + parts[i];
    out.push(acc);
  }
  return out;
}

/* ------------------------------- lookups -------------------------------- */

export function findNode(
  files: WorkspaceFile[],
  path: string
): WorkspaceFile | undefined {
  const p = normalizePath(path);
  return files.find((f) => f.path === p);
}

export function isDir(files: WorkspaceFile[], path: string): boolean {
  const node = findNode(files, path);
  return !!node && node.type === "dir";
}

/** Immediate children of a directory path (one level down only). */
export function listDir(
  files: WorkspaceFile[],
  path: string
): WorkspaceFile[] {
  const dir = normalizePath(path);
  const prefix = dir === "/" ? "/" : dir + "/";
  return files
    .filter((f) => {
      if (f.path === dir) return false;
      if (!f.path.startsWith(prefix)) return false;
      const rest = f.path.slice(prefix.length);
      return rest.length > 0 && !rest.includes("/");
    })
    .sort(sortNodes);
}

/** A node plus every descendant (used for delete/move). */
export function subtree(files: WorkspaceFile[], path: string): WorkspaceFile[] {
  const p = normalizePath(path);
  const prefix = p === "/" ? "/" : p + "/";
  return files.filter((f) => f.path === p || f.path.startsWith(prefix));
}

/* ------------------------------ mutations ------------------------------- */

/** Ensure every ancestor directory of `path` exists, returning a new list. */
function withAncestorDirs(
  files: WorkspaceFile[],
  path: string,
  now: number
): WorkspaceFile[] {
  let out = files;
  for (const dir of ancestorDirs(path)) {
    if (!out.some((f) => f.path === dir)) {
      out = [
        ...out,
        { path: dir, type: "dir", content: "", createdAt: now, updatedAt: now },
      ];
    }
  }
  return out;
}

export interface WriteResult {
  files: WorkspaceFile[];
  created: boolean;
}

/** Create or overwrite a file, auto-creating parent directories. */
export function writeFile(
  files: WorkspaceFile[],
  path: string,
  content: string,
  now = Date.now()
): WriteResult {
  const p = normalizePath(path);
  if (p === "/") throw new Error("cannot write to the root path");
  const existing = findNode(files, p);
  if (existing && existing.type === "dir") {
    throw new Error(`"${p}" is a directory, not a file`);
  }
  let out = withAncestorDirs(files, p, now);
  if (existing) {
    out = out.map((f) =>
      f.path === p ? { ...f, content, updatedAt: now } : f
    );
    return { files: out, created: false };
  }
  out = [
    ...out,
    { path: p, type: "file", content, createdAt: now, updatedAt: now },
  ];
  return { files: out, created: true };
}

/** Create a directory (and its ancestors). No-op if it already exists. */
export function makeDir(
  files: WorkspaceFile[],
  path: string,
  now = Date.now()
): WorkspaceFile[] {
  const p = normalizePath(path);
  if (p === "/") return files;
  const existing = findNode(files, p);
  if (existing) {
    if (existing.type === "file") {
      throw new Error(`"${p}" already exists as a file`);
    }
    return files;
  }
  const out = withAncestorDirs(files, p, now);
  return [
    ...out,
    { path: p, type: "dir", content: "", createdAt: now, updatedAt: now },
  ];
}

export interface DeleteResult {
  files: WorkspaceFile[];
  removed: number;
}

/** Remove a node and all of its descendants. */
export function deletePath(
  files: WorkspaceFile[],
  path: string
): DeleteResult {
  const p = normalizePath(path);
  if (p === "/") throw new Error("cannot delete the root path");
  if (!findNode(files, p)) {
    throw new Error(`no such path: "${p}"`);
  }
  const doomed = new Set(subtree(files, p).map((f) => f.path));
  const out = files.filter((f) => !doomed.has(f.path));
  return { files: out, removed: doomed.size };
}

export interface MoveResult {
  files: WorkspaceFile[];
  moved: number;
}

/** Rename/move a node (and its descendants) from one path to another. */
export function movePath(
  files: WorkspaceFile[],
  from: string,
  to: string,
  now = Date.now()
): MoveResult {
  const src = normalizePath(from);
  const dst = normalizePath(to);
  if (src === "/") throw new Error("cannot move the root path");
  if (dst === "/") throw new Error("cannot move onto the root path");
  if (!findNode(files, src)) throw new Error(`no such path: "${src}"`);
  if (dst === src) return { files, moved: 0 };
  if (dst.startsWith(src + "/")) {
    throw new Error("cannot move a path into itself");
  }
  if (findNode(files, dst)) {
    throw new Error(`destination "${dst}" already exists`);
  }

  const moving = subtree(files, src);
  const movingPaths = new Set(moving.map((f) => f.path));
  const remapped: WorkspaceFile[] = moving.map((f) => ({
    ...f,
    path: dst + f.path.slice(src.length),
    updatedAt: now,
  }));
  let out = files.filter((f) => !movingPaths.has(f.path));
  out = withAncestorDirs(out, dst, now);
  out = [...out, ...remapped];
  return { files: out, moved: moving.length };
}

/** Replace a unique substring inside a file (str-replace style edit). */
export function editFile(
  files: WorkspaceFile[],
  path: string,
  oldStr: string,
  newStr: string,
  now = Date.now()
): WorkspaceFile[] {
  const p = normalizePath(path);
  const node = findNode(files, p);
  if (!node) throw new Error(`no such file: "${p}"`);
  if (node.type === "dir") throw new Error(`"${p}" is a directory`);
  if (oldStr === "") throw new Error("old_str must not be empty");
  const occurrences = node.content.split(oldStr).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_str was not found in "${p}"`);
  }
  if (occurrences > 1) {
    throw new Error(
      `old_str matched ${occurrences} times in "${p}" — make it more specific so it matches exactly once`
    );
  }
  const content = node.content.replace(oldStr, newStr);
  return files.map((f) => (f.path === p ? { ...f, content, updatedAt: now } : f));
}

/* ------------------------------- rendering ------------------------------ */

function sortNodes(a: WorkspaceFile, b: WorkspaceFile): number {
  // Directories first, then files; alphabetical within each group.
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return baseName(a.path).localeCompare(baseName(b.path));
}

export function lineCount(content: string): number {
  if (content === "") return 0;
  return content.split("\n").length;
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function humanSize(content: string): string {
  return humanBytes(content.length);
}

/**
 * An indented tree rendering rooted at `root`, e.g.
 *   /
 *   ├─ src/
 *   │  ├─ main.py · 42 lines
 *   │  └─ utils.py · 12 lines
 *   └─ README.md · 3 lines
 * Used by the list_files tool result and the system-prompt manifest.
 */
export function renderTree(files: WorkspaceFile[], root = "/"): string {
  const start = normalizePath(root);
  const lines: string[] = [start === "/" ? "/" : baseName(start) + "/"];

  function walk(dir: string, prefix: string) {
    const children = listDir(files, dir);
    children.forEach((child, i) => {
      const last = i === children.length - 1;
      const branch = last ? "└─ " : "├─ ";
      const label =
        child.type === "dir"
          ? `${baseName(child.path)}/`
          : `${baseName(child.path)} · ${lineCount(child.content)} lines`;
      lines.push(prefix + branch + label);
      if (child.type === "dir") {
        walk(child.path, prefix + (last ? "   " : "│  "));
      }
    });
  }

  walk(start, "");
  return lines.join("\n");
}

/** Compact flat manifest for the system prompt: one line per file. */
export function flatManifest(files: WorkspaceFile[]): string {
  const fileNodes = [...files]
    .filter((f) => f.type === "file")
    .sort((a, b) => a.path.localeCompare(b.path));
  if (fileNodes.length === 0) return "(empty — no files yet)";
  return fileNodes
    .map((f) => `- ${f.path} (${lineCount(f.content)} lines, ${humanSize(f.content)})`)
    .join("\n");
}

export interface FsStats {
  files: number;
  dirs: number;
  bytes: number;
}

export function fsStats(files: WorkspaceFile[]): FsStats {
  let bytes = 0;
  let fileCount = 0;
  let dirCount = 0;
  for (const f of files) {
    if (f.type === "dir") dirCount++;
    else {
      fileCount++;
      bytes += f.content.length;
    }
  }
  return { files: fileCount, dirs: dirCount, bytes };
}
