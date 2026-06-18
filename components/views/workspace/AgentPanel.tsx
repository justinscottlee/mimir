"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMimir } from "@/lib/store";
import { AgentRun, TurnOutcome } from "@/lib/types";
import { WorkspaceRunner } from "@/lib/workspace/useWorkspaceRunner";
import * as Icons from "@/components/icons";
import ConfirmDelete from "@/components/ConfirmDelete";
import Markdown from "@/components/Markdown";
import { RunStatusBadge, StepBody } from "./shared";

type SubView = "transcript" | "terminal";

/**
 * Shows the currently selected workspace agent: its turn-by-turn transcript,
 * where each user prompt is followed by the steps it drove and the green summary
 * that turn finished with, pinned inline. Which agent is shown is chosen from
 * the workspace's right-hand agent sidebar — this panel only renders the
 * selected one. The active run streams live while its loop runs, and finished
 * agents can be re-prompted from the composer below.
 */
export default function AgentPanel({
  workspaceId,
  activeRunId,
  running,
  runner,
  onSelectRun,
  onOpenFile,
}: {
  workspaceId: string;
  activeRunId: string | null;
  running: boolean;
  runner: WorkspaceRunner;
  onSelectRun: (runId: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const runs = useMimir((s) => s.workspaces[workspaceId]?.runs ?? []);
  const deleteRun = useMimir((s) => s.deleteWorkspaceRun);
  const clearRuns = useMimir((s) => s.clearWorkspaceRuns);

  const [sub, setSub] = useState<SubView>("transcript");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const activeRun: AgentRun | undefined = useMemo(() => {
    if (runs.length === 0) return undefined;
    return (
      runs.find((r) => r.id === activeRunId) ?? runs[runs.length - 1]
    );
  }, [runs, activeRunId]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const lastStepContent =
    activeRun?.steps[activeRun.steps.length - 1]?.content ?? "";
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeRun?.id, activeRun?.steps.length, lastStepContent, sub, running]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [activeRun?.id]);

  if (!activeRun) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Icons.IconTerminal className="h-8 w-8 text-parchment-600" />
        <div className="max-w-sm text-sm text-parchment-400">
          No agents yet. Describe a task below and press{" "}
          <span className="text-parchment-100">Run</span> — the agent will plan,
          work in this sandbox, and every step shows up here. You can re-prompt it
          afterward to keep going in the same context.
        </div>
      </div>
    );
  }

  const isActiveLive = running && activeRun.status === "running";

  return (
    <div className="flex h-full flex-col">
      {/* Header: which agent is in view + status + actions. Navigation between
          agents lives in the right sidebar, not here. */}
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Icons.IconSpark className="h-4 w-4 shrink-0 text-bronze-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-parchment-100">
          {activeRun.title ?? activeRun.goal}
        </span>
        <RunStatusBadge status={activeRun.status} />
        <div className="flex items-center rounded-md border border-ink-700 p-0.5">
          <SubTab label="Transcript" active={sub === "transcript"} onClick={() => setSub("transcript")} />
          <SubTab label="Log" active={sub === "terminal"} onClick={() => setSub("terminal")} />
        </div>
        <ConfirmDelete
          label="Delete this agent"
          message="Delete agent?"
          onConfirm={() => {
            const remaining = runs.filter((r) => r.id !== activeRun.id);
            deleteRun(workspaceId, activeRun.id);
            onSelectRun(remaining[remaining.length - 1]?.id ?? "");
          }}
        />
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink-700 bg-ink-900/40 px-3 py-1.5 font-mono text-[10px] text-parchment-600">
        <span>{activeRun.steps.length} steps</span>
        <span>{(activeRun.prompts?.length ?? 1)} prompts</span>
        <span>{activeRun.totalTokens.toLocaleString()} out tokens</span>
        {activeRun.model && <span className="truncate">{activeRun.model}</span>}
        {activeRun.finishedAt && activeRun.status !== "running" && (
          <span>{formatDuration(activeRun.finishedAt - activeRun.createdAt)}</span>
        )}
        {runs.length > 1 && (
          <button
            onClick={() => {
              clearRuns(workspaceId);
              onSelectRun("");
            }}
            className="ml-auto text-parchment-600 underline transition-colors hover:text-signal-err"
          >
            Clear all agents
          </button>
        )}
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {sub === "transcript" ? (
          <Transcript run={activeRun} live={isActiveLive} />
        ) : (
          <Terminal run={activeRun} />
        )}
      </div>
    </div>
  );
}

