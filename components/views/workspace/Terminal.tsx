"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMimir } from "@/lib/store";
import { SandboxStatus } from "@/lib/types";
import { api } from "@/lib/api";
import {
  createTerminal,
  feed,
  snapshotWithCursor,
  Span,
  TerminalState,
} from "@/lib/workspace/terminalModel";
import * as Icons from "@/components/icons";

/**
 * A genuinely interactive terminal for the workspace sandbox. It opens a real
 * TTY shell inside the same Docker container the agent uses (working directory
 * /workspace): output streams back over Server-Sent Events and keystrokes are
 * sent up as you type, so prompts, REPLs (python, node), colors, progress bars,
 * and Ctrl-C all work — not just one-shot commands. File changes are synced back
 * into the store when the session ends. A lightweight ANSI model renders the
 * stream; elaborate full-screen TUIs (vim, htop) degrade gracefully.
 *
 * The session lives for as long as this view is mounted; closing it (or leaving
 * the workspace) shuts the shell down and reconciles the filesystem.
 */

/* ------------------------------ byte helpers ----------------------------- */

function encodeB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Map a keydown to the bytes a terminal would send, or null to ignore. */
function keyToBytes(e: React.KeyboardEvent): string | null {
  const { key } = e;
  if (e.metaKey) return null; // leave browser/OS shortcuts alone

  if (e.ctrlKey) {
    if (key.length === 1) {
      const c = key.toLowerCase().charCodeAt(0);
      if (c >= 97 && c <= 122) return String.fromCharCode(c - 96); // Ctrl-A..Z
      if (key === " ") return "\x00";
    }
    if (key === "[") return "\x1b";
    return null;
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "Delete":
      return "\x1b[3~";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    default:
      return key.length === 1 ? key : null;
  }
}

/* -------------------------------- component ------------------------------ */

