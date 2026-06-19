"use client";

import { useMimir } from "@/lib/store";
import { DEFAULT_CONTEXT_MANAGEMENT } from "@/lib/defaults";
import { ContextManagementSettings } from "@/lib/types";
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
  const setSettings = useMimir((s) => s.setSettings);
  const ctx =
    useMimir((s) => s.settings.contextManagement) ?? DEFAULT_CONTEXT_MANAGEMENT;

  // Patch a nested slice of contextManagement, preserving the rest.
  const patchPruning = (
    p: Partial<ContextManagementSettings["toolPruning"]>
  ) =>
    setSettings({
      contextManagement: { ...ctx, toolPruning: { ...ctx.toolPruning, ...p } },
    });
  const patchSummary = (
    p: Partial<ContextManagementSettings["summarization"]>
  ) =>
    setSettings({
      contextManagement: {
        ...ctx,
        summarization: { ...ctx.summarization, ...p },
      },
    });
  const togglePrunedTool = (name: string, on: boolean) => {
    const set = new Set(ctx.toolPruning.tools);
    if (on) set.add(name);
    else set.delete(name);
    patchPruning({ tools: [...set] });
  };

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
        <p className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-[11px] leading-relaxed text-parchment-600">
          The SearXNG instance is configured by the server (the{" "}
          <span className="font-mono text-parchment-400">SEARXNG_URL</span>{" "}
          environment variable) — the bundled docker-compose points it at the
          internal SearXNG automatically. There's no per-user URL, so a search
          can only ever reach the instance the operator chose.
        </p>
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
        <Field label="Minimum seconds between searches (throttle)">
          <NumberInput
            value={Math.round((tools.webSearch.throttleMs ?? 0) / 1000)}
            min={0}
            max={120}
            onChange={(n) =>
              update({ webSearch: { throttleMs: Math.max(0, n) * 1000 } })
            }
          />
          <p className="mt-1 text-[11px] leading-relaxed text-parchment-600">
            Spaces out and serializes web searches across all conversations and
            agents. Raise this if your search engine starts rate-limiting or
            captcha-blocking you. 0 means no throttle.
          </p>
        </Field>
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
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-parchment-600">
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

      {/* Context management */}
      <div>
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-parchment-600">
          Context management
        </div>
        <p className="mb-3 max-w-xl text-[11px] leading-relaxed text-parchment-600">
          Keeps long sessions within a bounded context window using brief,
          one-shot calls to the same model. Applies to both conversations and
          workspace agents.
        </p>

        <div className="flex flex-col gap-3">
          {/* Tool-output pruning */}
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="flex items-start gap-3">
              <Icons.IconWrench className="mt-0.5 h-4 w-4 shrink-0 text-bronze-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-parchment-100">
                    Tool-output pruning
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-parchment-400">
                  Verbose tool results are handed to a transient model instance
                  that distills them to what's relevant — keyed to the call (the
                  query, URL, or command) — before they enter context.
                </p>
              </div>
              <Switch
                enabled={ctx.toolPruning.enabled}
                onToggle={(v) => patchPruning({ enabled: v })}
                label="Tool-output pruning"
              />
            </div>
            {ctx.toolPruning.enabled && (
              <div className="mt-3 flex flex-col gap-3 border-t border-ink-700 pt-3">
                <Field label="Only prune outputs longer than (characters)">
                  <NumberInput
                    value={ctx.toolPruning.thresholdChars}
                    min={500}
                    max={100000}
                    step={500}
                    onChange={(n) => patchPruning({ thresholdChars: n })}
                  />
                </Field>
                <div>
                  <div className="mb-1.5 text-xs text-parchment-600">
                    Tools to prune
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRUNABLE_TOOLS.map((t) => {
                      const on = ctx.toolPruning.tools.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => togglePrunedTool(t, !on)}
                          aria-pressed={on}
                          className={[
                            "flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
                            on
                              ? "border-bronze-600/60 bg-bronze-600/15 text-bronze-300"
                              : "border-ink-700 text-parchment-600 hover:border-parchment-600 hover:text-parchment-400",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "h-1.5 w-1.5 rounded-full",
                              on ? "bg-bronze-400" : "bg-ink-700",
                            ].join(" ")}
                          />
                          {t}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-parchment-600">
                    read_file is intentionally left out by default — agents need
                    a file's exact contents to edit it.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Recursive summarization */}
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="flex items-start gap-3">
              <Icons.IconSliders className="mt-0.5 h-4 w-4 shrink-0 text-bronze-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-parchment-100">
                    Recursive summarization
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-parchment-400">
                  Once the working history grows past the token threshold, the
                  oldest turns are compressed into a memory block and the most
                  recent ones are kept verbatim.
                </p>
              </div>
              <Switch
                enabled={ctx.summarization.enabled}
                onToggle={(v) => patchSummary({ enabled: v })}
                label="Recursive summarization"
              />
            </div>
            {ctx.summarization.enabled && (
              <div className="mt-3 flex flex-col gap-3 border-t border-ink-700 pt-3">
                <Field label="Summarize when context exceeds (≈ tokens)">
                  <NumberInput
                    value={ctx.summarization.thresholdTokens}
                    min={2000}
                    max={500000}
                    step={1000}
                    onChange={(n) => patchSummary({ thresholdTokens: n })}
                  />
                </Field>
                <Field label="Recent messages to always keep">
                  <NumberInput
                    value={ctx.summarization.keepRecent}
                    min={2}
                    max={50}
                    step={1}
                    onChange={(n) => patchSummary({ keepRecent: n })}
                  />
                </Field>
                <p className="text-[11px] leading-relaxed text-parchment-600">
                  Token counts are estimated (~4 chars/token), so treat the
                  threshold as approximate.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tools offered for output pruning in the settings UI. */
const PRUNABLE_TOOLS = ["web_search", "web_fetch", "run_command", "read_file"];

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
            <span className="font-mono text-xs text-parchment-600">{name}</span>
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
        "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors md:h-5 md:w-9",
        "max-md:before:absolute max-md:before:-inset-2 max-md:before:content-['']",
        enabled
          ? "border-bronze-500 bg-bronze-500/80"
          : "border-ink-700 bg-ink-800",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full transition-transform md:h-3.5 md:w-3.5",
          enabled
            ? "translate-x-[1.125rem] bg-ink-850"
            : "translate-x-0.5 bg-parchment-400",
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
      <span className="text-xs text-parchment-600">{label}</span>
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
