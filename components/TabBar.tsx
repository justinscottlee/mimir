"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMimir } from "@/lib/store";
import { TabKind } from "@/lib/types";
import {
  ContextMenu,
  ContextMenuDelete,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ContextMenu";
import InlineRename from "@/components/InlineRename";
import {
  IconBox,
  IconChat,
  IconImage,
  IconClose,
  IconMenu,
  IconPlus,
  IconPencil,
} from "./icons";

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
  const deleteImageStudio = useMimir((s) => s.deleteImageStudio);

  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null
  );

  function commitRename(tabId: string, value: string) {
    const next = value.trim();
    if (next) renameTabRef(tabId, next);
    setEditingId(null);
  }

  function startRename(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    setActiveTab(tabId);
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
              <InlineRename
                value={tab.title}
                onCommit={(v) => commitRename(tab.id, v)}
                onCancel={() => setEditingId(null)}
                selectOnFocus
                ariaLabel={`Rename ${tab.title}`}
                className="w-32 rounded border border-bronze-600 bg-ink-850 px-1 py-0 text-sm text-parchment-100 focus:outline-none"
              />
            ) : (
              <span
                className="truncate"
                title={active ? "Click to rename" : tab.title}
                onClick={(e) => {
                  if (active) {
                    e.stopPropagation();
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
            else if (tab.kind === "image") deleteImageStudio(tab.refId);
            else deleteWorkspace(tab.refId);
          }}
        />
      )}
    </div>
  );
}

/** Right-click menu for a tab. */
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
  tab: { kind: TabKind } | null;
  tabCount: number;
  isLast: boolean;
  onClose: () => void;
  onRename: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <ContextMenu x={x} y={y} width={208} onClose={onClose}>
      <ContextMenuItem
        icon={<IconPencil className="h-4 w-4" />}
        label="Rename"
        onClick={run(onRename)}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<IconClose className="h-4 w-4" />}
        label="Close tab"
        onClick={run(onCloseTab)}
      />
      <ContextMenuItem
        icon={<IconClose className="h-4 w-4" />}
        label="Close other tabs"
        disabled={tabCount <= 1}
        onClick={run(onCloseOthers)}
      />
      <ContextMenuItem
        icon={<IconClose className="h-4 w-4" />}
        label="Close tabs to the right"
        disabled={isLast}
        onClick={run(onCloseRight)}
      />
      <ContextMenuSeparator />
      <ContextMenuDelete
        label={
          tab?.kind === "workspace"
            ? "Delete workspace"
            : tab?.kind === "image"
              ? "Delete image studio"
              : "Delete conversation"
        }
        confirmMessage="Delete permanently?"
        armed={confirmDelete}
        onArm={() => setConfirmDelete(true)}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={run(onDelete)}
      />
    </ContextMenu>
  );
}

/** "+" button at the right of the strip with a New conversation/workspace menu. */
function NewTabButton() {
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);
  const newImageStudio = useMimir((s) => s.newImageStudio);

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
            <ContextMenuItem
              icon={<IconChat className="h-4 w-4" />}
              label="New conversation"
              onClick={() => {
                newConversation();
                setOpen(false);
              }}
            />
            <ContextMenuItem
              icon={<IconBox className="h-4 w-4" />}
              label="New workspace"
              onClick={() => {
                newWorkspace();
                setOpen(false);
              }}
            />
            <ContextMenuItem
              icon={<IconImage className="h-4 w-4" />}
              label="New image studio"
              onClick={() => {
                newImageStudio();
                setOpen(false);
              }}
            />
          </div>,
          document.body
        )}
    </div>
  );
}
