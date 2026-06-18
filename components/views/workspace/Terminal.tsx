"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uid, useMimir } from "@/lib/store";
import { SandboxStatus, WorkspaceExecResult } from "@/lib/types";
import { api } from "@/lib/api";
import * as Icons from "@/components/icons";

/**
 * An interactive console for the workspace sandbox. You type a command, it runs
 * in the same Docker container the agent uses (working directory /workspace),
 * and the output streams back along with any file changes — so you can drive the
 * environment yourself: install things, run scripts, poke at what the agent
 * built. Each command runs to completion under a time limit; this is a command
 * runner, not a live TTY, so interactive programs and long-lived servers won't
 * work. History is kept for the session (it resets on reload).
 */

interface Line {
  id: string;
  command: string;
  status: "running" | "done" | "error";
  result?: WorkspaceExecResult;
  error?: string;
}

export default function Terminal({ workspaceId }: { workspaceId: string }) {
  const setWorkspaceFiles = useMimir((s) => s.setWorkspaceFiles);

  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [cwd, setCwd] = useState("/workspace");

  const history = useRef<string[]>([]);
  const historyIdx = useRef<number>(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const checkStatus = useCallback(() => {
    setChecking(true);
    api
      .sandboxStatus(workspaceId)
      .then(setStatus)
      .catch((e) =>
        setStatus({ available: false, reason: (e as Error).message })
      )
      .finally(() => setChecking(false));
  }, [workspaceId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const run = useCallback(
    async (command: string) => {
      const id = uid("cmd_");
      setLines((prev) => [...prev, { id, command, status: "running" }]);
      setBusy(true);
      try {
        const files =
          useMimir.getState().workspaces[workspaceId]?.files ?? [];
        const { result, files: updated } = await api.execWorkspaceCommand(
          workspaceId,
          command,
          files
        );
        setWorkspaceFiles(workspaceId, updated);
        // Reflect the directory the sandbox is now in, so `cd` shows up in the
        // prompt and persists between commands.
        if (result.cwd) setCwd(result.cwd);
        setLines((prev) =>
          prev.map((l) =>
            l.id === id ? { ...l, status: "done", result } : l
          )
        );
        if (!status?.available) checkStatus();
      } catch (e) {
        setLines((prev) =>
          prev.map((l) =>
            l.id === id ? { ...l, status: "error", error: (e as Error).message } : l
          )
        );
      } finally {
        setBusy(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [workspaceId, setWorkspaceFiles, status, checkStatus]
  );

  function submit() {
    const cmd = input.trim();
    if (!cmd || busy) return;
    history.current = [...history.current, cmd];
    historyIdx.current = history.current.length;
    setInput("");
    // `clear`/`cls` are handled here as console builtins — they wipe the visible
    // scrollback rather than running in the container (where they'd just emit
    // terminal escape codes that do nothing useful in this log view).
    if (cmd === "clear" || cmd === "cls") {
      setLines([]);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    void run(cmd);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.current.length === 0) return;
      historyIdx.current = Math.max(0, historyIdx.current - 1);
      setInput(history.current[historyIdx.current] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (history.current.length === 0) return;
      historyIdx.current = Math.min(
        history.current.length,
        historyIdx.current + 1
      );
      setInput(history.current[historyIdx.current] ?? "");
    }
  }

  async function reset() {
    setResetting(true);
    try {
      await api.resetWorkspaceSandbox(workspaceId);
      setLines((prev) => [
        ...prev,
        {
          id: uid("cmd_"),
          command: "",
          status: "done",
          result: noteResult("Sandbox reset — a fresh container will start on the next command."),
        },
      ]);
    } catch {
      /* ignore */
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-ink-950">
      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-1.5 text-[11px]">
        {checking ? (
          <span className="flex items-center gap-1.5 text-parchment-600">
            <Icons.IconSpark className="h-3.5 w-3.5 mimir-spin" />
            checking sandbox…
          </span>
        ) : status?.available ? (
          <span className="flex items-center gap-1.5 text-signal-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-ok" />
            sandbox ready
            <span className="text-parchment-600">
              · {status.image}
              {status.network === "none" ? " · no network" : ` · ${status.network}`}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-signal-err">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-err" />
            sandbox unavailable
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={checkStatus}
          className="rounded px-1.5 py-0.5 text-parchment-600 hover:bg-ink-800 hover:text-parchment-100"
          title="Re-check sandbox"
        >
          recheck
        </button>
        <button
          onClick={reset}
          disabled={resetting || !status?.available}
          className="rounded px-1.5 py-0.5 text-parchment-600 hover:bg-ink-800 hover:text-parchment-100 disabled:opacity-40"
          title="Stop and discard the container (clears installed packages and state)"
        >
          {resetting ? "resetting…" : "reset"}
        </button>
      </div>

      {!checking && !status?.available && status?.reason && (
        <div className="border-b border-signal-err/30 bg-signal-err/10 px-3 py-2 text-[11px] leading-relaxed text-signal-err">
          {status.reason}
          <div className="mt-1 text-parchment-600">
            Code execution needs Docker running on the Mimir host. See the
            Workspaces section of the README to configure it.
          </div>
        </div>
      )}

      {/* Scrollback */}
      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && (
          <div className="text-parchment-600">
            {status?.available
              ? "Type a command and press Enter. Try: ls -la, python --version, or run a script you've written. cd persists between commands; type clear to wipe the screen."
              : "The sandbox isn't available yet."}
          </div>
        )}
        {lines.map((l) => (
          <TerminalLine key={l.id} line={l} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-parchment-600">
            <Icons.IconSpark className="h-3.5 w-3.5 mimir-spin text-bronze-400" />
            running…
          </div>
        )}
      </div>

      {/* Prompt */}
      <div className="flex items-center gap-2 border-t border-ink-700 px-3 py-2 font-mono text-xs">
        <span className="flex items-center gap-1 select-none whitespace-nowrap">
          <span className="text-parchment-500">{cwdLabel(cwd)}</span>
          <span className="text-bronze-400">$</span>
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy || !status?.available}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={status?.available ? "" : "sandbox unavailable"}
          className="min-w-0 flex-1 bg-transparent text-parchment-100 placeholder:text-parchment-600 focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}

/** Show /workspace as ~, and paths under it as ~/sub, else the absolute path. */
function cwdLabel(cwd: string): string {
  if (cwd === "/workspace") return "~";
  if (cwd.startsWith("/workspace/")) return "~/" + cwd.slice("/workspace/".length);
  return cwd;
}

function TerminalLine({ line }: { line: Line }) {
  if (line.command === "" && line.result) {
    // A system note (e.g. reset confirmation).
    return (
      <div className="mb-1.5 text-parchment-600">{line.result.stdout}</div>
    );
  }
  return (
    <div className="mb-2">
      <div className="flex gap-2 text-parchment-100">
        <span className="select-none text-bronze-400">$</span>
        <span className="break-all">{line.command}</span>
      </div>
      {line.status === "running" && (
        <div className="pl-4 text-parchment-600">…</div>
      )}
      {line.status === "error" && (
        <div className="pl-4 text-signal-err">{line.error}</div>
      )}
      {line.status === "done" && line.result && (
        <ResultBlock result={line.result} />
      )}
    </div>
  );
}

function ResultBlock({ result }: { result: WorkspaceExecResult }) {
  const stdout = result.stdout.replace(/\n+$/, "");
  const stderr = result.stderr.replace(/\n+$/, "");
  const failed = result.timedOut || (result.exitCode ?? 0) !== 0;
  return (
    <div className="pl-4">
      {stdout && (
        <pre className="whitespace-pre-wrap break-all text-parchment-300">
          {stdout}
        </pre>
      )}
      {stderr && (
        <pre className="whitespace-pre-wrap break-all text-signal-err/90">
          {stderr}
        </pre>
      )}
      <div
        className={[
          "mt-0.5 text-[10px]",
          failed ? "text-signal-err" : "text-parchment-600",
        ].join(" ")}
      >
        {result.timedOut
          ? `timed out after ${(result.durationMs / 1000).toFixed(1)}s`
          : `exit ${result.exitCode} · ${(result.durationMs / 1000).toFixed(1)}s`}
        {result.truncated ? " · output truncated" : ""}
        {result.skippedFiles && result.skippedFiles.length > 0
          ? ` · ${result.skippedFiles.length} file(s) not loaded (too large/binary)`
          : ""}
      </div>
    </div>
  );
}

function noteResult(text: string): WorkspaceExecResult {
  return {
    command: "",
    stdout: text,
    stderr: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 0,
  };
}
