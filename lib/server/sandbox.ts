import "server-only";
import Docker from "dockerode";
import * as tar from "tar-stream";
import { Writable } from "node:stream";
import { WorkspaceExecResult, WorkspaceFile } from "@/lib/types";

/**
 * The execution sandbox: gives a workspace a real Linux container its agent (and
 * the user) can run shell commands inside. The virtual filesystem stays the
 * source of truth — before each command the store's files are written into the
 * container's /workspace, the command runs under strict limits, and any files it
 * created or changed are read back out and returned so the store stays in sync.
 *
 * One container is kept alive per workspace so state persists across commands
 * within a session (installed packages, a running venv, build artifacts), and an
 * idle reaper stops containers that go unused. Containers are hardened: no
 * network by default, dropped capabilities, no privilege escalation, and CPU /
 * memory / pid / time limits — but this runs model-written code on your host, so
 * the isolation is best-effort, not a security guarantee. See the README.
 *
 * The pure helpers (tar build/parse, file diffing, cap/ignore filtering) are
 * exported so they can be unit-tested without a Docker daemon.
 */

/* --------------------------------- config -------------------------------- */

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export interface SandboxConfig {
  enabled: boolean;
  image: string;
  network: string;
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
  readonlyRoot: boolean;
  user?: string;
  commandTimeoutMs: number;
  idleTimeoutMs: number;
  workdir: string;
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxOutputBytes: number;
}

export function loadSandboxConfig(): SandboxConfig {
  return {
    // Opt-out: the feature is on unless explicitly disabled.
    enabled: process.env.SANDBOX_ENABLED !== "false",
    image: process.env.SANDBOX_IMAGE || "python:3.12-slim",
    // "none" = no internet for executed code (safe default). Set "bridge" to
    // allow pip/npm installs, at the cost of isolation.
    network: process.env.SANDBOX_NETWORK || "none",
    memoryBytes: envInt("SANDBOX_MEMORY_MB", 512) * 1024 * 1024,
    nanoCpus: Math.round(Number(process.env.SANDBOX_CPUS || "1") * 1e9),
    pidsLimit: envInt("SANDBOX_PIDS", 256),
    // Writable root by default so `pip install` works out of the box.
    readonlyRoot: process.env.SANDBOX_READONLY_ROOT === "true",
    user: process.env.SANDBOX_USER || undefined,
    commandTimeoutMs: envInt("SANDBOX_TIMEOUT_MS", 30000),
    idleTimeoutMs: envInt("SANDBOX_IDLE_MS", 600000),
    workdir: "/workspace",
    maxFileBytes: envInt("SANDBOX_MAX_FILE_KB", 256) * 1024,
    maxFiles: envInt("SANDBOX_MAX_FILES", 2000),
    maxTotalBytes: envInt("SANDBOX_MAX_TOTAL_MB", 12) * 1024 * 1024,
    maxOutputBytes: envInt("SANDBOX_MAX_OUTPUT_KB", 256) * 1024,
  };
}

/** Directories never synced back into the store (heavy / machine-generated). */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "dist",
  "build",
  ".next",
  ".cache",
  "site-packages",
  ".tox",
  ".gradle",
  "target",
]);

function isIgnored(relPath: string): boolean {
  return relPath.split("/").some((seg) => IGNORE_DIRS.has(seg));
}

/**
 * Marker the command epilogue prints so we can recover the post-command working
 * directory (and the real exit code) from a fresh exec. Chosen to be vanishingly
 * unlikely to collide with real command output.
 */
const CWD_MARKER = "<<<MIMIR_CWD_7b3f:";
const CWD_MARKER_RE = /<<<MIMIR_CWD_7b3f:(\d+)\t([^\n]*)/g;

/** Single-quote a string for safe interpolation into a `sh -c` command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/* ------------------------------ pure helpers ----------------------------- */

export interface TarEntryInput {
  name: string; // relative path, no leading slash
  type: "file" | "dir";
  content?: string;
  /** "base64" content is decoded to its raw bytes before being packed. */
  encoding?: "utf8" | "base64";
}

