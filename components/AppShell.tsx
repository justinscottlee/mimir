"use client";

import { useEffect, useState } from "react";
import { useTalos } from "@/lib/store";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import SearchOverlay from "./SearchOverlay";
import ChatView from "./views/ChatView";
import WorkspaceView from "./views/WorkspaceView";
import EmptyState from "./EmptyState";
import { WindowLayer } from "./FloatingWindow";

export default function AppShell() {
  // The store hydrates from localStorage on the client, so render the shell
  // only after mount to avoid an SSR/client mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const tabs = useTalos((s) => s.tabs);
  const activeTabId = useTalos((s) => s.activeTabId);
  const setSearchOpen = useTalos((s) => s.setSearchOpen);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  if (!mounted) {
    return <div className="h-screen bg-ink-950" aria-hidden />;
  }

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="relative flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <div className="min-h-0 flex-1 overflow-hidden">
          {!active && <EmptyState />}
          {active?.kind === "chat" && (
            <ChatView key={active.refId} conversationId={active.refId} />
          )}
          {active?.kind === "workspace" && (
            <WorkspaceView key={active.refId} workspaceId={active.refId} />
          )}
        </div>
      </main>
      {/* Manager pages float above the shell as draggable windows. */}
      <WindowLayer />
      <SearchOverlay />
    </div>
  );
}
