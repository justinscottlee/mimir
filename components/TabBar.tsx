"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMimir } from "@/lib/store";
import {IconBox, IconChat, IconClose, IconMenu, IconPlus, IconPencil, IconTrash, IconCheck} from "./icons";

export default function TabBar({ onOpenNav }: { onOpenNav?: () => void }) {
  const tabs = useMimir((s) => s.tabs);
  const activeTabId = useMimir((s) => s.activeTabId);
  const setActiveTab = useMimir((s) => s.setActiveTab);
  const closeTab = useMimir((s) => s.closeTab);
  const closeOtherTabs = useMimir((s) => s.closeOtherTabs);
  const closeTabsToRight = useMimir((s) => s.closeTabsToRight);
  const moveTabBefore = useMimir((s) => s.moveTabBefore);
  const renameTabRef = useMimir((s) => s.renameTabRef);
  const deleteConversation = useMimir((s) => s.deleteConversation);
  const deleteWorkspace = useMimir((s) => s.deleteWorkspace);

  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null
  );

  function commitRename(tabId: string) {
    renameTabRef(tabId, draft);
    setEditingId(null);
  }

  function startRename(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    setActiveTab(tabId);
    setDraft(tab.title);
    setEditingId(tabId);
  }

  function openMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    setMenu({ tabId, x: e.clientX, y: e.clientY });
  }

  return (
    <div className="flex h-11 items-end gap-1 overflow-x-auto border-b border-ink-700 bg-ink-900 px-2 md:h-10">
      {/* Hamburger — mobile only, opens the nav drawer */}
      <button
        onClick={onOpenNav}
        aria-label="Open menu"
        className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-parchment-400 hover:bg-ink-850 hover:text-parchment-100 md:hidden"
      >
        <IconMenu className="h-5 w-5" />
      </button>
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
            onContextMenu={(e) => openMenu(e, tab.id)}
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
              className="rounded p-1.5 text-parchment-600 transition-opacity hover:bg-ink-700 hover:text-parchment-100 focus-visible:opacity-100 max-md:opacity-100 md:p-0.5 md:opacity-0 md:group-hover:opacity-100"
              aria-label={`Close ${tab.title}`}
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <NewTabButton />

      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          tab={tabs.find((t) => t.id === menu.tabId) ?? null}
          tabCount={tabs.length}
          isLast={tabs[tabs.length - 1]?.id === menu.tabId}
          onClose={() => setMenu(null)}
          onRename={() => startRename(menu.tabId)}
          onCloseTab={() => closeTab(menu.tabId)}
          onCloseOthers={() => closeOtherTabs(menu.tabId)}
          onCloseRight={() => closeTabsToRight(menu.tabId)}
          onDelete={() => {
            const tab = tabs.find((t) => t.id === menu.tabId);
            if (!tab) return;
            if (tab.kind === "chat") deleteConversation(tab.refId);
            else deleteWorkspace(tab.refId);
          }}
        />
      )}
    </div>
  );
}

/** Right-click menu for a tab. Rendered in a portal and clamped on-screen. */
function TabContextMenu({
                          x,
                          y,
                          tab,
                          tabCount,
                          isLast,
                          onClose,
                          onRename,
                          onCloseTab,
                          onCloseOthers,
                          onCloseRight,
                          onDelete,
                        }: {
  x: number;
  y: number;
  tab: { kind: "chat" | "workspace" } | null;
  tabCount: number;
  isLast: boolean;
  onClose: () => void;
  onRename: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Clamp so the menu never spills off the right or bottom edges.
  useLayoutEffect(() => {
    const el = menuRef.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 240;
    const margin = 8;
    const left = Math.max(margin, Math.min(x, window.innerWidth - w - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - h - margin));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onDocPointer(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return createPortal(
      <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            left: pos?.left ?? x,
            top: pos?.top ?? y,
            visibility: pos ? "visible" : "hidden",
          }}
          className="z-[100] w-52 overflow-hidden rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      >
        <MenuItem
            icon={<IconPencil className="h-4 w-4" />}
            label="Rename"
            onClick={run(onRename)}
        />
        <div className="my-1 h-px bg-ink-700" />
        <MenuItem
            icon={<IconClose className="h-4 w-4" />}
            label="Close tab"
            onClick={run(onCloseTab)}
        />
        <MenuItem
            icon={<IconClose className="h-4 w-4" />}
            label="Close other tabs"
            disabled={tabCount <= 1}
            onClick={run(onCloseOthers)}
        />
        <MenuItem
            icon={<IconClose className="h-4 w-4" />}
            label="Close tabs to the right"
            disabled={isLast}
            onClick={run(onCloseRight)}
        />
        <div className="my-1 h-px bg-ink-700" />

        {confirmDelete ? (
            <div className="flex pl-4 items-center gap-3 py-2">
              <span className="text-xs font-medium text-signal-err">Delete permanently?</span>
              <button
                  onClick={() => { onDelete(); onClose(); }}
                  className="rounded p-0.5 text-signal-err hover:bg-signal-err/20"
                  title="Confirm delete"
                  aria-label="Confirm delete"
              >
                <IconCheck className="h-4 w-4" />
              </button>
              <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
                  title="Cancel"
                  aria-label="Cancel delete"
              >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        ) : (
            <MenuItem
                icon={<IconTrash className="h-4 w-4" />}
                label={tab?.kind === "workspace" ? "Delete workspace" : "Delete conversation"}
                destructive
                onClick={() => setConfirmDelete(true)}
            />
        )}
      </div>,
      document.body
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
  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Menu is w-52 (208px). Keep it on-screen: if the button is near the right
    // edge, shift the menu left so its right edge sits just inside the viewport.
    const MENU_W = 208;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(r.left, window.innerWidth - MENU_W - margin)
    );
    setCoords({ left, top: r.bottom + 4 });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

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
    // Keep the menu anchored to the button on scroll/resize rather than
    // closing it — the button lives in the fixed top bar, so chat content
    // autoscrolling during generation must not dismiss the menu.
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

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
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors md:py-2",
        disabled
          ? "cursor-not-allowed text-parchment-600/40"
          : destructive
          ? "text-signal-err hover:bg-signal-err/10"
          : "text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
      ].join(" ")}
    >
      <span
        className={
          disabled
            ? "text-parchment-600/40"
            : destructive
            ? "text-signal-err"
            : "text-parchment-600"
        }
      >
        {icon}
      </span>
      {label}
    </button>
  );
}
