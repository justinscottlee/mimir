"use client";

import { useEffect, useRef, useState } from "react";
import { useMimir, WINDOW_SPECS } from "@/lib/store";
import { FloatingWindow as Win, WindowKind } from "@/lib/types";
import { IconClose } from "./icons";
import ConversationsView from "./views/ConversationsView";
import WorkspacesView from "./views/WorkspacesView";
import MemoriesView from "./views/MemoriesView";
import SkillsView from "./views/SkillsView";
import ToolsView from "./views/ToolsView";
import SettingsView from "./views/SettingsView";

const WINDOW_TITLES: Record<WindowKind, string> = {
  conversations: "Conversations",
  workspaces: "Workspaces",
  memories: "Memories",
  skills: "Skills",
  tools: "Tools",
  settings: "Settings",
};

export function WindowLayer() {
  const windows = useMimir((s) => s.windows);
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {windows.map((w) => (
        <FloatingWindow key={w.id} win={w} />
      ))}
    </div>
  );
}

function FloatingWindow({ win }: { win: Win }) {
  const closeWindow = useMimir((s) => s.closeWindow);
  const focusWindow = useMimir((s) => s.focusWindow);
  const moveWindow = useMimir((s) => s.moveWindow);
  const resizeWindow = useMimir((s) => s.resizeWindow);

  const spec = WINDOW_SPECS[win.kind];

  // Position and size live in local state while dragging/resizing for
  // smoothness; the final values commit to the store on pointer-up.
  const [pos, setPos] = useState({ x: win.x, y: win.y });
  const [size, setSize] = useState({ w: win.w, h: win.h });
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  useEffect(() => {
    if (!dragRef.current) setPos({ x: win.x, y: win.y });
  }, [win.x, win.y]);
  useEffect(() => {
    if (!resizeRef.current) setSize({ w: win.w, h: win.h });
  }, [win.w, win.h]);

  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = { offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y };

    function onMove(ev: PointerEvent) {
      if (!dragRef.current) return;
      const x = clamp(
        ev.clientX - dragRef.current.offsetX,
        -size.w + 120,
        window.innerWidth - 120
      );
      const y = clamp(ev.clientY - dragRef.current.offsetY, 0, window.innerHeight - 48);
      setPos({ x, y });
    }
    function onUp() {
      if (dragRef.current) {
        setPos((p) => {
          moveWindow(win.id, p.x, p.y);
          return p;
        });
      }
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    focusWindow(win.id);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.w,
      startH: size.h,
    };

    function onMove(ev: PointerEvent) {
      if (!resizeRef.current) return;
      const w = clamp(
        resizeRef.current.startW + (ev.clientX - resizeRef.current.startX),
        spec.minW,
        spec.maxW
      );
      const h = clamp(
        resizeRef.current.startH + (ev.clientY - resizeRef.current.startY),
        spec.minH,
        spec.maxH
      );
      setSize({ w, h });
    }
    function onUp() {
      if (resizeRef.current) {
        setSize((sz) => {
          resizeWindow(win.id, sz.w, sz.h);
          return sz;
        });
      }
      resizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <section
      role="dialog"
      aria-label={WINDOW_TITLES[win.kind]}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: win.z,
      }}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
      onPointerDown={() => focusWindow(win.id)}
    >
      <header
        onPointerDown={startDrag}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-ink-700 bg-ink-850 px-3.5 py-2 active:cursor-grabbing"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-bronze-500" />
        <span className="flex-1 truncate text-sm font-medium text-parchment-100">
          {WINDOW_TITLES[win.kind]}
        </span>
        <button
          onClick={() => closeWindow(win.id)}
          className="rounded-md p-1 text-parchment-600 transition-colors hover:bg-ink-700 hover:text-parchment-100"
          aria-label={`Close ${WINDOW_TITLES[win.kind]}`}
          title="Close"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WindowContent kind={win.kind} />
      </div>

      {/* Resize handle (bottom-right) */}
      <div
        onPointerDown={startResize}
        className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-se-resize"
        title="Drag to resize"
      >
        <svg
          viewBox="0 0 16 16"
          className="absolute bottom-0.5 right-0.5 h-4 w-4 text-parchment-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <path d="M11 5 5 11M11 9l-2 2M11 13" />
        </svg>
      </div>
    </section>
  );
}

function WindowContent({ kind }: { kind: WindowKind }) {
  switch (kind) {
    case "conversations":
      return <ConversationsView />;
    case "workspaces":
      return <WorkspacesView />;
    case "memories":
      return <MemoriesView />;
    case "skills":
      return <SkillsView />;
    case "tools":
      return <ToolsView />;
    case "settings":
      return <SettingsView />;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
