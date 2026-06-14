"use client";

import { useMimir } from "@/lib/store";
import * as Icons from "../icons";

/**
 * Tools window. Lists every capability the model can call and lets you turn
 * each on or off and tune its parameters. Web search/fetch are the two that
 * can reach the network; the built-ins (remember, load_skill) stay local.
 *
 * Enabling/disabling here is the *master* switch — it controls whether a tool
 * is ever advertised to the model at all. The button above the chat input is a
 * lighter, per-conversation switch layered on top of these.
 */
export default function ToolsView() {
  const tools = useMimir((s) => s.settings.tools);
  const update = useMimir((s) => s.updateToolSettings);

  return (
    <div className="flex flex-col gap-5 p-5">
      <p className="max-w-xl text-sm leading-relaxed text-parchment-400">
        Tools are callable functions the model can invoke during a response —
        distinct from skills, which teach it how to approach a job. Toggle a
        tool off and it disappears from what the model is offered; nothing else
        in your conversations changes.
      </p>

      {/* Web search */}
      <ToolCard
        icon={<Icons.IconSearch className="h-4 w-4" />}
        name="web_search"
        title="Web search"
        enabled={tools.webSearch.enabled}
        onToggle={(v) => update({ webSearch: { enabled: v } })}
        description="Turns a query into ranked results from your self-hosted SearXNG instance. Only the search query leaves the machine, and it's shown in the tool chip."
      >
        <Field label="SearXNG URL">
          <input
            value={tools.webSearch.searxngUrl}
            onChange={(e) => update({ webSearch: { searxngUrl: e.target.value } })}
            placeholder="http://localhost:8888"
            spellCheck={false}
            className="w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 placeholder:text-parchment-600/60 focus:border-bronze-600 focus:outline-none"
          />
        </Field>
        <div className="flex gap-3">
          <Field label="Max results">
            <NumberInput
              value={tools.webSearch.maxResults}
              min={1}
              max={10}
              onChange={(n) => update({ webSearch: { maxResults: n } })}
            />
          </Field>
          <Field label="Safe search">
            <select
              value={tools.webSearch.safeSearch}
              onChange={(e) =>
                update({
                  webSearch: {
                    safeSearch: Number(e.target.value) as 0 | 1 | 2,
                  },
                })
              }
              className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
            >
              <option value={0}>Off</option>
              <option value={1}>Moderate</option>
              <option value={2}>Strict</option>
            </select>
          </Field>
        </div>
      </ToolCard>

      {/* Web fetch */}
      <ToolCard
        icon={<Icons.IconGlobe className="h-4 w-4" />}
        name="web_fetch"
        title="Web fetch"
        enabled={tools.webFetch.enabled}
        onToggle={(v) => update({ webFetch: { enabled: v } })}
        description="Downloads a single URL and returns its readable text, so the model can read a page in full — usually a result from web_search or a link you pasted."
      >
        <Field label="Max characters returned">
          <NumberInput
            value={tools.webFetch.maxChars}
            min={500}
            max={50000}
            step={500}
            onChange={(n) => update({ webFetch: { maxChars: n } })}
          />
        </Field>
        <p className="text-[11px] leading-relaxed text-parchment-600">
          Longer pages are truncated to this many characters before being handed
          to the model, keeping context usage in check.
        </p>
      </ToolCard>

      {/* Built-ins */}
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
          Built-in · local
        </div>
        <div className="flex flex-col gap-3">
          <ToolCard
            icon={<Icons.IconSpark className="h-4 w-4" />}
            name="remember"
            title="Remember"
            enabled={tools.builtins.remember}
            onToggle={(v) => update({ builtins: { remember: v } })}
            description="Lets the model save durable facts about you to long-term Memory. Stays entirely on this machine."
            compact
          />
          <ToolCard
            icon={<Icons.IconList className="h-4 w-4" />}
            name="load_skill"
            title="Load skill"
            enabled={tools.builtins.loadSkill}
            onToggle={(v) => update({ builtins: { loadSkill: v } })}
            description="Lets the model pull in the full instructions for one of your enabled skills on demand. Stays entirely on this machine."
            compact
          />
        </div>
      </div>
    </div>
  );
}

function ToolCard({
  icon,
  name,
  title,
  description,
  enabled,
  onToggle,
  children,
  compact,
}: {
  icon: React.ReactNode;
  name: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-lg border bg-ink-900 transition-colors",
        enabled ? "border-ink-700" : "border-ink-800",
        compact ? "p-3" : "p-4",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            enabled
              ? "border-bronze-600/50 bg-bronze-600/15 text-bronze-300"
              : "border-ink-700 text-parchment-600",
          ].join(" ")}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-parchment-100">{title}</span>
            <span className="font-mono text-[11px] text-parchment-600">{name}</span>
          </div>
          <p
            className={[
              "mt-0.5 text-xs leading-relaxed",
              enabled ? "text-parchment-400" : "text-parchment-600",
            ].join(" ")}
          >
            {description}
          </p>
        </div>
        <Switch enabled={enabled} onToggle={onToggle} label={`${title} tool`} />
      </div>
      {children && enabled && (
        <div className="mt-3 flex flex-col gap-3 border-t border-ink-700 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Switch({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={`${label} — ${enabled ? "enabled" : "disabled"}`}
      title={enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
      onClick={() => onToggle(!enabled)}
      className={[
        "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        enabled
          ? "border-bronze-500 bg-bronze-500/80"
          : "border-ink-700 bg-ink-800",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-3.5 w-3.5 transform rounded-full transition-transform",
          enabled ? "translate-x-4 bg-ink-950" : "translate-x-0.5 bg-parchment-400",
        ].join(" ")}
      />
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[11px] text-parchment-600">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n)) return;
        onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
      className="w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
    />
  );
}
