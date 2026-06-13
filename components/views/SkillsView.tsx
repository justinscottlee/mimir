"use client";

import { useState } from "react";
import { useMimir } from "@/lib/store";
import { Skill } from "@/lib/types";
import { parseSkillMarkdown } from "@/lib/skills";
import { IconCheck, IconPlus } from "../icons";
import ConfirmDelete from "../ConfirmDelete";

type Mode =
  | { kind: "list" }
  | { kind: "import" }
  | { kind: "edit"; id: string };

export default function SkillsView() {
  const skills = useMimir((s) => s.skills);
  const toggleSkill = useMimir((s) => s.toggleSkill);
  const deleteSkill = useMimir((s) => s.deleteSkill);

  const [mode, setMode] = useState<Mode>({ kind: "list" });

  const list = Object.values(skills).sort((a, b) => b.updatedAt - a.updatedAt);
  const enabledCount = list.filter((s) => s.enabled).length;

  if (mode.kind === "import") {
    return <ImportSkill onDone={() => setMode({ kind: "list" })} />;
  }
  if (mode.kind === "edit") {
    const skill = skills[mode.id];
    if (!skill) {
      return (
        <div className="p-5 text-sm text-parchment-600">
          This skill no longer exists.
        </div>
      );
    }
    return <EditSkill skill={skill} onDone={() => setMode({ kind: "list" })} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 p-4">
        <p className="flex-1 text-xs leading-relaxed text-parchment-600">
          Reusable procedures the model loads on demand. Enabled skills appear
          in the model&apos;s menu; it pulls the full instructions only when a
          task matches. {enabledCount} of {list.length} active.
        </p>
        <button
          onClick={() => setMode({ kind: "import" })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-bronze-500 px-3 py-1.5 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400"
        >
          <IconPlus className="h-3.5 w-3.5" />
          Add skill
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center text-sm text-parchment-600">
            No skills yet. Add one by pasting a SKILL.md.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((s) => (
              <SkillRow
                key={s.id}
                skill={s}
                onToggle={() => toggleSkill(s.id)}
                onDelete={() => deleteSkill(s.id)}
                onEdit={() => setMode({ kind: "edit", id: s.id })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  onToggle,
  onDelete,
  onEdit,
}: {
  skill: Skill;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <li
      className={[
        "group rounded-lg border bg-ink-900 p-3 transition-colors",
        skill.enabled ? "border-ink-700" : "border-ink-800 opacity-55",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          title={skill.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
          className={[
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            skill.enabled
              ? "border-bronze-500 bg-bronze-500 text-ink-950"
              : "border-ink-700 text-transparent hover:border-parchment-600",
          ].join(" ")}
        >
          <IconCheck className="h-3 w-3" />
        </button>

        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={onEdit}
          title="Click to edit"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-parchment-100">
              {skill.name}
            </span>
            {skill.scripts.length > 0 && (
              <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-parchment-400">
                {skill.scripts.length} script
                {skill.scripts.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-parchment-400">
            {skill.description}
          </p>
        </div>

        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <ConfirmDelete
            label={`Delete ${skill.name}`}
            message="Delete? Can't be undone."
            onConfirm={onDelete}
          />
        </div>
      </div>
    </li>
  );
}

function ImportSkill({ onDone }: { onDone: () => void }) {
  const addSkill = useMimir((s) => s.addSkill);
  const [raw, setRaw] = useState(SAMPLE_SKILL);

  const parsed = parseSkillMarkdown(raw);

  function save() {
    if (!raw.trim()) return;
    addSkill({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      scripts: parsed.scripts,
    });
    onDone();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 p-4">
        <button
          onClick={onDone}
          className="text-sm text-parchment-400 hover:text-parchment-100"
        >
          ← Back
        </button>
        <span className="flex-1 text-sm font-medium text-parchment-100">
          Add skill
        </span>
        <button
          onClick={save}
          className="rounded-md bg-bronze-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-bronze-400"
        >
          Save skill
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-2 text-xs text-parchment-600">
          Paste a SKILL.md. Frontmatter (<span className="font-mono">name</span>,{" "}
          <span className="font-mono">description</span>) is parsed if present;
          otherwise the first heading and paragraph are used.
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          rows={14}
          className="w-full resize-y rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs leading-relaxed text-parchment-100 focus:border-bronze-600 focus:outline-none"
        />

        {/* Live parse preview */}
        <div className="mt-4 rounded-md border border-ink-700 bg-ink-900 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
            Parsed as
          </div>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-parchment-600">name</dt>
              <dd className="font-mono text-parchment-100">{parsed.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-parchment-600">description</dt>
              <dd className="text-parchment-400">{parsed.description}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-parchment-600">scripts</dt>
              <dd className="font-mono text-parchment-400">
                {parsed.scripts.length > 0
                  ? parsed.scripts.join(", ")
                  : "none"}
              </dd>
            </div>
          </dl>
          {parsed.scripts.length > 0 && (
            <p className="mt-3 rounded border border-bronze-600/40 bg-bronze-600/10 px-2.5 py-1.5 text-[11px] text-bronze-300">
              This skill references scripts. The model can read its instructions
              now, but running scripts needs the workspace sandbox, which
              isn&apos;t built yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function EditSkill({ skill, onDone }: { skill: Skill; onDone: () => void }) {
  const updateSkill = useMimir((s) => s.updateSkill);
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [body, setBody] = useState(skill.body);

  function save() {
    updateSkill(skill.id, {
      name: name.trim() || skill.name,
      description: description.trim(),
      body,
    });
    onDone();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 p-4">
        <button
          onClick={onDone}
          className="text-sm text-parchment-400 hover:text-parchment-100"
        >
          ← Back
        </button>
        <span className="flex-1 truncate text-sm font-medium text-parchment-100">
          Edit {skill.name}
        </span>
        <button
          onClick={save}
          className="rounded-md bg-bronze-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-bronze-400"
        >
          Save
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <label className="block text-xs text-parchment-600">name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 font-mono text-sm text-parchment-100 focus:border-bronze-600 focus:outline-none"
        />

        <label className="mt-4 block text-xs text-parchment-600">
          description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full resize-none rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-parchment-100 focus:border-bronze-600 focus:outline-none"
        />

        <label className="mt-4 block text-xs text-parchment-600">
          SKILL.md body
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          rows={12}
          className="mt-1 w-full resize-y rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs leading-relaxed text-parchment-100 focus:border-bronze-600 focus:outline-none"
        />

        {skill.scripts.length > 0 && (
          <div className="mt-4">
            <label className="block text-xs text-parchment-600">scripts</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {skill.scripts.map((s) => (
                <span
                  key={s}
                  className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-parchment-400"
                >
                  {s}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-parchment-600">
              Script execution requires the workspace sandbox (not yet built).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLE_SKILL = `---
name: commit-message
description: Write a clear conventional-commit message from a diff or change summary.
---

# Commit message

When the user asks for a commit message:

1. Identify the change type (feat, fix, docs, refactor, chore).
2. Write a concise subject line under 60 characters in the imperative mood.
3. Add a body only if the change needs explanation — what and why, not how.

Format:

\`\`\`
type(scope): subject

body
\`\`\`
`;
