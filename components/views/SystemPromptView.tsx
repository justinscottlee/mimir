"use client";

import { useMemo, useState } from "react";
import { useMimir } from "@/lib/store";
import { SystemPrompt } from "@/lib/types";
import {
  advertisedToolNames,
  buildSystemSegments,
  findPreset,
  renderSystemPrompt,
  SystemPromptSegment,
} from "@/lib/systemPrompts";
import * as Icons from "../icons";
import ConfirmDelete from "../ConfirmDelete";

/**
 * System Prompt manager. Three jobs:
 *   1. Toggle built-in presets (e.g. the dynamic "current date" prompt).
 *   2. Create / edit / enable custom prompts, like the Skills window.
 *   3. Show the full system prompt actually sent — including the text generated
 *      from memories and skills — for complete transparency.
 */
export default function SystemPromptView() {
  const systemPrompts = useMimir((s) => s.systemPrompts);
  const memories = useMimir((s) => s.memories);
  const skills = useMimir((s) => s.skills);
  const tools = useMimir((s) => s.settings.tools);
  const addSystemPrompt = useMimir((s) => s.addSystemPrompt);
  const updateSystemPrompt = useMimir((s) => s.updateSystemPrompt);
  const deleteSystemPrompt = useMimir((s) => s.deleteSystemPrompt);
  const toggleSystemPrompt = useMimir((s) => s.toggleSystemPrompt);

  const [showFull, setShowFull] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const list = Object.values(systemPrompts);
  const presets = list
    .filter((p) => p.source === "preset")
    .sort((a, b) => a.createdAt - b.createdAt);
  const custom = list
    .filter((p) => p.source === "user")
    .sort((a, b) => a.createdAt - b.createdAt);
  const enabledCount = list.filter((p) => p.enabled).length;

  const segments = useMemo(
    () =>
      buildSystemSegments({
        systemPrompts: list,
        memories: Object.values(memories),
        skills: Object.values(skills),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [systemPrompts, memories, skills]
  );
  const toolNames = advertisedToolNames(tools, true);

  function addCustom() {
    const body = draftBody.trim();
    if (!body) return;
    addSystemPrompt({
      name: draftName.trim() || "Custom prompt",
      description: draftDesc.trim() || undefined,
      body,
    });
    setDraftName("");
    setDraftDesc("");
    setDraftBody("");
    setAdding(false);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header + full-prompt control */}
      <div className="shrink-0 border-b border-ink-700 p-4">
        <p className="mb-3 text-xs leading-relaxed text-parchment-600">
          These prompts are sent ahead of every conversation. Toggle the presets
          you want, add your own, and use “View full system prompt” to see
          exactly what the model receives — including the text generated from
          your memories and skills. {enabledCount} prompt
          {enabledCount === 1 ? "" : "s"} active.
        </p>
        <button
          onClick={() => setShowFull((v) => !v)}
          className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-parchment-100 transition-colors hover:bg-ink-800"
        >
          <Icons.IconDoc className="h-4 w-4 text-bronze-400" />
          {showFull ? "Hide full system prompt" : "View full system prompt"}
          <Icons.IconChevron
            className={[
              "h-4 w-4 transition-transform",
              showFull ? "" : "-rotate-90",
            ].join(" ")}
          />
        </button>
        {showFull && (
          <FullPromptPanel segments={segments} toolNames={toolNames} />
        )}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <SectionHeading>Presets</SectionHeading>
        <ul className="mb-5 flex flex-col gap-2">
          {presets.map((p) => (
            <PresetRow
              key={p.id}
              prompt={p}
              onToggle={() => toggleSystemPrompt(p.id)}
            />
          ))}
        </ul>

        <div className="mb-2 flex items-center justify-between">
          <SectionHeading inline>Custom</SectionHeading>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-md bg-bronze-500 px-2.5 py-1 text-xs font-medium text-ink-950 transition-colors hover:bg-bronze-400"
            >
              <Icons.IconPlus className="h-4 w-4" />
              New prompt
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-bronze-600/50 bg-ink-900 p-3">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Name, e.g. “House style”"
              className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
            />
            <input
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Short description (optional)"
              className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addCustom();
              }}
              rows={4}
              placeholder="The system prompt text the model should receive…"
              className="resize-none rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm leading-relaxed text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-parchment-600">
                ⌘/Ctrl + Enter to add
              </span>
              <div className="flex-1" />
              <button
                onClick={() => {
                  setAdding(false);
                  setDraftName("");
                  setDraftDesc("");
                  setDraftBody("");
                }}
                className="rounded-md px-2 py-1 text-xs text-parchment-600 hover:text-parchment-100"
              >
                Cancel
              </button>
              <button
                onClick={addCustom}
                disabled={!draftBody.trim()}
                className="rounded-md bg-bronze-500 px-2.5 py-1 text-xs font-medium text-ink-950 hover:bg-bronze-400 disabled:opacity-30"
              >
                Add prompt
              </button>
            </div>
          </div>
        )}

        {custom.length === 0 && !adding ? (
          <div className="rounded-lg border border-dashed border-ink-700 p-6 text-center text-sm text-parchment-600">
            No custom prompts yet. Add one to inject your own standing
            instructions into every conversation.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {custom.map((p) => (
              <CustomRow
                key={p.id}
                prompt={p}
                onToggle={() => toggleSystemPrompt(p.id)}
                onDelete={() => deleteSystemPrompt(p.id)}
                onSave={(patch) => updateSystemPrompt(p.id, patch)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FullPromptPanel({
  segments,
  toolNames,
}: {
  segments: SystemPromptSegment[];
  toolNames: string[];
}) {
  const [copied, setCopied] = useState(false);
  const full = segments.map((s) => s.text).join("\n\n");

  function copy() {
    navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
          Sent to the model
        </span>
        <div className="flex-1" />
        {segments.length > 0 && (
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
          >
            {copied ? (
              <Icons.IconCheck className="h-4 w-4 text-signal-ok" />
            ) : (
              <Icons.IconCopy className="h-4 w-4" />
            )}
            {copied ? "Copied" : "Copy all"}
          </button>
        )}
      </div>

      {segments.length === 0 ? (
        <p className="text-xs italic text-parchment-600">
          No system prompt is being sent — every prompt, memory, and skill is
          currently disabled.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {segments.map((seg, i) => (
            <div
              key={`${seg.label}-${i}`}
              className="overflow-hidden rounded-md border border-ink-700 bg-ink-900"
            >
              <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-2.5 py-1">
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    seg.origin === "memories" || seg.origin === "skills"
                      ? "bg-parchment-600"
                      : "bg-bronze-400",
                  ].join(" ")}
                />
                <span className="text-xs font-medium text-parchment-100">
                  {seg.label}
                </span>
                <span className="font-mono text-[10px] text-parchment-600">
                  {originLabel(seg.origin)}
                </span>
              </div>
              <pre className="whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-relaxed text-parchment-400">
                {seg.text}
              </pre>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 border-t border-ink-700 pt-2 text-[11px] leading-relaxed text-parchment-600">
        {toolNames.length > 0 ? (
          <>
            Also sent as callable tools (function schemas, not part of the text
            above):{" "}
            <span className="font-mono text-parchment-400">
              {toolNames.join(", ")}
            </span>
            . Web tools also depend on each conversation’s web-search toggle.
          </>
        ) : (
          <>No tools are currently advertised to the model.</>
        )}
      </div>
    </div>
  );
}

function PresetRow({
  prompt,
  onToggle,
}: {
  prompt: SystemPrompt;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const preset = prompt.presetKey ? findPreset(prompt.presetKey) : undefined;
  const body = renderSystemPrompt(prompt);

  return (
    <li
      className={[
        "rounded-lg border bg-ink-900 transition-colors",
        prompt.enabled ? "border-ink-700" : "border-ink-800 opacity-60",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 p-3">
        <ToggleBox enabled={prompt.enabled} onToggle={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-parchment-100">
              {prompt.name}
            </span>
            {preset?.dynamic && (
              <span className="rounded bg-bronze-600/20 px-1.5 py-0.5 font-mono text-[10px] text-bronze-300">
                dynamic
              </span>
            )}
          </div>
          {prompt.description && (
            <p className="mt-0.5 text-xs leading-relaxed text-parchment-400">
              {prompt.description}
            </p>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-parchment-600 transition-colors hover:text-parchment-400"
          >
            <Icons.IconChevron
              className={[
                "h-3.5 w-3.5 transition-transform",
                open ? "" : "-rotate-90",
              ].join(" ")}
            />
            {open ? "Hide text" : "Preview text"}
          </button>
          {open && (
            <pre className="mt-2 whitespace-pre-wrap rounded-md border border-ink-700 bg-ink-950/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-parchment-400">
              {body}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}

function CustomRow({
  prompt,
  onToggle,
  onDelete,
  onSave,
}: {
  prompt: SystemPrompt;
  onToggle: () => void;
  onDelete: () => void;
  onSave: (patch: { name?: string; description?: string; body?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(prompt.name);
  const [desc, setDesc] = useState(prompt.description ?? "");
  const [body, setBody] = useState(prompt.body);

  function save() {
    if (!body.trim()) return;
    onSave({
      name: name.trim() || "Custom prompt",
      description: desc.trim() || undefined,
      body,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-bronze-600/50 bg-ink-900 p-3">
        <div className="flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-parchment-100 focus:border-bronze-600 focus:outline-none"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Short description (optional)"
            className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="resize-none rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm leading-relaxed text-parchment-100 focus:border-bronze-600 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <button
              onClick={() => {
                setEditing(false);
                setName(prompt.name);
                setDesc(prompt.description ?? "");
                setBody(prompt.body);
              }}
              className="rounded-md px-2 py-1 text-xs text-parchment-600 hover:text-parchment-100"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!body.trim()}
              className="rounded-md bg-bronze-500 px-2.5 py-1 text-xs font-medium text-ink-950 hover:bg-bronze-400 disabled:opacity-30"
            >
              Save
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      className={[
        "group rounded-lg border bg-ink-900 p-3 transition-colors",
        prompt.enabled ? "border-ink-700" : "border-ink-800 opacity-60",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <ToggleBox enabled={prompt.enabled} onToggle={onToggle} />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-parchment-100">
            {prompt.name}
          </span>
          {prompt.description && (
            <p className="mt-0.5 text-xs leading-relaxed text-parchment-400">
              {prompt.description}
            </p>
          )}
          <p
            onClick={() => setEditing(true)}
            title="Click to edit"
            className="mt-1.5 cursor-text whitespace-pre-wrap rounded-md border border-ink-700 bg-ink-950/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-parchment-400"
          >
            {prompt.body}
          </p>
        </div>
        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <ConfirmDelete
            label="Delete prompt"
            message="Delete? Can't be undone."
            onConfirm={onDelete}
          />
        </div>
      </div>
    </li>
  );
}

function ToggleBox({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={enabled ? "Active — click to disable" : "Disabled — click to enable"}
      className={[
        "mt-0.5 relative flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors md:h-4 md:w-4 max-md:before:absolute max-md:before:-inset-1.5 max-md:before:rounded-md max-md:before:content-['']",
        enabled
          ? "border-bronze-500 bg-bronze-500 text-ink-950"
          : "border-ink-700 text-transparent hover:border-parchment-600",
      ].join(" ")}
    >
      <Icons.IconCheck className="h-4 w-4" />
    </button>
  );
}

function SectionHeading({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <div
      className={[
        "font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600",
        inline ? "" : "mb-2",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function originLabel(origin: SystemPromptSegment["origin"]): string {
  switch (origin) {
    case "preset":
      return "preset";
    case "custom":
      return "custom";
    case "memories":
      return "from Memories";
    case "skills":
      return "from Skills";
  }
}
