"use client";

import * as fs from "./fs";

/**
 * Turns dropped/selected files — including .zip archives and whole folders —
 * into workspace filesystem nodes the store can absorb. The workspace FS lives
 * in the browser/store, not on a server we could POST an upload to, so all of
 * this happens client-side: we read each File's bytes, decide text vs binary
 * (binary is kept as base64, matching the rest of the FS), expand any zip with
 * the platform's `DecompressionStream`, and return normalized nodes rooted at a
 * destination directory.
 *
 * No third-party zip dependency: we parse the ZIP central directory directly
 * and inflate `deflate`d entries with `DecompressionStream("deflate-raw")` (the
 * mirror of the writer in download.ts), falling back to stored entries.
 */

/* --------------------------------- caps ---------------------------------- */

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per file
const MAX_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MB per upload
const MAX_FILES = 2000;

/* ------------------------------- node shape ------------------------------ */

export interface UploadNode {
  path: string;
  type: "file" | "dir";
  content: string;
  encoding?: "utf8" | "base64";
}

export interface UploadOutcome {
  nodes: UploadNode[];
  skipped: { name: string; reason: string }[];
}

interface NamedFile {
  file: File;
  /** Path relative to the drop, e.g. "src/main.py" or just "logo.png". */
  rel: string;
}

/* ------------------------------ byte helpers ----------------------------- */

/** Encode raw bytes to base64 in chunks (avoids arg-count limits on btoa). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decode bytes as UTF-8 text, or return null if they aren't valid text. */
function tryDecodeText(bytes: Uint8Array): string | null {
  // A NUL byte is a strong binary signal; bail before attempting to decode.
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Turn raw bytes into an FS payload: utf8 text when possible, else base64. */
function payloadFromBytes(bytes: Uint8Array): {
  content: string;
  encoding: "utf8" | "base64";
} {
  const text = tryDecodeText(bytes);
  if (text != null) return { content: text, encoding: "utf8" };
  return { content: bytesToBase64(bytes), encoding: "base64" };
}

/* ------------------------------ path joining ----------------------------- */

function joinUnder(destDir: string, rel: string): string {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const base = fs.normalizePath(destDir);
  return fs.normalizePath(`${base === "/" ? "" : base}/${clean}`);
}

/* ------------------------------- ZIP reader ------------------------------ */

interface ZipItem {
  name: string;
  bytes: Uint8Array;
  isDir: boolean;
}

/** Raw INFLATE via the platform, or null if unsupported. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (
    typeof (globalThis as { DecompressionStream?: unknown })
      .DecompressionStream === "undefined"
  ) {
    return null;
  }
  try {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    void writer.write(data as unknown as BufferSource);
    void writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Parse a ZIP archive into its entries by walking the central directory. Sizes
 * and the compression method come from the central directory (reliable even
 * when local headers use data descriptors).
 */
async function unzip(buf: Uint8Array): Promise<ZipItem[]> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);

  // Locate the End Of Central Directory record (scan back over any comment).
  const maxBack = Math.min(buf.length, 22 + 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a valid zip (no end-of-central-directory)");

  const count = u16(eocd + 10);
  let p = u32(eocd + 16); // central directory offset
  const items: ZipItem[] = [];

  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) break; // central file header signature
    const method = u16(p + 10);
    const compSize = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const localOffset = u32(p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));

    // Jump to the local header to find where the data actually starts (its
    // name/extra lengths can differ from the central record's).
    if (u32(localOffset) === 0x04034b50) {
      const lNameLen = u16(localOffset + 26);
      const lExtraLen = u16(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const isDir = name.endsWith("/");
      let bytes: Uint8Array = new Uint8Array(0);
      if (!isDir && compSize > 0) {
        const raw = buf.subarray(dataStart, dataStart + compSize);
        if (method === 0) {
          bytes = raw.slice();
        } else if (method === 8) {
          const inflated = await inflateRaw(raw);
          bytes = inflated ?? raw.slice();
        } else {
          // Unsupported method — skip the body, keep the (empty) entry out.
          bytes = new Uint8Array(0);
        }
      }
      items.push({ name, bytes, isDir });
    }

    p += 46 + nameLen + extraLen + commentLen;
  }
  return items;
}

/* --------------------------- DataTransfer walk --------------------------- */

