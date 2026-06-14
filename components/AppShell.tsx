"use client";

import { useEffect, useState } from "react";
import { useMimir } from "@/lib/store";
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

  // Off-canvas navigation drawer (mobile only).
  const [navOpen, setNavOpen] = useState(false);

  const tabs = useMimir((s) => s.tabs);
  const activeTabId = useMimir((s) => s.activeTabId);
  const setSearchOpen = useMimir((s) => s.setSearchOpen);

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

  // Close the mobile drawer whenever the active tab changes (e.g. user opened
  // a conversation from the drawer).
  useEffect(() => {
    setNavOpen(false);
  }, [activeTabId]);

  if (!mounted) {
    return <div className="h-app bg-ink-950" aria-hidden />;
  }

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  if (active) {
    document.title = `${active.title} - Mimir`;
  } else {
    document.title = `Mimir`;
  }

  return (
    <div className="relative flex h-app overflow-hidden">
      {/* Backdrop for the mobile nav drawer */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar mobileOpen={navOpen} onClose={() => setNavOpen(false)} />

      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar onOpenNav={() => setNavOpen(true)} />
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
      {/* Manager pages float above the shell as draggable windows (desktop) or
          full-screen sheets (mobile). */}
      <WindowLayer />
      <SearchOverlay />
    </div>
  );
}