/** Build a tar archive (Buffer) from workspace-relative entries. */
export function buildTar(entries: TarEntryInput[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];
    pack.on("data", (c: Buffer) => chunks.push(c));
    pack.on("end", () => resolve(Buffer.concat(chunks)));
    pack.on("error", reject);

    const add = (i: number) => {
      if (i >= entries.length) {
        pack.finalize();
        return;
      }
      const e = entries[i];
      if (e.type === "dir") {
        pack.entry({ name: e.name.replace(/\/?$/, "/"), type: "directory" }, (err) => {
          if (err) return reject(err);
          add(i + 1);
        });
      } else {
        // Decode binary (base64) nodes back to bytes; text goes in as UTF-8.
        const raw =
          e.encoding === "base64"
            ? Buffer.from(e.content ?? "", "base64")
            : Buffer.from(e.content ?? "", "utf-8");
        pack.entry({ name: e.name, size: raw.length }, raw, (err) => {
          if (err) return reject(err);
          add(i + 1);
        });
      }
    };
    add(0);
  });
}

export interface ParsedEntry {
  path: string; // normalized "/a/b", leading slash
  type: "file" | "dir";
  content: string;
  size: number;
  /** "base64" when the bytes weren't valid/clean text. */
  encoding: "utf8" | "base64";
}

/** Parse a tar archive coming back from the container's /workspace. */
export function parseTar(buf: Buffer): Promise<ParsedEntry[]> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const out: ParsedEntry[] = [];
    extract.on("entry", (header, stream, next) => {
      const bodyChunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => bodyChunks.push(c));
      stream.on("end", () => {
        // getArchive of "/workspace" prefixes entries with "workspace/".
        let rel = header.name.replace(/^workspace\/?/, "");
        rel = rel.replace(/\/$/, "");
        if (rel !== "") {
          const isDir = header.type === "directory";
          const raw = Buffer.concat(bodyChunks);
          // A NUL byte means it isn't text; keep it as base64 so binary files
          // (images, archives, compiled output) survive the round-trip.
          const binary = !isDir && raw.includes(0);
          const content = isDir
            ? ""
            : binary
              ? raw.toString("base64")
              : raw.toString("utf-8");
          out.push({
            path: "/" + rel,
            type: isDir ? "dir" : "file",
            content,
            size: isDir ? 0 : raw.length,
            encoding: binary ? "base64" : "utf8",
          });
        }
        next();
      });
      stream.on("error", reject);
      stream.resume();
    });
    extract.on("finish", () => resolve(out));
    extract.on("error", reject);
    extract.end(buf);
  });
}

export interface FilterResult {
  files: WorkspaceFile[];
  skipped: string[];
}

/**
 * Turn parsed container entries into a store filesystem, dropping ignored dirs
 * and anything past the size/count caps so the store stays sane. Binary files
 * are kept as base64 (within the size cap) rather than discarded.
 */
export function filterSyncedFiles(
  entries: ParsedEntry[],
  prev: WorkspaceFile[],
  cfg: SandboxConfig,
  now = Date.now()
): FilterResult {
  const prevByPath = new Map(prev.map((f) => [f.path, f]));
  const files: WorkspaceFile[] = [];
  const skipped: string[] = [];
  let total = 0;

  // Stable order so caps apply predictably.
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) {
    const rel = e.path.replace(/^\//, "");
    if (isIgnored(rel)) {
      if (e.type === "file") skipped.push(e.path);
      continue;
    }
    if (e.type === "dir") {
      files.push(makeNode(e.path, "dir", "", "utf8", prevByPath, now));
      continue;
    }
    if (e.size > cfg.maxFileBytes) {
      skipped.push(e.path);
      continue;
    }
    if (files.filter((f) => f.type === "file").length >= cfg.maxFiles) {
      skipped.push(e.path);
      continue;
    }
    if (total + e.size > cfg.maxTotalBytes) {
      skipped.push(e.path);
      continue;
    }
    total += e.size;
    files.push(makeNode(e.path, "file", e.content, e.encoding, prevByPath, now));
  }
  return { files, skipped };
}