function Transcript({
  run,
  live,
}: {
  run: AgentRun;
  live: boolean;
}) {
  const prompts = run.prompts ?? (run.goal ? [run.goal] : []);

  // Group steps by their turn so each prompt is shown with the work it drove.
  const stepsByTurn = useMemo(() => {
    const map = new Map<number, AgentRun["steps"]>();
    for (const step of run.steps) {
      const t = step.turn ?? 0;
      const list = map.get(t) ?? [];
      list.push(step);
      map.set(t, list);
    }
    return map;
  }, [run.steps]);

  // Each turn's outcome (summary / error), keyed by turn index, so it renders
  // inline right where that turn finished instead of floating at the bottom.
  const outcomeByTurn = useMemo(() => {
    const map = new Map<number, TurnOutcome>();
    for (const o of run.turns ?? []) map.set(o.turn, o);
    return map;
  }, [run.turns]);

  const turnCount = Math.max(prompts.length, ...[...stepsByTurn.keys()].map((k) => k + 1), 1);
  const lastTurn = turnCount - 1;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {Array.from({ length: turnCount }).map((_, turn) => {
        const steps = stepsByTurn.get(turn) ?? [];
        const outcome = outcomeByTurn.get(turn);
        return (
          <div key={turn} className="flex flex-col gap-3">
            {/* The user prompt that opened this turn. */}
            {prompts[turn] != null && (
              <div className="self-end max-w-[85%] rounded-lg rounded-br-sm border border-bronze-600/40 bg-bronze-600/10 px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-bronze-400">
                  {turn === 0 ? "Goal" : "You"}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-parchment-100">
                  {prompts[turn]}
                </div>
              </div>
            )}

            {steps.map((step, i) => {
              const isLastStepOfRun =
                turn === lastTurn && i === steps.length - 1;
              return (
                <div key={step.index} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bronze-400">
                      Step {step.index + 1}
                    </span>
                    <span className="h-px flex-1 bg-ink-700" />
                    {step.meta?.completionTokens != null && (
                      <span className="font-mono text-[10px] text-parchment-600">
                        {step.meta.completionTokens} tok
                        {step.meta.tokensPerSecond
                          ? ` · ${Math.round(step.meta.tokensPerSecond)} t/s`
                          : ""}
                      </span>
                    )}
                  </div>
                  <StepBody
                    content={step.content}
                    isStreaming={live && isLastStepOfRun}
                    toolEvents={step.toolEvents}
                    thinkingMs={step.meta?.thinkingMs}
                  />
                </div>
              );
            })}

            {/* This turn's outcome, pinned inline so it stays put as later
                turns are added below it. */}
            {outcome?.summary && <TurnSummary text={outcome.summary} />}
            {outcome?.error && <TurnError text={outcome.error} />}
          </div>
        );
      })}

      {/* When idle, a gentle hint that the agent can be continued. */}
      {!live &&
        (run.status === "idle" ||
          run.status === "done" ||
          run.status === "stalled" ||
          run.status === "stopped") && (
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-parchment-600">
            <Icons.IconSpark className="h-3.5 w-3.5 text-bronze-400" />
            This agent is waiting — send another instruction below to continue.
          </div>
        )}
    </div>
  );
}

function TurnSummary({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-signal-ok/40 bg-signal-ok/10 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-signal-ok">
        <Icons.IconCheck className="h-3.5 w-3.5" />
        Summary
      </div>
      <div className="text-sm text-parchment-100">
        <Markdown content={text} />
      </div>
    </div>
  );
}

function TurnError({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-signal-err/40 bg-signal-err/10 px-3 py-2 text-sm text-signal-err">
      {text}
    </div>
  );
}

/* -------------------------------- terminal ------------------------------- */

function Terminal({ run }: { run: AgentRun }) {
  const lines: { cmd: string; result: string; error: boolean }[] = [];
  for (const step of run.steps) {
    for (const ev of step.toolEvents) {
      lines.push({
        cmd: `${ev.name} ${describeArgs(ev.name, ev.args)}`.trim(),
        result: firstLine(ev.result),
        error: ev.result.startsWith("Error:"),
      });
    }
  }

  if (lines.length === 0) {
    return (
      <div className="px-4 py-6 text-center font-mono text-xs text-parchment-600">
        No tool calls in this run.
      </div>
    );
  }

  return (
    <div className="px-4 py-3 font-mono text-xs leading-relaxed">
      {lines.map((l, i) => (
        <div key={i} className="mb-1.5">
          <div className="flex gap-2 text-parchment-100">
            <span className="select-none text-bronze-400">$</span>
            <span className="break-all">{l.cmd}</span>
          </div>
          <div
            className={[
              "flex gap-2 break-all",
              l.error ? "text-signal-err" : "text-parchment-400",
            ].join(" ")}
          >
            <span className="select-none">{l.error ? "✗" : "→"}</span>
            <span>{l.result}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SubTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded px-2 py-0.5 text-xs transition-colors",
        active
          ? "bg-ink-800 text-parchment-100"
          : "text-parchment-600 hover:text-parchment-100",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/* -------------------------------- helpers -------------------------------- */

function describeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "move_path") {
    return `${str(args.from)} ${str(args.to)}`.trim();
  }
  if (name === "run_command") return str(args.command);
  if (name === "set_plan_item_status") return `${str(args.id)} → ${str(args.status)}`;
  return str(args.path);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function firstLine(s: string): string {
  const line = s.split("\n")[0] ?? "";
  return line.length > 160 ? line.slice(0, 160) + "…" : line;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}