/**
 * Collect dropped files with their relative paths, descending into folders when
 * the browser exposes the entries API; otherwise fall back to the flat list.
 */
export async function namedFilesFromDataTransfer(
  dt: DataTransfer
): Promise<NamedFile[]> {
  const items = dt.items;
  const canTraverse =
    items &&
    items.length > 0 &&
    typeof (items[0] as unknown as { webkitGetAsEntry?: unknown })
      .webkitGetAsEntry === "function";

  if (!canTraverse) {
    return Array.from(dt.files).map((file) => ({ file, rel: file.name }));
  }

  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = (
      items[i] as unknown as { webkitGetAsEntry(): FileSystemEntry | null }
    ).webkitGetAsEntry();
    if (entry) entries.push(entry);
  }

  const out: NamedFile[] = [];
  for (const entry of entries) await walkEntry(entry, "", out);
  return out;
}

function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: NamedFile[]
): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => {
        out.push({ file, rel: prefix + entry.name });
        resolve();
      }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (batch.length === 0) {
            // Drain children sequentially, then resolve.
            (async () => {
              for (const child of all) {
                await walkEntry(child, prefix + entry.name + "/", out);
              }
              resolve();
            })();
          } else {
            all.push(...batch);
            readBatch();
          }
        }, () => resolve());
      };
      readBatch();
    } else {
      resolve();
    }
  });
}

/* ------------------------------- builders -------------------------------- */

async function build(
  inputs: NamedFile[],
  destDir: string
): Promise<UploadOutcome> {
  const byPath = new Map<string, UploadNode>();
  const skipped: { name: string; reason: string }[] = [];
  let total = 0;

  const addNode = (node: UploadNode, displayName: string): boolean => {
    const size =
      node.encoding === "base64"
        ? fs.base64ByteLength(node.content)
        : node.content.length;
    if (node.type === "file") {
      if (size > MAX_FILE_BYTES) {
        skipped.push({ name: displayName, reason: "larger than 8 MB" });
        return true;
      }
      if (byPath.size >= MAX_FILES) {
        skipped.push({ name: displayName, reason: "too many files" });
        return true;
      }
      if (total + size > MAX_TOTAL_BYTES) {
        skipped.push({ name: displayName, reason: "upload over 64 MB" });
        return false; // stop — budget exhausted
      }
      total += size;
    }
    byPath.set(node.path, node);
    return true;
  };

  for (const { file, rel } of inputs) {
    const isZip =
      /\.zip$/i.test(file.name) ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

    if (isZip) {
      // Expand the archive's contents directly under destDir.
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const items = await unzip(buf);
        for (const item of items) {
          const path = joinUnder(destDir, item.name);
          if (path === "/") continue;
          if (item.isDir) {
            if (!byPath.has(path))
              byPath.set(path, { path, type: "dir", content: "" });
            continue;
          }
          const { content, encoding } = payloadFromBytes(item.bytes);
          const node: UploadNode = {
            path,
            type: "file",
            content,
            encoding: encoding === "base64" ? "base64" : undefined,
          };
          if (!addNode(node, item.name)) break;
        }
      } catch {
        skipped.push({ name: file.name, reason: "couldn't read zip" });
      }
      continue;
    }

    // A plain file.
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { content, encoding } = payloadFromBytes(bytes);
      const path = joinUnder(destDir, rel);
      if (path === "/") continue;
      const node: UploadNode = {
        path,
        type: "file",
        content,
        encoding: encoding === "base64" ? "base64" : undefined,
      };
      if (!addNode(node, file.name)) break;
    } catch {
      skipped.push({ name: file.name, reason: "couldn't read file" });
    }
  }

  return { nodes: [...byPath.values()], skipped };
}

/** Build upload nodes from a drag-and-drop DataTransfer. */
export async function buildUploadFromDataTransfer(
  dt: DataTransfer,
  destDir: string
): Promise<UploadOutcome> {
  const named = await namedFilesFromDataTransfer(dt);
  return build(named, destDir);
}

/** Build upload nodes from an <input type="file"> selection. */
export async function buildUploadFromFiles(
  files: FileList | File[],
  destDir: string
): Promise<UploadOutcome> {
  const named: NamedFile[] = Array.from(files).map((file) => ({
    file,
    // <input webkitdirectory> sets webkitRelativePath; otherwise just the name.
    rel:
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name,
  }));
  return build(named, destDir);
}