function makeNode(
  path: string,
  type: "file" | "dir",
  content: string,
  encoding: "utf8" | "base64",
  prev: Map<string, WorkspaceFile>,
  now: number
): WorkspaceFile {
  // Keep utf8 implicit so text nodes stay clean.
  const enc = encoding === "base64" ? "base64" : undefined;
  const existing = prev.get(path);
  const unchanged =
    existing &&
    existing.content === content &&
    existing.type === type &&
    (existing.encoding ?? undefined) === enc;
  return {
    path,
    type,
    content,
    encoding: enc,
    createdAt: existing?.createdAt ?? now,
    updatedAt: unchanged ? existing!.updatedAt : now,
  };
}

export interface SyncPlan {
  toWrite: TarEntryInput[];
  toDelete: string[]; // relative paths, no leading slash
}

/**
 * Diff the store's files against what we last wrote into the container, so we
 * only push what changed and delete what the store removed. Never deletes
 * untracked container files (e.g. node_modules created by a command).
 */
export function diffFiles(
  current: WorkspaceFile[],
  lastSynced: Map<string, string>
): SyncPlan {
  const toWrite: TarEntryInput[] = [];
  const currentPaths = new Set<string>();

  for (const f of current) {
    if (f.path === "/") continue;
    const rel = f.path.replace(/^\//, "");
    currentPaths.add(rel);
    if (f.type === "dir") {
      if (!lastSynced.has(rel)) toWrite.push({ name: rel, type: "dir" });
    } else {
      const prev = lastSynced.get(rel);
      if (prev !== f.content) {
        toWrite.push({
          name: rel,
          type: "file",
          content: f.content,
          encoding: f.encoding,
        });
      }
    }
  }

  const toDelete: string[] = [];
  for (const rel of lastSynced.keys()) {
    if (!currentPaths.has(rel)) toDelete.push(rel);
  }
  return { toWrite, toDelete };
}

/* --------------------------- the manager itself -------------------------- */

/**
 * Per-workspace overrides for the otherwise-global sandbox config. Lets a single
 * workspace toggle internet access without changing the server defaults. The
 * toolchain image is intentionally *not* overridable — every container uses the
 * server-configured `SANDBOX_IMAGE`. Anything omitted falls back to the env
 * config.
 */
export interface SandboxOverride {
  network?: "none" | "bridge";
}

interface Session {
  containerId: string;
  lastUsed: number;
  lastSynced: Map<string, string>;
  /** Image + network the container was actually created with (for override changes). */
  image: string;
  network: string;
  /** Per-workspace serialization so the agent and terminal don't race. */
  queue: Promise<unknown>;
  /**
   * The working directory the next command starts in. Each `container.exec` is
   * an independent process, so a bare `cd` can't persist on its own — we track
   * the cwd here and re-apply it (and re-read it) around every command, which is
   * what makes `cd` actually work across commands.
   */
  cwd: string;
}

/**
 * A live interactive shell (a TTY-backed `container.exec`) for the terminal UI.
 * Output is fanned out to SSE subscribers; input bytes are written straight to
 * the hijacked duplex stream. A small ring buffer lets a subscriber that
 * attaches just after open still see the shell's opening prompt.
 */
interface PtySession {
  id: string;
  workspaceId: string;
  exec: Docker.Exec;
  stream: NodeJS.ReadWriteStream;
  /** Subscribers receive raw output chunks (Buffers) as they arrive. */
  subscribers: Set<(chunk: Buffer) => void>;
  /** Tail of recent output (capped) for late subscribers. */
  buffer: Buffer;
  closed: boolean;
  lastUsed: number;
}

/** How much recent PTY output to retain for a late-attaching subscriber. */
const PTY_BUFFER_CAP = 64 * 1024;

class SandboxManager {
  private docker = new Docker();
  private cfg = loadSandboxConfig();
  private sessions = new Map<string, Session>();
  private ptys = new Map<string, PtySession>();
  private reaper?: ReturnType<typeof setInterval>;

  config(): SandboxConfig {
    return this.cfg;
  }

  /**
   * Resolve the effective image + network for a run. The image is always the
   * server-configured default; only the network can be overridden per workspace
   * (restricted to the two supported modes).
   */
  private effective(override?: SandboxOverride): {
    image: string;
    network: string;
  } {
    const image = this.cfg.image;
    const network =
      override?.network === "bridge" || override?.network === "none"
        ? override.network
        : this.cfg.network;
    return { image, network };
  }

  /** Reports whether the sandbox is on and the Docker daemon is reachable. */
  async status(): Promise<{
    available: boolean;
    reason?: string;
    image: string;
    network: string;
  }> {
    const base = { image: this.cfg.image, network: this.cfg.network };
    if (!this.cfg.enabled) {
      return { available: false, reason: "Sandbox disabled (SANDBOX_ENABLED=false).", ...base };
    }
    try {
      await this.docker.ping();
      return { available: true, ...base };
    } catch (e) {
      return {
        available: false,
        reason: `Docker is not reachable: ${(e as Error).message}. Is the daemon running and the socket accessible to this process?`,
        ...base,
      };
    }
  }

  /** Run a command for a workspace, serialized per workspace. */
  async exec(
    workspaceId: string,
    command: string,
    files: WorkspaceFile[],
    override?: SandboxOverride
  ): Promise<{ result: WorkspaceExecResult; files: WorkspaceFile[] }> {
    if (!this.cfg.enabled) {
      throw new Error("The execution sandbox is disabled (SANDBOX_ENABLED=false).");
    }
    const session = this.sessions.get(workspaceId);
    const prior = session?.queue ?? Promise.resolve();
    const run = prior
      .catch(() => {})
      .then(() => this.execInner(workspaceId, command, files, override));
    // Update the queue tail regardless of outcome.
    const s = this.sessions.get(workspaceId);
    if (s) s.queue = run.catch(() => {});
    return run;
  }

  private async execInner(
    workspaceId: string,
    command: string,
    files: WorkspaceFile[],
    override?: SandboxOverride
  ): Promise<{ result: WorkspaceExecResult; files: WorkspaceFile[] }> {
    const container = await this.ensureContainer(workspaceId, override);
    const session = this.sessions.get(workspaceId)!;
    session.lastUsed = Date.now();

    // 1. Sync store → container (only what changed).
    const plan = diffFiles(files, session.lastSynced);
    if (plan.toDelete.length > 0) {
      await this.runRaw(container, [
        "sh",
        "-c",
        "cd /workspace 2>/dev/null && rm -rf -- " +
          plan.toDelete.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" "),
      ]).catch(() => {});
    }
    if (plan.toWrite.length > 0) {
      const archive = await buildTar(plan.toWrite);
      await container.putArchive(archive, { path: this.cfg.workdir });
    }

    // 2. Run the command under a hard timeout (coreutils `timeout`), capturing
    //    stdout/stderr separately. We wrap it so it starts in the session's
    //    tracked cwd and reports the cwd it ends in — this is what makes `cd`
    //    persist across commands even though each exec is a fresh process. The
    //    real exit code is captured before the trailing marker (which always
    //    exits 0) and parsed back out, and the marker line is stripped from the
    //    output the caller sees.
    const timeoutSecs = Math.max(1, Math.round(this.cfg.commandTimeoutMs / 1000));
    const cwd = session.cwd || this.cfg.workdir;
    const wd = this.cfg.workdir;
    const wrapped =
      `cd ${shellQuote(cwd)} 2>/dev/null || cd ${shellQuote(wd)}\n` +
      `${command}\n` +
      `__mimir_ec=$?\n` +
      `printf '\\n${CWD_MARKER}%s\\t%s\\n' "$__mimir_ec" "$(pwd)"\n`;
    const started = Date.now();
    const raw = await this.runCommand(container, [
      "timeout",
      "-k",
      "2",
      String(timeoutSecs),
      "sh",
      "-c",
      wrapped,
    ]);
    const durationMs = Date.now() - started;

    // Pull the cwd marker (if the command ran to the epilogue) out of stdout.
    let stdout = raw.stdout;
    let exitCode = raw.exitCode;
    const markerMatch = [...stdout.matchAll(CWD_MARKER_RE)].pop();
    if (markerMatch) {
      const ec = Number(markerMatch[1]);
      if (Number.isFinite(ec)) exitCode = ec;
      const newCwd = markerMatch[2]?.trim();
      if (newCwd) session.cwd = newCwd;
      // Remove the injected marker line (and the newline we prefixed it with).
      stdout = stdout.slice(0, markerMatch.index).replace(/\n$/, "");
    }
    const stderr = raw.stderr;
    const truncated = raw.truncated;
    const timedOut = exitCode === 124 || exitCode === 137;

    // 3. Sync container → store (capture created/modified/deleted files).
    let synced: WorkspaceFile[] = files;
    let skipped: string[] = [];
    try {
      const out = await container.getArchive({ path: this.cfg.workdir });
      const buf = await streamToBuffer(out as unknown as NodeJS.ReadableStream);
      const entries = await parseTar(buf);
      const filtered = filterSyncedFiles(entries, files, this.cfg);
      synced = filtered.files;
      skipped = filtered.skipped;
      session.lastSynced = new Map(
        // Track every synced node so the next diff only pushes real changes;
        // directories map to "" (content-less), files to their content.
        synced.map((f) => [
          f.path.replace(/^\//, ""),
          f.type === "dir" ? "" : f.content,
        ])
      );
    } catch {
      // If reading back fails, keep the input files; the command still ran.
    }

    const result: WorkspaceExecResult = {
      command,
      stdout,
      stderr,
      exitCode: timedOut ? null : exitCode,
      timedOut,
      durationMs,
      truncated: truncated || undefined,
      skippedFiles: skipped.length ? skipped : undefined,
      cwd: session.cwd,
    };
    return { result, files: synced };
  }

  /** Stop and remove a workspace's container (a clean-slate reset). */
  async reset(workspaceId: string): Promise<void> {
    // Tear down any interactive shells pointed at this workspace first.
    for (const [id, p] of this.ptys) {
      if (p.workspaceId === workspaceId) {
        this.ptys.delete(id);
        try {
          p.stream.end();
        } catch {
          /* ignore */
        }
      }
    }
    const session = this.sessions.get(workspaceId);
    this.sessions.delete(workspaceId);
    if (!session) {
      // Also catch a container left over from a previous process.
      await this.removeByLabel(workspaceId).catch(() => {});
      return;
    }
    await this.forceRemove(session.containerId).catch(() => {});
  }

  /* ------------------------------ interactive PTY ----------------------- */

  /**
   * Open a real interactive shell in the workspace container and return a pty
   * id. The current files are synced in first so the shell sees them. Output is
   * delivered to subscribers via `attachPty`; input via `writePty`.
   */
  async openPty(
    workspaceId: string,
    files: WorkspaceFile[],
    opts: { cols?: number; rows?: number; override?: SandboxOverride } = {}
  ): Promise<{ ptyId: string }> {
    if (!this.cfg.enabled) {
      throw new Error("The execution sandbox is disabled (SANDBOX_ENABLED=false).");
    }
    const container = await this.ensureContainer(workspaceId, opts.override);
    const session = this.sessions.get(workspaceId)!;
    session.lastUsed = Date.now();

    // Sync the store's files into the container so the shell starts with them.
    try {
      const plan = diffFiles(files, session.lastSynced);
      if (plan.toDelete.length > 0) {
        await this.runRaw(container, [
          "sh",
          "-c",
          "cd /workspace 2>/dev/null && rm -rf -- " +
            plan.toDelete.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" "),
        ]).catch(() => {});
      }
      if (plan.toWrite.length > 0) {
        const archive = await buildTar(plan.toWrite);
        await container.putArchive(archive, { path: this.cfg.workdir });
      }
      session.lastSynced = new Map(
        files
          .filter((f) => f.path !== "/")
          .map((f) => [
            f.path.replace(/^\//, ""),
            f.type === "dir" ? "" : f.content,
          ])
      );
    } catch {
      /* a sync hiccup shouldn't stop the shell from opening */
    }

    const exec = await container.exec({
      // Prefer an interactive bash, falling back to sh on minimal images.
      //
      // IMPORTANT: do not redirect the interactive shell's stderr. Interactive
      // bash writes its prompt (PS1) and all readline line-editing to *stderr*,
      // so `bash -i 2>/dev/null` produces a live-but-invisible shell (no prompt,
      // no echo of edits) — which looks like a broken/empty terminal. We only
      // silence the existence *check*, then exec the chosen shell with its
      // stderr still wired to the PTY so the prompt shows.
      Cmd: [
        "/bin/sh",
        "-c",
        "if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh -i; fi",
      ],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      WorkingDir: session.cwd || this.cfg.workdir,
      User: this.cfg.user,
      Env: ["TERM=xterm-256color", "PAGER=cat", "GIT_PAGER=cat"],
    });

    const stream = (await exec.start({
      hijack: true,
      stdin: true,
    })) as unknown as NodeJS.ReadWriteStream;

    const id = `pty_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const pty: PtySession = {
      id,
      workspaceId,
      exec,
      stream,
      subscribers: new Set(),
      buffer: Buffer.alloc(0),
      closed: false,
      lastUsed: Date.now(),
    };
    this.ptys.set(id, pty);

    stream.on("data", (chunk: Buffer) => {
      pty.lastUsed = Date.now();
      // Keep a capped tail for late subscribers.
      pty.buffer = Buffer.concat([pty.buffer, chunk]);
      if (pty.buffer.length > PTY_BUFFER_CAP) {
        pty.buffer = pty.buffer.subarray(pty.buffer.length - PTY_BUFFER_CAP);
      }
      for (const fn of pty.subscribers) {
        try {
          fn(chunk);
        } catch {
          /* a broken subscriber shouldn't kill the stream */
        }
      }
    });
    const finish = () => {
      pty.closed = true;
      for (const fn of pty.subscribers) {
        try {
          fn(Buffer.alloc(0)); // wake subscribers so they can notice `closed`
        } catch {
          /* ignore */
        }
      }
    };
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);

    // Best-effort initial size.
    if (opts.cols && opts.rows) {
      await exec.resize({ h: opts.rows, w: opts.cols }).catch(() => {});
    }

    this.startReaper();
    return { ptyId: id };
  }

  /** Subscribe to a pty's output. Replays the recent buffer, returns a detacher. */
  attachPty(
    ptyId: string,
    onChunk: (chunk: Buffer) => void
  ): { ok: boolean; closed: boolean; detach: () => void } {
    const pty = this.ptys.get(ptyId);
    if (!pty) return { ok: false, closed: true, detach: () => {} };
    pty.lastUsed = Date.now();
    if (pty.buffer.length > 0) {
      try {
        onChunk(pty.buffer);
      } catch {
        /* ignore */
      }
    }
    pty.subscribers.add(onChunk);
    return {
      ok: true,
      closed: pty.closed,
      detach: () => pty.subscribers.delete(onChunk),
    };
  }

  /** Write input bytes to a pty's stdin. */
  writePty(ptyId: string, data: Buffer): boolean {
    const pty = this.ptys.get(ptyId);
    if (!pty || pty.closed) return false;
    pty.lastUsed = Date.now();
    try {
      pty.stream.write(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Resize a pty's terminal. */
  async resizePty(ptyId: string, cols: number, rows: number): Promise<boolean> {
    const pty = this.ptys.get(ptyId);
    if (!pty || pty.closed) return false;
    pty.lastUsed = Date.now();
    await pty.exec.resize({ h: rows, w: cols }).catch(() => {});
    return true;
  }

  /** Whether a pty id is still live. */
  hasPty(ptyId: string): boolean {
    const pty = this.ptys.get(ptyId);
    return !!pty && !pty.closed;
  }

  /**
   * Close a pty and sync the container's files back into the store. `files` is
   * the store's current view, used as the baseline for change detection.
   */
  async closePty(
    ptyId: string,
    files: WorkspaceFile[]
  ): Promise<{ files: WorkspaceFile[]; skipped?: string[] }> {
    const pty = this.ptys.get(ptyId);
    this.ptys.delete(ptyId);
    if (!pty) return { files };

    try {
      pty.stream.end();
    } catch {
      /* ignore */
    }
    pty.closed = true;

    // Sync the container's /workspace back into the store.
    const session = this.sessions.get(pty.workspaceId);
    if (!session) return { files };
    try {
      const container = this.docker.getContainer(session.containerId);
      const out = await container.getArchive({ path: this.cfg.workdir });
      const buf = await streamToBuffer(out as unknown as NodeJS.ReadableStream);
      const entries = await parseTar(buf);
      const filtered = filterSyncedFiles(entries, files, this.cfg);
      session.lastSynced = new Map(
        filtered.files.map((f) => [
          f.path.replace(/^\//, ""),
          f.type === "dir" ? "" : f.content,
        ])
      );
      return {
        files: filtered.files,
        skipped: filtered.skipped.length ? filtered.skipped : undefined,
      };
    } catch {
      return { files };
    }
  }

  private async ensureContainer(
    workspaceId: string,
    override?: SandboxOverride
  ): Promise<Docker.Container> {
    this.startReaper();
    const want = this.effective(override);

    const existing = this.sessions.get(workspaceId);
    if (existing) {
      const sameSpec =
        existing.image === want.image && existing.network === want.network;
      const c = this.docker.getContainer(existing.containerId);
      try {
        const info = await c.inspect();
        if (info.State.Running && sameSpec) return c;
        // The workspace switched image/network — tear the old container down so
        // the next one is created with the requested spec.
        if (info.State.Running && !sameSpec) {
          await this.forceRemove(existing.containerId).catch(() => {});
        }
      } catch {
        /* fall through and recreate */
      }
      this.sessions.delete(workspaceId);
    }

    // Reuse a still-running container from a previous process, but only if it
    // matches the requested image + network; otherwise replace it.
    const reused = await this.findRunningByLabel(workspaceId);
    if (reused) {
      let ok = true;
      try {
        const info = await this.docker.getContainer(reused.id).inspect();
        const netMode = info.HostConfig?.NetworkMode ?? "";
        const imageOk = info.Config?.Image === want.image;
        const netOk =
          want.network === "none"
            ? netMode === "none"
            : netMode === want.network;
        ok = imageOk && netOk;
      } catch {
        ok = false;
      }
      if (ok) {
        this.sessions.set(workspaceId, {
          containerId: reused.id,
          lastUsed: Date.now(),
          lastSynced: new Map(),
          image: want.image,
          network: want.network,
          queue: Promise.resolve(),
          cwd: this.cfg.workdir,
        });
        return this.docker.getContainer(reused.id);
      }
      await this.forceRemove(reused.id).catch(() => {});
    }

    const container = await this.createContainer(workspaceId, want);
    await container.start();
    this.sessions.set(workspaceId, {
      containerId: container.id,
      lastUsed: Date.now(),
      lastSynced: new Map(),
      image: want.image,
      network: want.network,
      queue: Promise.resolve(),
      cwd: this.cfg.workdir,
    });
    return container;
  }

  private async createContainer(
    workspaceId: string,
    spec: { image: string; network: string }
  ): Promise<Docker.Container> {
    const opts: Docker.ContainerCreateOptions = {
      name: `mimir-ws-${sanitize(workspaceId)}-${Date.now().toString(36)}`,
      Image: spec.image,
      Labels: { "mimir.workspace": workspaceId, "mimir.sandbox": "1" },
      Cmd: ["sleep", "infinity"],
      WorkingDir: this.cfg.workdir,
      User: this.cfg.user,
      Tty: false,
      NetworkDisabled: spec.network === "none",
      HostConfig: {
        Memory: this.cfg.memoryBytes,
        MemorySwap: this.cfg.memoryBytes, // disable swap (swap == memory)
        NanoCpus: this.cfg.nanoCpus,
        PidsLimit: this.cfg.pidsLimit,
        NetworkMode: spec.network,
        ReadonlyRootfs: this.cfg.readonlyRoot,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        // /workspace and /tmp must be writable even with a read-only root.
        Tmpfs: this.cfg.readonlyRoot
          ? { "/tmp": "rw,size=64m", [this.cfg.workdir]: "rw,size=256m" }
          : { "/tmp": "rw,size=64m" },
      },
    };

    try {
      return await this.docker.createContainer(opts);
    } catch (e) {
      // Image not present locally → pull once and retry. A locally-built image
      // (e.g. the bundled mimir-sandbox) won't be on a registry, so surface a
      // clear, actionable error instead of an opaque pull failure.
      if (/no such image|not found/i.test((e as Error).message)) {
        try {
          await this.pullImage(spec.image);
        } catch (pullErr) {
          throw new Error(
            `Sandbox image "${spec.image}" isn't available locally and couldn't be pulled (${
              (pullErr as Error).message
            }). If this is the bundled toolchain image, build it first with \`docker compose build sandbox-image\` (or set SANDBOX_IMAGE / the workspace's image to a public image such as python:3.12-slim).`
          );
        }
        return this.docker.createContainer(opts);
      }
      throw e;
    }
  }

  private pullImage(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (doneErr: Error | null) =>
          doneErr ? reject(doneErr) : resolve()
        );
      });
    });
  }

  /** Exec a command and collect demuxed stdout/stderr (with an output cap). */
  private async runCommand(
    container: Docker.Container,
    cmd: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }> {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: this.cfg.workdir,
      User: this.cfg.user,
    });
    const stream = await exec.start({ hijack: true, stdin: false });

    const outCap = new CappedSink(this.cfg.maxOutputBytes);
    const errCap = new CappedSink(this.cfg.maxOutputBytes);
    this.docker.modem.demuxStream(stream, outCap, errCap);

    await new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    // Backstop wait for the exec to report its exit code.
    let exitCode = 0;
    try {
      const info = await exec.inspect();
      exitCode = info.ExitCode ?? 0;
    } catch {
      exitCode = 0;
    }

    return {
      stdout: outCap.text(),
      stderr: errCap.text(),
      exitCode,
      truncated: outCap.truncated || errCap.truncated,
    };
  }

  /** Exec a command, ignoring its output (used for housekeeping like rm). */
  private async runRaw(container: Docker.Container, cmd: string[]): Promise<void> {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: false,
      AttachStderr: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    await new Promise<void>((resolve) => {
      stream.on("end", resolve);
      stream.on("error", () => resolve());
      stream.resume();
    });
  }

  /* ----------------------------- housekeeping ---------------------------- */

  private startReaper() {
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      const now = Date.now();
      // End idle interactive shells (their container may still be reaped below).
      for (const [id, p] of this.ptys) {
        if (p.closed || now - p.lastUsed > this.cfg.idleTimeoutMs) {
          this.ptys.delete(id);
          try {
            p.stream.end();
          } catch {
            /* ignore */
          }
        }
      }
      for (const [wsId, s] of this.sessions) {
        if (now - s.lastUsed > this.cfg.idleTimeoutMs) {
          this.sessions.delete(wsId);
          this.forceRemove(s.containerId).catch(() => {});
        }
      }
    }, 60000);
    // Don't keep the event loop alive just for the reaper.
    this.reaper.unref?.();
  }

  private async forceRemove(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).remove({ force: true });
  }

  private async findRunningByLabel(
    workspaceId: string
  ): Promise<{ id: string } | null> {
    const list = await this.docker
      .listContainers({
        filters: { label: [`mimir.workspace=${workspaceId}`], status: ["running"] },
      })
      .catch(() => [] as Docker.ContainerInfo[]);
    return list[0] ? { id: list[0].Id } : null;
  }

  private async removeByLabel(workspaceId: string): Promise<void> {
    const list = await this.docker
      .listContainers({ all: true, filters: { label: [`mimir.workspace=${workspaceId}`] } })
      .catch(() => [] as Docker.ContainerInfo[]);
    await Promise.all(list.map((c) => this.forceRemove(c.Id).catch(() => {})));
  }
}

/* ------------------------------- utilities ------------------------------- */

/** A Writable that keeps only the first `cap` bytes, flagging truncation. */
class CappedSink extends Writable {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;
  constructor(private cap: number) {
    super();
  }
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
    if (this.size < this.cap) {
      const room = this.cap - this.size;
      if (chunk.length > room) {
        this.chunks.push(chunk.subarray(0, room));
        this.truncated = true;
      } else {
        this.chunks.push(chunk);
      }
      this.size += chunk.length;
    } else {
      this.truncated = true;
    }
    cb();
  }
  text(): string {
    return Buffer.concat(this.chunks).toString("utf-8");
  }
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40) || "ws";
}

/**
 * A process-wide singleton, kept across hot reloads in dev so we don't leak a
 * new Docker client (and container map) on every code change.
 */
const globalForSandbox = globalThis as unknown as {
  __mimirSandbox?: SandboxManager;
};
export const sandbox: SandboxManager =
  globalForSandbox.__mimirSandbox ?? (globalForSandbox.__mimirSandbox = new SandboxManager());
