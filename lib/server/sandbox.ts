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
        const body = e.content ?? "";
        pack.entry({ name: e.name, size: Buffer.byteLength(body) }, body, (err) => {
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
          const content = isDir ? "" : Buffer.concat(bodyChunks).toString("utf-8");
          out.push({
            path: "/" + rel,
            type: isDir ? "dir" : "file",
            content,
            size: isDir ? 0 : Buffer.concat(bodyChunks).length,
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
 * Turn parsed container entries into a store filesystem, dropping ignored dirs,
 * binary blobs, and anything past the size/count caps so the store stays sane.
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
      files.push(makeNode(e.path, "dir", "", prevByPath, now));
      continue;
    }
    if (e.size > cfg.maxFileBytes) {
      skipped.push(e.path);
      continue;
    }
    // Heuristic: NUL byte ⇒ binary, which the text store can't hold.
    if (e.content.includes("\u0000")) {
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
    files.push(makeNode(e.path, "file", e.content, prevByPath, now));
  }
  return { files, skipped };
}

function makeNode(
  path: string,
  type: "file" | "dir",
  content: string,
  prev: Map<string, WorkspaceFile>,
  now: number
): WorkspaceFile {
  const existing = prev.get(path);
  return {
    path,
    type,
    content,
    createdAt: existing?.createdAt ?? now,
    updatedAt:
      existing && existing.content === content && existing.type === type
        ? existing.updatedAt
        : now,
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
        toWrite.push({ name: rel, type: "file", content: f.content });
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

interface Session {
  containerId: string;
  lastUsed: number;
  lastSynced: Map<string, string>;
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

class SandboxManager {
  private docker = new Docker();
  private cfg = loadSandboxConfig();
  private sessions = new Map<string, Session>();
  private reaper?: ReturnType<typeof setInterval>;

  config(): SandboxConfig {
    return this.cfg;
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
    files: WorkspaceFile[]
  ): Promise<{ result: WorkspaceExecResult; files: WorkspaceFile[] }> {
    if (!this.cfg.enabled) {
      throw new Error("The execution sandbox is disabled (SANDBOX_ENABLED=false).");
    }
    const session = this.sessions.get(workspaceId);
    const prior = session?.queue ?? Promise.resolve();
    const run = prior
      .catch(() => {})
      .then(() => this.execInner(workspaceId, command, files));
    // Update the queue tail regardless of outcome.
    const s = this.sessions.get(workspaceId);
    if (s) s.queue = run.catch(() => {});
    return run;
  }

  private async execInner(
    workspaceId: string,
    command: string,
    files: WorkspaceFile[]
  ): Promise<{ result: WorkspaceExecResult; files: WorkspaceFile[] }> {
    const container = await this.ensureContainer(workspaceId);
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
        synced
          .filter((f) => f.type !== "dir" || true)
          .map((f) => [f.path.replace(/^\//, ""), f.type === "dir" ? "" : f.content])
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
    const session = this.sessions.get(workspaceId);
    this.sessions.delete(workspaceId);
    if (!session) {
      // Also catch a container left over from a previous process.
      await this.removeByLabel(workspaceId).catch(() => {});
      return;
    }
    await this.forceRemove(session.containerId).catch(() => {});
  }

  private async ensureContainer(workspaceId: string): Promise<Docker.Container> {
    this.startReaper();
    const existing = this.sessions.get(workspaceId);
    if (existing) {
      const c = this.docker.getContainer(existing.containerId);
      try {
        const info = await c.inspect();
        if (info.State.Running) return c;
      } catch {
        /* fall through and recreate */
      }
      this.sessions.delete(workspaceId);
    }

    // Reuse a still-running container from a previous process, if any.
    const reused = await this.findRunningByLabel(workspaceId);
    if (reused) {
      this.sessions.set(workspaceId, {
        containerId: reused.id,
        lastUsed: Date.now(),
        lastSynced: new Map(),
        queue: Promise.resolve(),
        cwd: this.cfg.workdir,
      });
      return this.docker.getContainer(reused.id);
    }

    const container = await this.createContainer(workspaceId);
    await container.start();
    this.sessions.set(workspaceId, {
      containerId: container.id,
      lastUsed: Date.now(),
      lastSynced: new Map(),
      queue: Promise.resolve(),
      cwd: this.cfg.workdir,
    });
    return container;
  }

  private async createContainer(workspaceId: string): Promise<Docker.Container> {
    const opts: Docker.ContainerCreateOptions = {
      name: `mimir-ws-${sanitize(workspaceId)}-${Date.now().toString(36)}`,
      Image: this.cfg.image,
      Labels: { "mimir.workspace": workspaceId, "mimir.sandbox": "1" },
      Cmd: ["sleep", "infinity"],
      WorkingDir: this.cfg.workdir,
      User: this.cfg.user,
      Tty: false,
      NetworkDisabled: this.cfg.network === "none",
      HostConfig: {
        Memory: this.cfg.memoryBytes,
        MemorySwap: this.cfg.memoryBytes, // disable swap (swap == memory)
        NanoCpus: this.cfg.nanoCpus,
        PidsLimit: this.cfg.pidsLimit,
        NetworkMode: this.cfg.network,
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
      // Image not present locally → pull once and retry.
      if (/no such image|not found/i.test((e as Error).message)) {
        await this.pullImage(this.cfg.image);
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
