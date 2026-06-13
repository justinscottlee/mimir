"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMimir } from "@/lib/store";
import { IconBox, IconChat, IconClose, IconPlus } from "./icons";

export default function TabBar() {
  const tabs = useMimir((s) => s.tabs);
  const activeTabId = useMimir((s) => s.activeTabId);
  const setActiveTab = useMimir((s) => s.setActiveTab);
  const closeTab = useMimir((s) => s.closeTab);
  const moveTabBefore = useMimir((s) => s.moveTabBefore);
  const renameTabRef = useMimir((s) => s.renameTabRef);

  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <NewTabButton />
    </div>
  );
}

/** "+" button at the right of the strip with a New conversation/workspace menu. */
function NewTabButton() {
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the menu just below the button, in viewport coordinates. The menu
  // is rendered in a portal (below) so it isn't clipped by the tab strip's
  // horizontal overflow or trapped behind other stacking contexts.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setCoords({ left: r.left, top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        btnRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  return (
    <div className="relative mb-1 ml-0.5 shrink-0">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="New tab"
        aria-haspopup="menu"
        aria-expanded={open}
        title="New tab"
        className={[
          "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
          open
            ? "bg-ink-800 text-parchment-100"
            : "text-parchment-600 hover:bg-ink-850 hover:text-parchment-100",
        ].join(" ")}
      >
        <IconPlus className="h-4 w-4" />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: coords.left, top: coords.top }}
            className="z-[100] w-52 overflow-hidden rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
          >
            <MenuItem
              icon={<IconChat className="h-4 w-4" />}
              label="New conversation"
              onClick={() => {
                newConversation();
                setOpen(false);
              }}
            />
            <MenuItem
              icon={<IconBox className="h-4 w-4" />}
              label="New workspace"
              onClick={() => {
                newWorkspace();
                setOpen(false);
              }}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
    >
      <span className="text-parchment-600">{icon}</span>
      {label}
    </button>
  );
}
