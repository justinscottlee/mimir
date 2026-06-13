"use client";

import { useState } from "react";
import { useTalos } from "@/lib/store";
import { IconClose } from "./icons";

export default function TabBar() {
  const tabs = useTalos((s) => s.tabs);
  const activeTabId = useTalos((s) => s.activeTabId);
  const setActiveTab = useTalos((s) => s.setActiveTab);
  const closeTab = useTalos((s) => s.closeTab);
  const moveTabBefore = useTalos((s) => s.moveTabBefore);
  const renameTabRef = useTalos((s) => s.renameTabRef);

  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (tabs.length === 0) {
    return <div className="h-10 border-b border-ink-700 bg-ink-900" />;
  }

  function commitRename(tabId: string) {
    renameTabRef(tabId, draft);
    setEditingId(null);
  }

  return (
    <div className="flex h-10 items-end gap-1 overflow-x-auto border-b border-ink-700 bg-ink-900 px-2">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const editing = tab.id === editingId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            draggable={!editing}
            onDragStart={(e) => {
              setDragId(tab.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnter={() => {
              // Live-reorder as the dragged tab passes over others.
              if (dragId && dragId !== tab.id) moveTabBefore(dragId, tab.id);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => setDragId(null)}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => e.key === "Enter" && setActiveTab(tab.id)}
            className={[
              "group flex max-w-[220px] cursor-pointer items-center gap-2 rounded-t-md border-x border-t px-3 py-1.5 text-sm",
              dragId === tab.id ? "opacity-50" : "",
              active
                ? "border-ink-700 border-b-transparent bg-ink-950 text-parchment-100"
                : "border-transparent text-parchment-600 hover:bg-ink-850 hover:text-parchment-400",
            ].join(" ")}
          >
            <span
              className={[
                "h-1 w-1 shrink-0 rounded-full",
                active ? "bg-bronze-400" : "bg-transparent",
                tab.kind === "workspace" && active ? "bg-bronze-300" : "",
              ].join(" ")}
            />
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(tab.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-32 rounded border border-bronze-600 bg-ink-850 px-1 py-0 text-sm text-parchment-100 focus:outline-none"
              />
            ) : (
              <span
                className="truncate"
                title={active ? "Click to rename" : tab.title}
                onClick={(e) => {
                  // Clicking the title of the already-active tab starts a rename.
                  if (active) {
                    e.stopPropagation();
                    setDraft(tab.title);
                    setEditingId(tab.id);
                  }
                }}
              >
                {tab.title}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="rounded p-0.5 text-parchment-600 opacity-0 transition-opacity hover:bg-ink-700 hover:text-parchment-100 focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Close ${tab.title}`}
            >
              <IconClose className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
