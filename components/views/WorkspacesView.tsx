"use client";

import { useMemo, useState } from "react";
import { useMimir } from "@/lib/store";
import { WorkspaceFile } from "@/lib/types";
import { IconCheck, IconSearch } from "../icons";
import ConfirmDelete from "../ConfirmDelete";

function countFiles(files: WorkspaceFile[]): number {
  return files.filter((f) => f.type === "file").length;
}

export default function WorkspacesView() {
  const workspaces = useMimir((s) => s.workspaces);
  const openWorkspace = useMimir((s) => s.openWorkspace);
  const deleteWorkspace = useMimir((s) => s.deleteWorkspace);
  const newWorkspace = useMimir((s) => s.newWorkspace);
  const closeWindowByKind = useMimir((s) => s.closeWindowByKind);

  const [query, setQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useMemo(() => {
    const all = Object.values(workspaces).sort(
      (a, b) => b.createdAt - a.createdAt
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    // Match on the workspace name, a file's path, or an agent goal/title.
    return all.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.files.some((f) => f.path.toLowerCase().includes(q)) ||
        w.runs.some(
          (r) =>
            r.goal.toLowerCase().includes(q) ||
            (r.title?.toLowerCase().includes(q) ?? false)
        )
    );
  }, [workspaces, query]);

  function open(id: string) {
    if (selectMode) {
      toggle(id);
      return;
    }
    openWorkspace(id);
    closeWindowByKind("workspaces");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function selectAllVisible() {
    setSelected(new Set(list.map((w) => w.id)));
  }

  const totalCount = Object.keys(workspaces).length;

  return (
    <div className="flex h-full flex-col">
      {/* Search + controls */}
      <div className="shrink-0 border-b border-ink-700 p-3">
        <div className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 focus-within:border-bronze-600">
          <IconSearch className="h-4 w-4 text-parchment-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspaces…"
            className="flex-1 bg-transparent text-base md:text-sm text-parchment-100 placeholder:text-parchment-600 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-xs text-parchment-600 hover:text-parchment-100"
            >
              clear
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          {selectMode ? (
            <>
              <span className="text-xs text-parchment-400">
                {selected.size} selected
              </span>
              <button
                onClick={selectAllVisible}
                className="text-xs text-parchment-400 hover:text-parchment-100"
              >
                Select all{query ? " shown" : ""}
              </button>
              <div className="flex-1" />
              {selected.size > 0 && (
                <ConfirmDelete
                  label={`Delete ${selected.size}`}
                  message={`Delete ${selected.size} workspace${
                    selected.size === 1 ? "" : "s"
                  }? Can't be undone.`}
                  size="md"
                  stopPropagation={false}
                  onConfirm={() => {
                    for (const id of selected) deleteWorkspace(id);
                    exitSelect();
                  }}
                />
              )}
              <button
                onClick={exitSelect}
                className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-parchment-400 hover:bg-ink-800 hover:text-parchment-100"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-parchment-600">
                {totalCount} workspace{totalCount === 1 ? "" : "s"}
              </span>
              <div className="flex-1" />
              {totalCount > 0 && (
                <button
                  onClick={() => setSelectMode(true)}
                  className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-parchment-400 hover:bg-ink-800 hover:text-parchment-100"
                >
                  Select
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {totalCount === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center">
            <p className="text-sm text-parchment-600">No workspaces yet.</p>
            <button
              onClick={() => {
                newWorkspace();
                closeWindowByKind("workspaces");
              }}
              className="mt-4 rounded-md bg-bronze-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-bronze-400"
            >
              New workspace
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center text-sm text-parchment-600">
            Nothing matches “{query.trim()}”.
          </div>
        ) : (
          <ul className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700">
            {list.map((w) => {
              const isSel = selected.has(w.id);
              return (
                <li
                  key={w.id}
                  className={[
                    "group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                    isSel ? "bg-bronze-600/10" : "bg-ink-900 hover:bg-ink-850",
                  ].join(" ")}
                  onClick={() => open(w.id)}
                >
                  {selectMode && (
                    <span
                      className={[
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors md:h-4 md:w-4",
                        isSel
                          ? "border-bronze-500 bg-bronze-500 text-ink-950"
                          : "border-ink-700",
                      ].join(" ")}
                    >
                      {isSel && <IconCheck className="h-4 w-4" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-parchment-100">
                      {w.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-parchment-600">
                      {countFiles(w.files)} files · {w.runs.length} runs ·
                      created {new Date(w.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {!selectMode && (
                    <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <ConfirmDelete
                        label={`Delete ${w.name}`}
                        message="Delete? Can't be undone."
                        onConfirm={() => deleteWorkspace(w.id)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
