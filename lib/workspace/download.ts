"use client";

import { WorkspaceFile } from "../types";
import * as fs from "./fs";

/**
 * Client-side zipping of a workspace's virtual filesystem, with no third-party
 * dependency. The files live in the store (not on a server we can stream from),
 * so we build the archive in the browser and hand the user a download.
 *
 * We write the ZIP format directly: a local header + data per entry, a central
 * directory, and an end-of-central-directory record. Entry data is compressed
 * with the browser's built-in `CompressionStream("deflate-raw")` when available
 * (that's exactly the raw DEFLATE stream ZIP's method 8 expects) and stored
 * uncompressed otherwise, so it works everywhere without bundling a zip library.
 *
 * Used both for "download the whole workspace" and for zipping a single
 * directory subtree from the file explorer's context menu.
 */

/* ------------------------------ ZIP plumbing ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Raw DEFLATE via the platform, or null if unsupported (then we store). */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (
    data.length === 0 ||
    typeof (globalThis as { CompressionStream?: unknown }).CompressionStream ===
      "undefined"
  ) {
    return null;
  }
  try {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    void writer.write(data as unknown as BufferSource);
    void writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function pushU16(out: number[], v: number) {
  out.push(v & 0xff, (v >>> 8) & 0xff);
}
function pushU32(out: number[], v: number) {
  out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}
function pushBytes(out: number[], b: Uint8Array) {
  for (let i = 0; i < b.length; i++) out.push(b[i]);
}

/** MS-DOS time/date packing for ZIP entries. */
function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date =
    (((Math.max(1980, d.getFullYear()) - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

interface ZipEntry {
  /** Archive path with forward slashes; directories end with "/". */
  name: string;
  /** Uncompressed bytes (empty for directories). */
  data: Uint8Array;
}

async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const local: number[] = [];
  const central: number[] = [];

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    let method = 0; // store
    let payload = data;
    const deflated = await deflateRaw(data);
    if (deflated && deflated.length < data.length) {
      method = 8; // deflate
      payload = deflated;
    }

    const offset = local.length;

    // Local file header (flag bit 11 = UTF-8 names).
    pushU32(local, 0x04034b50);
    pushU16(local, 20);
    pushU16(local, 0x0800);
    pushU16(local, method);
    pushU16(local, time);
    pushU16(local, date);
    pushU32(local, crc);
    pushU32(local, payload.length);
    pushU32(local, data.length);
    pushU16(local, nameBytes.length);
    pushU16(local, 0);
    pushBytes(local, nameBytes);
    pushBytes(local, payload);

    // Central directory record for this entry.
    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, 0x0800);
    pushU16(central, method);
    pushU16(central, time);
    pushU16(central, date);
    pushU32(central, crc);
    pushU32(central, payload.length);
    pushU32(central, data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0); // extra
    pushU16(central, 0); // comment
    pushU16(central, 0); // disk number
    pushU16(central, 0); // internal attrs
    // External attrs: mark directory entries with the directory bit.
    pushU32(central, entry.name.endsWith("/") ? 0x10 : 0);
    pushU32(central, offset);
    pushBytes(central, nameBytes);
  }

  const cdOffset = local.length;
  const cdSize = central.length;
  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0);
  pushU16(eocd, 0);
  pushU16(eocd, entries.length);
  pushU16(eocd, entries.length);
  pushU32(eocd, cdSize);
  pushU32(eocd, cdOffset);
  pushU16(eocd, 0);

  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return new Blob([out], { type: "application/zip" });
}

/* ------------------------------ public API ------------------------------- */

/** Trigger a browser download of a Blob under the given filename. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke a tick later so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Build a zip of the files at or under `root` ("/" for the whole workspace) and
 * download it. Paths inside the zip are made relative to `root` so unzipping
 * yields the subtree itself rather than a chain of empty parent folders. Empty
 * directories are preserved.
 */
export async function downloadWorkspaceZip(
  files: WorkspaceFile[],
  root: string,
  zipName: string
): Promise<void> {
  const enc = new TextEncoder();
  const base = fs.normalizePath(root);
  const prefix = base === "/" ? "/" : base + "/";

  const entries: ZipEntry[] = [];
  for (const f of files) {
    if (f.path === "/") continue;
    // Only include nodes within the requested subtree.
    if (base !== "/" && f.path !== base && !f.path.startsWith(prefix)) continue;

    // Relative path inside the archive.
    let rel: string;
    if (base === "/") {
      rel = f.path.replace(/^\//, "");
    } else if (f.path === base) {
      // The root directory itself is represented by its contents; skip the node.
      continue;
    } else {
      rel = f.path.slice(prefix.length);
    }
    if (!rel) continue;

    if (f.type === "dir") {
      entries.push({
        name: rel.endsWith("/") ? rel : rel + "/",
        data: new Uint8Array(0),
      });
    } else {
      entries.push({ name: rel, data: enc.encode(f.content) });
    }
  }

  const blob = await buildZip(entries);
  saveBlob(blob, zipName);
}

/** A filesystem-safe zip filename for a directory (or the whole workspace). */
export function zipNameFor(path: string, workspaceName: string): string {
  const safeWs =
    workspaceName.trim().replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "workspace";
  if (fs.normalizePath(path) === "/") return `${safeWs}.zip`;
  const base = fs.baseName(path) || "files";
  return `${safeWs}-${base}.zip`;
}
