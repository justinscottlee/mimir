"use client";

import { useEffect, useRef, useState } from "react";
import { useMimir } from "@/lib/store";
import { AGENT_PERSONAS, getPersona } from "@/lib/workspace/agentPrompts";
import { AgentPersonaKey } from "@/lib/types";
import * as Icons from "@/components/icons";

/**
 * A popover for tuning the agent loop: which persona (how methodical it is),
 * how many steps it may take, its output token budget, whether it may spawn
 * sub-agents, and standing instructions folded into every run's system prompt.
 * Edits write straight to the workspace's agent config.
 */
export default function AgentSettings({
  workspaceId,
  disabled,
}: {
  workspaceId: string;
  disabled?: boolean;
}) {
  const agent = useMimir((s) => s.workspaces[workspaceId]?.agent);
  const setConfig = useMimir((s) => s.setWorkspaceAgentConfig);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!agent) return null;

  const persona = getPersona(agent.persona);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Agent settings"
        aria-label="Agent settings"
        className={[
          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
          open
            ? "border-bronze-600 bg-bronze-600/15 text-bronze-300"
            : "border-ink-700 text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
        ].join(" ")}
      >
        <Icons.IconSliders className="h-4 w-4" />
        <span className="hidden sm:inline">
          {agent.maxSteps} steps · {compact(agent.maxTokens)} tok
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-80 rounded-lg border border-ink-700 bg-ink-900 p-3 shadow-xl shadow-ink-950/50">
          {/* Persona */}
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Agent style
          </div>
          <select
            value={agent.persona ?? "standard"}
            disabled={disabled}
            onChange={(e) =>
              setConfig(workspaceId, {
                persona: e.target.value as AgentPersonaKey,
              })
            }
            className="w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none disabled:opacity-50"
          >
            {AGENT_PERSONAS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-relaxed text-parchment-600">
            {persona.description}
          </p>

          {/* Limits */}
          <div className="mb-2 mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Agent limits
          </div>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-parchment-600">Max steps</span>
              <Num
                value={agent.maxSteps}
                min={1}
                max={50}
                disabled={disabled}
                onChange={(n) => setConfig(workspaceId, { maxSteps: n })}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-parchment-600">Token budget</span>
              <Num
                value={agent.maxTokens}
                min={512}
                max={200000}
                step={512}
                disabled={disabled}
                onChange={(n) => setConfig(workspaceId, { maxTokens: n })}
              />
            </label>
          </div>

          {/* Standing instructions */}
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-xs text-parchment-600">
              Standing instructions
            </span>
            <textarea
              value={agent.instructions ?? ""}
              disabled={disabled}
              onChange={(e) =>
                setConfig(workspaceId, { instructions: e.target.value })
              }
              rows={3}
              placeholder="Optional: conventions or constraints applied to every run (e.g. 'Write Python 3, prefer the standard library')."
              spellCheck={false}
              className="resize-none rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs leading-relaxed text-parchment-100 placeholder:text-parchment-600/70 focus:border-bronze-600 focus:outline-none disabled:opacity-50"
            />
          </label>

          <p className="mt-2 text-[11px] leading-relaxed text-parchment-600">
            Each turn ends when the agent finishes, hits {agent.maxSteps} steps,
            or spends {compact(agent.maxTokens)} output tokens — whichever comes
            first. You can re-prompt it afterward to continue.
          </p>
        </div>
      )}
    </div>
  );
}

function Num({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n)) return;
        onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
      className="w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none disabled:opacity-50"
    />
  );
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}