export default function Terminal({ workspaceId }: { workspaceId: string }) {
  const setWorkspaceFiles = useMimir((s) => s.setWorkspaceFiles);

  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [phase, setPhase] = useState<"idle" | "opening" | "live" | "ended">(
    "idle"
  );
  const [resetting, setResetting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [lines, setLines] = useState<Span[][]>([]);

  // Long-lived bits kept in refs so the stream callbacks don't churn renders.
  const term = useRef<TerminalState>(createTerminal());
  const decoder = useRef(new TextDecoder("utf-8"));
  const esRef = useRef<EventSource | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const renderQueued = useRef(false);
  const inputBuf = useRef<string>("");
  const inputTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const lastSize = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  // Whether the view should follow new output to the bottom. Flipped off when
  // the user scrolls up, back on when they return to the bottom.
  const stickRef = useRef(true);

  const checkStatus = useCallback(() => {
    setChecking(true);
    api
      .sandboxStatus(workspaceId)
      .then(setStatus)
      .catch((e) => setStatus({ available: false, reason: (e as Error).message }))
      .finally(() => setChecking(false));
  }, [workspaceId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const scheduleRender = useCallback(() => {
    if (renderQueued.current) return;
    renderQueued.current = true;
    requestAnimationFrame(() => {
      renderQueued.current = false;
      // Scrolling happens in a post-paint effect (below) so it sees the real
      // height of the just-rendered lines, not the stale previous height.
      setLines(snapshotWithCursor(term.current));
    });
  }, []);

  // Follow new output to the bottom unless the user has scrolled up. Runs after
  // React paints the new lines, so scrollHeight is accurate.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Track whether we're pinned to the bottom as the user scrolls.
  const onPaneScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  /** Compute cols/rows from the pane and a measured monospace cell. */
  const measure = useCallback(() => {
    const pane = scrollRef.current;
    const cell = measureRef.current;
    if (!pane || !cell) return lastSize.current;
    const cw = cell.getBoundingClientRect().width / 10 || 8;
    const lh = cell.getBoundingClientRect().height || 16;
    const cols = Math.max(20, Math.floor((pane.clientWidth - 16) / cw));
    const rows = Math.max(6, Math.floor((pane.clientHeight - 8) / lh));
    lastSize.current = { cols, rows };
    return lastSize.current;
  }, []);

  /* ------------------------------- session ------------------------------ */

  const closeSession = useCallback(
    async (sync: boolean) => {
      const ptyId = ptyIdRef.current;
      ptyIdRef.current = null;
      esRef.current?.close();
      esRef.current = null;
      if (ptyId && sync) {
        try {
          const files =
            useMimir.getState().workspaces[workspaceId]?.files ?? [];
          const { files: updated } = await api.closePty(
            workspaceId,
            ptyId,
            files
          );
          if (updated) setWorkspaceFiles(workspaceId, updated);
        } catch {
          /* best-effort sync-back */
        }
      } else if (ptyId) {
        void api.closePty(workspaceId, ptyId, []).catch(() => {});
      }
    },
    [workspaceId, setWorkspaceFiles]
  );

  const openSession = useCallback(async () => {
    setPhase("opening");
    term.current = createTerminal();
    decoder.current = new TextDecoder("utf-8");
    stickRef.current = true;
    setLines([]);
    const { cols, rows } = measure();
    try {
      const files = useMimir.getState().workspaces[workspaceId]?.files ?? [];
      const { ptyId } = await api.openPty(workspaceId, files, cols, rows);
      ptyIdRef.current = ptyId;

      const es = new EventSource(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/pty?ptyId=${encodeURIComponent(
          ptyId
        )}`
      );
      esRef.current = es;
      es.addEventListener("out", (ev) => {
        const bytes = decodeB64((ev as MessageEvent).data);
        const text = decoder.current.decode(bytes, { stream: true });
        if (text) {
          feed(term.current, text);
          scheduleRender();
        }
      });
      es.addEventListener("exit", () => {
        setPhase("ended");
        es.close();
        esRef.current = null;
        // Reconcile the filesystem once the shell is gone.
        void closeSession(true);
      });
      es.onerror = () => {
        // The stream dropped; mark ended so the user can restart it.
        setPhase((p) => (p === "live" ? "ended" : p));
      };
      setPhase("live");
      requestAnimationFrame(() => captureRef.current?.focus());
    } catch (e) {
      feed(
        term.current,
        `\r\n[mimir] couldn't start the terminal: ${(e as Error).message}\r\n`
      );
      scheduleRender();
      setPhase("ended");
    }
  }, [workspaceId, measure, scheduleRender, closeSession]);

  // Open on mount when the sandbox is available; tear down on unmount.
  useEffect(() => {
    if (checking) return;
    if (status?.available && phase === "idle") void openSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, status?.available]);

  useEffect(() => {
    return () => {
      if (inputTimer.current) clearTimeout(inputTimer.current);
      void closeSession(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------- input ------------------------------- */

  const flushInput = useCallback(() => {
    const data = inputBuf.current;
    inputBuf.current = "";
    inputTimer.current = null;
    const ptyId = ptyIdRef.current;
    if (!ptyId || !data) return;
    void api.ptyInput(workspaceId, ptyId, encodeB64(data)).catch(() => {});
  }, [workspaceId]);

  const sendInput = useCallback(
    (data: string) => {
      inputBuf.current += data;
      // Coalesce rapid keystrokes into one request without adding visible lag.
      if (!inputTimer.current) {
        inputTimer.current = setTimeout(flushInput, 8);
      }
    },
    [flushInput]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (phase !== "live") return;
    const bytes = keyToBytes(e);
    if (bytes == null) return;
    e.preventDefault();
    sendInput(bytes);
  }

  function onPaste(e: React.ClipboardEvent) {
    if (phase !== "live") return;
    const text = e.clipboardData.getData("text");
    if (text) {
      e.preventDefault();
      sendInput(text);
    }
  }

  /* ------------------------------- resize ------------------------------- */

  useLayoutEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const { cols, rows } = measure();
        const ptyId = ptyIdRef.current;
        if (ptyId) void api.ptyResize(workspaceId, ptyId, cols, rows).catch(() => {});
      }, 150);
    });
    ro.observe(pane);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [workspaceId, measure]);

  // openSession() measures before the PTY is created, but on a fast tab switch
  // the pane can finish sizing a beat later — leaving the shell a few cols/rows
  // off until the next manual resize. Re-measure once it goes live and correct
  // the PTY if the size moved.
  useEffect(() => {
    if (phase !== "live") return;
    const before = lastSize.current;
    const { cols, rows } = measure();
    if (cols !== before.cols || rows !== before.rows) {
      const ptyId = ptyIdRef.current;
      if (ptyId) {
        void api.ptyResize(workspaceId, ptyId, cols, rows).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* -------------------------------- reset ------------------------------- */

  async function reset() {
    setResetting(true);
    try {
      await closeSession(false);
      await api.resetWorkspaceSandbox(workspaceId);
      setPhase("idle");
      checkStatus();
      // openSession will fire from the status effect once it confirms ready.
    } catch {
      /* ignore */
    } finally {
      setResetting(false);
    }
  }

  const busy = phase === "opening";

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
            <span
              className={[
                "h-1.5 w-1.5 rounded-full",
                phase === "live" ? "bg-signal-ok" : "bg-parchment-600",
              ].join(" ")}
            />
            {phase === "live"
              ? "shell live"
              : phase === "opening"
              ? "starting shell…"
              : phase === "ended"
              ? "shell ended"
              : "sandbox ready"}
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
        {phase === "ended" && status?.available && (
          <button
            onClick={() => void openSession()}
            className="rounded px-1.5 py-0.5 text-bronze-300 hover:bg-ink-800"
            title="Start a new shell"
          >
            restart
          </button>
        )}
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

      {/* Terminal surface */}
      <div
        ref={scrollRef}
        onScroll={onPaneScroll}
        onClick={() => captureRef.current?.focus()}
        className="relative min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-xs leading-[1.35]"
      >
        {/* Hidden cell used to measure character size for cols/rows. */}
        <span
          ref={measureRef}
          aria-hidden
          className="pointer-events-none absolute -top-[9999px] left-0 whitespace-pre"
        >
          0123456789
        </span>

        {/* Focusable capture layer for keystrokes. Fills the surface so the
            whole pane is the click/scroll target and an empty shell doesn't
            collapse to a thin strip. */}
        <div
          ref={captureRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="mimir-term-surface block min-h-full w-full outline-none"
        >
          {busy && (
            <div className="flex items-center gap-2 text-parchment-600">
              <Icons.IconSpark className="h-3.5 w-3.5 mimir-spin text-bronze-400" />
              starting shell…
            </div>
          )}
          {!busy && lines.length === 0 && phase !== "live" && (
            <div className="text-parchment-600">
              {status?.available
                ? "The shell will appear here."
                : "The sandbox isn't available yet."}
            </div>
          )}
          {lines.map((spans, i) => (
            <TerminalRow
              key={i}
              spans={spans}
              showCaret={focused && phase === "live"}
            />
          ))}
        </div>
      </div>

      {/* Footer hint */}
      <div className="border-t border-ink-700 px-3 py-1 font-mono text-[10px] text-parchment-600">
        {phase === "live"
          ? focused
            ? "interactive — type as in a real terminal · Ctrl-C interrupts · Ctrl-D exits"
            : "click to focus the terminal"
          : phase === "ended"
          ? "shell ended — use restart for a new one"
          : "\u00a0"}
      </div>
    </div>
  );
}

function TerminalRow({ spans, showCaret }: { spans: Span[]; showCaret: boolean }) {
  if (spans.length === 0) {
    return (
      <div className="whitespace-pre-wrap break-all">
        <span>{"\u00a0"}</span>
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap break-all">
      {spans.map((s, i) => {
        const style: React.CSSProperties = {
          color: s.style.inverse ? "#0d0f11" : s.style.fg,
          backgroundColor: s.style.inverse
            ? s.style.fg ?? "#ece7dd"
            : s.style.bg,
          fontWeight: s.style.bold ? 600 : undefined,
          opacity: s.style.dim ? 0.7 : undefined,
          textDecoration: s.style.underline ? "underline" : undefined,
        };
        // The cursor cell: keep the character visible and lay a blinking block
        // over it, positioned at the true cursor column.
        if (s.cursor && showCaret) {
          return (
            <span
              key={i}
              className="relative inline-block whitespace-pre"
              style={style}
            >
              {s.text}
              <span className="mimir-caret pointer-events-none absolute inset-0 bg-parchment-100/80" />
            </span>
          );
        }
        return (
          <span key={i} style={style}>
            {s.text}
          </span>
        );
      })}
    </div>
  );
}
