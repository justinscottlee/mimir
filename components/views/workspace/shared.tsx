"use client";

import { useEffect, useRef, useState } from "react";
import { AgentRunStatus, ToolEventRecord } from "@/lib/types";
import { parseTranscript } from "@/lib/transcript";
import Markdown from "@/components/Markdown";
import * as Icons from "@/components/icons";

/* ----------------------------- status badge ----------------------------- */

const STATUS_META: Record<
  AgentRunStatus,
  { label: string; tone: "live" | "ok" | "warn" | "err" | "muted" }
> = {
  running: { label: "Running", tone: "live" },
  done: { label: "Completed", tone: "ok" },
  stopped: { label: "Stopped", tone: "muted" },
  idle: { label: "Idle", tone: "muted" },
  max_steps: { label: "Hit step cap", tone: "warn" },
  max_tokens: { label: "Hit token budget", tone: "warn" },
  stalled: { label: "Stalled", tone: "warn" },
  error: { label: "Error", tone: "err" },
};

const TONE_CLASS: Record<string, string> = {
  live: "border-bronze-600/60 bg-bronze-600/15 text-bronze-300",
  ok: "border-signal-ok/50 bg-signal-ok/10 text-signal-ok",
  warn: "border-bronze-500/50 bg-bronze-500/10 text-bronze-300",
  err: "border-signal-err/50 bg-signal-err/10 text-signal-err",
  muted: "border-ink-700 bg-ink-850 text-parchment-400",
};

export function RunStatusBadge({ status }: { status: AgentRunStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        TONE_CLASS[meta.tone],
      ].join(" ")}
    >
      {status === "running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bronze-400" />
      )}
      {meta.label}
    </span>
  );
}

/* --------------------------- tool descriptions --------------------------- */

export function describeFsTool(event: ToolEventRecord): string {
  const a = event.args;
  const path = typeof a.path === "string" ? a.path : "";
  switch (event.name) {
    case "list_files":
      return typeof a.path === "string" && a.path ? `listed ${a.path}` : "listed files";
    case "read_file":
      return path ? `read ${path}` : "read a file";
    case "write_file":
      return path ? `wrote ${path}` : "wrote a file";
    case "edit_file":
      return path ? `edited ${path}` : "edited a file";
    case "make_dir":
      return path ? `mkdir ${path}` : "made a directory";
    case "delete_path":
      return path ? `deleted ${path}` : "deleted a path";
    case "move_path":
      return typeof a.from === "string" && typeof a.to === "string"
        ? `moved ${a.from} → ${a.to}`
        : "moved a path";
    case "task_complete":
      return "marked the task complete";
    case "run_command": {
      const cmd = typeof a.command === "string" ? a.command : "";
      return cmd ? `ran: ${cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd}` : "ran a command";
    }
    case "set_plan":
      return "set the plan";
    case "add_plan_item":
      return typeof a.text === "string" ? `added step: ${clip(a.text, 50)}` : "added a step";
    case "update_plan_item":
      return "updated a step";
    case "set_plan_item_status":
      return typeof a.id === "string" && typeof a.status === "string"
        ? `marked a step ${a.status}`
        : "updated a step";
    default:
      return "";
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ----------------------------- step body --------------------------------- */

/**
 * Renders one agent step's transcript: thinking panels, prose (markdown), and
 * tool chips, in the order they occurred — the same parse the chat uses.
 */
export function StepBody({
  content,
  isStreaming,
  toolEvents,
  thinkingMs,
}: {
  content: string;
  isStreaming: boolean;
  toolEvents: ToolEventRecord[];
  thinkingMs?: number;
}) {
  const segments = parseTranscript(content);
  if (segments.length === 0 && !isStreaming) {
    return (
      <div className="text-xs italic text-parchment-600">
        (no output this step)
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) => {
        if (seg.type === "think") {
          return (
            <ThinkPanel
              key={`think-${i}`}
              text={seg.text}
              live={seg.open && isStreaming}
              thinkingMs={thinkingMs}
            />
          );
        }
        if (seg.type === "tool") {
          const event = toolEvents.find((e) => e.index === seg.index);
          return <ToolChip key={`tool-${seg.index}`} event={event} />;
        }
        return (
          <Markdown key={`text-${i}`} content={seg.text} isStreaming={isStreaming} />
        );
      })}
      {isStreaming && segments.length === 0 && (
        <span className="inline-flex items-center gap-2 text-xs text-parchment-600">
          <Icons.IconSpark className="h-4 w-4 mimir-spin text-bronze-400" />
          thinking…
        </span>
      )}
    </div>
  );
}

