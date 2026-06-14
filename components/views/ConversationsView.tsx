"use client";

import { useMemo, useState } from "react";
import { useMimir } from "@/lib/store";
import { describeModelKey } from "@/lib/models";
import { IconCheck, IconSearch } from "../icons";
import ConfirmDelete from "../ConfirmDelete";

export default function ConversationsView() {
  const conversations = useMimir((s) => s.conversations);
  const settings = useMimir((s) => s.settings);
  const openConversation = useMimir((s) => s.openConversation);
  const deleteConversation = useMimir((s) => s.deleteConversation);
  const deleteConversations = useMimir((s) => s.deleteConversations);
  const newConversation = useMimir((s) => s.newConversation);
  const closeWindowByKind = useMimir((s) => s.closeWindowByKind);

  const [query, setQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useMemo(() => {
    const all = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    // Same matching behaviour as the global search: title or message content.
    return all.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, query]);

  function open(id: string) {
    if (selectMode) {
      toggle(id);
      return;
    }
    openConversation(id);
    closeWindowByKind("conversations");
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
    setSelected(new Set(list.map((c) => c.id)));
  }

  const totalCount = Object.keys(conversations).length;

  return (
    <div className="flex h-full flex-col">
      {/* Search + controls */}
      <div className="shrink-0 border-b border-ink-700 p-3">
        <div className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 focus-within:border-bronze-600">
          <IconSearch className="h-4 w-4 text-parchment-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
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
                  message={`Delete ${selected.size} conversation${
                    selected.size === 1 ? "" : "s"
                  }? Can't be undone.`}
                  size="md"
                  stopPropagation={false}
                  onConfirm={() => {
                    deleteConversations([...selected]);
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
                {totalCount} conversation{totalCount === 1 ? "" : "s"}
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
            <p className="text-sm text-parchment-600">No conversations yet.</p>
            <button
              onClick={() => {
                newConversation();
                closeWindowByKind("conversations");
              }}
              className="mt-4 rounded-md bg-bronze-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-bronze-400"
            >
              New conversation
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center text-sm text-parchment-600">
            Nothing matches “{query.trim()}”.
          </div>
        ) : (
          <ul className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700">
            {list.map((c) => {
              const isSel = selected.has(c.id);
              return (
                <li
                  key={c.id}
                  className={[
                    "group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                    isSel ? "bg-bronze-600/10" : "bg-ink-900 hover:bg-ink-850",
                  ].join(" ")}
                  onClick={() => open(c.id)}
                >
                  {selectMode && (
                    <span
                      className={[
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
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
                      {c.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-parchment-600">
                      {c.messages.length} message{c.messages.length === 1 ? "" : "s"}
                      {c.model ? ` · ${describeModelKey(c.model, settings)}` : ""} ·{" "}
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {!selectMode && (
                    <div className="opacity-0 transition-opacity group-hover:opacity-100">
                      <ConfirmDelete
                        label={`Delete ${c.title}`}
                        message="Delete? Can't be undone."
                        onConfirm={() => deleteConversation(c.id)}
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
