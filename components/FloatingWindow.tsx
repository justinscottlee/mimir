"use client";

import { useEffect, useRef, useState } from "react";
import { useTalos } from "@/lib/store";
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
  const windows = useTalos((s) => s.windows);
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {windows.map((w) => (
        <FloatingWindow key={w.id} win={w} />
      ))}
    </div>
  );
}

function FloatingWindow({ win }: { win: Win }) {
  const closeWindow = useTalos((s) => s.closeWindow);
  const focusWindow = useTalos((s) => s.focusWindow);
  const moveWindow = useTalos((s) => s.moveWindow);

  // Position lives in local state while dragging for smoothness; the final
  // position is committed to the store on pointer-up.
  const [pos, setPos] = useState({ x: win.x, y: win.y });
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);

  // Follow external position changes (e.g. rehydration).
  useEffect(() => {
    if (!dragRef.current) setPos({ x: win.x, y: win.y });
  }, [win.x, win.y]);

  function startDrag(e: React.PointerEvent) {
    // Ignore drags that start on the close button.
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = {
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
    };

    function onMove(ev: PointerEvent) {
      if (!dragRef.current) return;
      const x = clamp(
        ev.clientX - dragRef.current.offsetX,
        -win.w + 120,
        window.innerWidth - 120
      );
      const y = clamp(
        ev.clientY - dragRef.current.offsetY,
        0,
        window.innerHeight - 48
      );
      setPos({ x, y });
    }
    function onUp(ev: PointerEvent) {
      if (dragRef.current) {
        const x = clamp(
          ev.clientX - dragRef.current.offsetX,
          -win.w + 120,
          window.innerWidth - 120
        );
        const y = clamp(
          ev.clientY - dragRef.current.offsetY,
          0,
          window.innerHeight - 48
        );
        moveWindow(win.id, x, y);
      }
      dragRef.current = null;
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
        width: win.w,
        height: win.h,
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
          <IconClose className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WindowContent kind={win.kind} />
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
