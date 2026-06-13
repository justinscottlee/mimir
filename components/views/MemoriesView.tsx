"use client";

import { useState } from "react";
import { useTalos } from "@/lib/store";
import { Memory } from "@/lib/types";
import { IconCheck, IconPlus, IconTrash } from "../icons";

export default function MemoriesView() {
  const memories = useTalos((s) => s.memories);
  const addMemory = useTalos((s) => s.addMemory);
  const updateMemory = useTalos((s) => s.updateMemory);
  const deleteMemory = useTalos((s) => s.deleteMemory);
  const toggleMemory = useTalos((s) => s.toggleMemory);

  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState("");

  const list = Object.values(memories).sort((a, b) => b.updatedAt - a.updatedAt);
  const enabledCount = list.filter((m) => m.enabled).length;

  function add() {
    const content = draft.trim();
    if (!content) return;
    addMemory(content, {
      category: draftCategory.trim() || undefined,
      source: "user",
    });
    setDraft("");
    setDraftCategory("");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Composer */}
      <div className="shrink-0 border-b border-ink-700 p-4">
        <p className="mb-3 text-xs leading-relaxed text-parchment-600">
          Facts here are background knowledge the model gets in every
          conversation. The model can also save its own (marked{" "}
          <span className="text-bronze-300">auto</span>). {enabledCount} of{" "}
          {list.length} active.
        </p>
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
            }}
            rows={2}
            placeholder="A fact to remember, e.g. “Prefers concise answers and TypeScript examples.”"
            className="resize-none rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value)}
              placeholder="category (optional)"
              className="w-40 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
            />
            <div className="flex-1" />
            <button
              onClick={add}
              disabled={!draft.trim()}
              className="flex items-center gap-1.5 rounded-md bg-bronze-500 px-3 py-1.5 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:opacity-30"
            >
              <IconPlus className="h-3.5 w-3.5" />
              Add memory
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center text-sm text-parchment-600">
            No memories yet. Add one above, or the model will as it learns about
            you.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                onToggle={() => toggleMemory(m.id)}
                onDelete={() => deleteMemory(m.id)}
                onSave={(content, category) =>
                  updateMemory(m.id, {
                    content,
                    category: category || undefined,
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MemoryRow({
  memory,
  onToggle,
  onDelete,
  onSave,
}: {
  memory: Memory;
  onToggle: () => void;
  onDelete: () => void;
  onSave: (content: string, category: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(memory.content);
  const [category, setCategory] = useState(memory.category ?? "");

  function save() {
    if (content.trim()) onSave(content.trim(), category.trim());
    setEditing(false);
  }

  return (
    <li
      className={[
        "group rounded-lg border bg-ink-900 p-3 transition-colors",
        memory.enabled ? "border-ink-700" : "border-ink-800 opacity-55",
      ].join(" ")}
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="resize-none rounded-md border border-bronze-600 bg-ink-850 px-2.5 py-1.5 text-sm text-parchment-100 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="category"
              className="w-36 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
            />
            <div className="flex-1" />
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-xs text-parchment-600 hover:text-parchment-100"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded-md bg-bronze-500 px-2.5 py-1 text-xs font-medium text-ink-950 hover:bg-bronze-400"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {/* Enable toggle */}
          <button
            onClick={onToggle}
            title={
              memory.enabled
                ? "Active — click to disable"
                : "Disabled — click to enable"
            }
            className={[
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
              memory.enabled
                ? "border-bronze-500 bg-bronze-500 text-ink-950"
                : "border-ink-700 text-transparent hover:border-parchment-600",
            ].join(" ")}
          >
            <IconCheck className="h-3 w-3" />
          </button>

          <div className="min-w-0 flex-1">
            <p
              className="cursor-text text-sm text-parchment-100"
              onClick={() => setEditing(true)}
              title="Click to edit"
            >
              {memory.content}
            </p>
            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-parchment-600">
              {memory.category && (
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-parchment-400">
                  {memory.category}
                </span>
              )}
              <span
                className={
                  memory.source === "auto" ? "text-bronze-300" : undefined
                }
              >
                {memory.source}
              </span>
            </div>
          </div>

          <button
            onClick={onDelete}
            className="rounded p-1 text-parchment-600 opacity-0 transition-opacity hover:bg-ink-800 hover:text-signal-err focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Delete memory"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}
