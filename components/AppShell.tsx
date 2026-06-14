"use client";

import { useEffect, useState } from "react";
import { useMimir } from "@/lib/store";
import { useSession } from "@/lib/auth-client";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import SearchOverlay from "./SearchOverlay";
import ChatView from "./views/ChatView";
import WorkspaceView from "./views/WorkspaceView";
import EmptyState from "./EmptyState";
import AuthGate from "./AuthGate";
import { WindowLayer } from "./FloatingWindow";

export default function AppShell() {
  // Avoid an SSR/client flash: only decide what to render after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { data: session, isPending: sessionPending } = useSession();

  const status = useMimir((s) => s.status);
  const loadState = useMimir((s) => s.loadState);
  const reset = useMimir((s) => s.reset);

  // Drive the store lifecycle off the session. When a user signs in, hydrate
  // from the server exactly once; when they sign out, drop all local state.
  useEffect(() => {
    if (sessionPending) return;
    if (session) {
      // Only kick off a load if we haven't already (idle/error are restartable).
      if (status === "idle" || status === "error") {
        void loadState();
      }
    } else {
      // Signed out: clear any lingering state so the next user starts clean.
      if (status !== "idle") reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionPending]);

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

  // Close the mobile drawer whenever the active tab changes.
  useEffect(() => {
    setNavOpen(false);
  }, [activeTabId]);

  // ---- Pre-render gates -------------------------------------------------

  // Before mount or while the session is resolving, show a neutral backdrop.
  if (!mounted || sessionPending) {
    return <div className="h-app bg-ink-950" aria-hidden />;
  }

  // No session → the sign-in / sign-up screen.
  if (!session) {
    return <AuthGate />;
  }

  // Signed in but the server snapshot hasn't arrived yet.
  if (status !== "ready") {
    return (
      <div className="flex h-app items-center justify-center bg-ink-950">
        {status === "error" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-signal-err">
              Couldn&apos;t load your data.
            </p>
            <button
              onClick={() => void loadState()}
              className="rounded-md border border-ink-700 px-4 py-2 text-sm text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink-700 border-t-bronze-500" />
        )}
      </div>
    );
  }

  // ---- Ready: the full workbench ---------------------------------------

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