function ThinkPanel({
  text,
  live,
  thinkingMs,
}: {
  text: string;
  live: boolean;
  thinkingMs?: number;
}) {
  const [open, setOpen] = useState(live);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!live) return;
    setOpen(true);
    if (startRef.current == null) startRef.current = performance.now();
    const t = setInterval(() => {
      if (startRef.current != null) setElapsed(performance.now() - startRef.current);
    }, 100);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);

  const duration = live ? elapsed : thinkingMs;
  const label = duration != null ? `${(duration / 1000).toFixed(1)}s` : null;

  return (
    <div className="overflow-hidden rounded-md border border-bronze-600/40 bg-bronze-600/10">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-bronze-600/15 px-3 py-1.5 text-left text-xs text-bronze-300 transition-colors hover:bg-bronze-600/25"
      >
        <Icons.IconSpark
          className={["h-4 w-4 text-bronze-400", live ? "mimir-spin" : ""].join(" ")}
        />
        <span className="font-medium">
          {live ? "Thinking" : "Thought"}
          {label ? ` · ${label}` : ""}
        </span>
        <div className="flex-1" />
        <Icons.IconChevron
          className={["h-4 w-4 transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && (
        <div className="border-t border-bronze-600/30 px-3 py-2">
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-parchment-400">
            {text.trim() || (live ? "…" : "")}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolChip({ event }: { event?: ToolEventRecord }) {
  const [open, setOpen] = useState(false);
  // No event yet at all (marker present, store not caught up): generic spinner.
  if (!event) {
    return (
      <div className="inline-flex items-center gap-2 self-start rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs text-parchment-400">
        <Icons.IconSpark className="h-4 w-4 mimir-spin text-bronze-400" />
        running tool…
      </div>
    );
  }

  // Recursive-summarization pass: a distinct chip showing the context saved.
  if (event.compaction) {
    return <CompactionChip compaction={event.compaction} />;
  }

  const label = describeFsTool(event);

  // The tool is still executing: show a spinning chip with what it's doing, so
  // a slow tool (e.g. a long command) is visibly in progress rather than silent.
  if (event.pending) {
    return (
      <div className="inline-flex max-w-full items-center gap-2 self-start rounded-md border border-bronze-600/40 bg-bronze-600/10 px-2.5 py-1 text-xs">
        <Icons.IconSpark className="h-4 w-4 shrink-0 mimir-spin text-bronze-400" />
        <span className="font-mono text-bronze-300">{event.name}</span>
        {label && (
          <span className="truncate text-parchment-400">{label}</span>
        )}
        <span className="shrink-0 text-parchment-600">· running…</span>
      </div>
    );
  }

  const isError = event.result.startsWith("Error:");
  return (
    <div className="self-start overflow-hidden rounded-md border border-ink-700 bg-ink-850">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2.5 py-1 text-left text-xs text-parchment-400 transition-colors hover:bg-ink-800"
      >
        <span
          className={[
            "h-1.5 w-1.5 rounded-full",
            isError ? "bg-signal-err" : "bg-bronze-400",
          ].join(" ")}
        />
        <span className="font-mono text-bronze-300">{event.name}</span>
        <span className="text-parchment-600">{label}</span>
        {event.pruned && (
          <span
            className="flex items-center gap-1 rounded-full border border-bronze-600/50 bg-bronze-600/15 px-1.5 py-0.5 font-mono text-[10px] text-bronze-300"
            title={`Output distilled to save context: ${event.pruned.before.toLocaleString()} → ${event.pruned.after.toLocaleString()} characters (${prunePct(event.pruned)}% smaller)`}
          >
            <Icons.IconSliders className="h-3 w-3" />
            distilled {fmtChipCount(event.pruned.before)}→{fmtChipCount(event.pruned.after)} (−{prunePct(event.pruned)}%)
          </span>
        )}
        <Icons.IconChevron
          className={["h-4 w-4 transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && (
        <div className="max-h-64 overflow-auto border-t border-ink-700 px-2.5 py-2">
          <div
            className={[
              "whitespace-pre-wrap font-mono text-xs leading-relaxed",
              isError ? "text-signal-err" : "text-parchment-400",
            ].join(" ")}
          >
            {event.result}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact a number for badges: 980 → "980", 8200 → "8.2k". */
function fmtChipCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

/** Percent reduction from a prune (before → after), clamped to 0–99. */
function prunePct(p: { before: number; after: number }): number {
  if (p.before <= 0) return 0;
  return Math.min(99, Math.max(0, Math.round(((p.before - p.after) / p.before) * 100)));
}

/**
 * A distinct chip shown when the context manager compacted earlier history into
 * a summary, making it obvious that (and how much) context was reclaimed.
 */
function CompactionChip({
  compaction,
}: {
  compaction: { before: number; after: number };
}) {
  const saved = Math.max(0, compaction.before - compaction.after);
  const pct =
    compaction.before > 0 ? Math.round((saved / compaction.before) * 100) : 0;
  return (
    <div
      className="inline-flex max-w-full items-center gap-2 self-start rounded-md border border-bronze-600/40 bg-bronze-600/10 px-2.5 py-1 text-xs text-parchment-300"
      title={`Earlier run history summarized: ~${compaction.before.toLocaleString()} → ~${compaction.after.toLocaleString()} tokens`}
    >
      <Icons.IconSliders className="h-4 w-4 shrink-0 text-bronze-400" />
      <span className="font-medium text-bronze-200">Context compacted</span>
      <span className="text-parchment-500">
        ~{fmtChipCount(compaction.before)} → ~{fmtChipCount(compaction.after)} tokens
        {saved > 0 ? ` · saved ~${fmtChipCount(saved)} (${pct}%)` : ""}
      </span>
    </div>
  );
}
