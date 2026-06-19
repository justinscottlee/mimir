"use client";

import { useEffect, useRef } from "react";
import { useMimir } from "@/lib/store";
import {
  IconBox,
  IconCoin,
  IconClose,
  IconGear,
  IconPlus,
  IconSearch,
  IconCode,
  IconWrench,
  IconDoc,
  IconBriefcase,
  IconUser,
} from "./icons";
import Image from "next/image"




export default function Sidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);
  const openWindow = useMimir((s) => s.openWindow);
  const setSearchOpen = useMimir((s) => s.setSearchOpen);
  const username = useMimir((s) => s.settings.username);
  const windows = useMimir((s) => s.windows);

  const isOpen = (kind: string) => windows.some((w) => w.kind === kind);

  // Wrap an action so tapping it also dismisses the mobile drawer.
  const go = (fn: () => void) => () => {
    fn();
    onClose?.();
  };

  // Swipe-left-to-close for the mobile drawer. We track the touch start and,
  // on release, close if the gesture was a clear leftward swipe.
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touch.current = { x: t.clientX, y: t.clientY };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touch.current || !mobileOpen) return;

      const t = e.changedTouches[0];
      const dx = t.clientX - touch.current.x;
      const dy = t.clientY - touch.current.y;
      touch.current = null;

      // Close on a clear leftward swipe (ignores vertical scrolling)
      if (dx < -55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onClose?.();
      }
    };

    // passive: true prevents blocking native scroll behavior on mobile
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [mobileOpen, onClose]);

  return (
    <aside
      className={[
        "z-50 flex w-56 shrink-0 flex-col border-r border-ink-700 bg-ink-900",
        // Mobile: fixed off-canvas drawer that slides in. Desktop (md+): a
        // normal static flex child that's always visible.
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-72 max-md:shadow-2xl",
        "max-md:transition-transform max-md:duration-200 max-md:ease-out",
        mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      ].join(" ")}
    >
      {/* Brand */}
      <div className="relative flex select-none items-center justify-center gap-2.5 px-4 pb-4 pt-5">
        <span className="h-10 w-10">
          <img src="/mimir-brand-logo.svg" alt="brand logo" />
        </span>

        <span className="w-24">
          <img src="/mimir-brand-text.svg" alt={"mimir"} />
        </span>

        {/* Close button — mobile drawer only */}
        <button
          onClick={onClose}
          className="absolute right-2 top-3 rounded-md p-1.5 text-parchment-600 hover:bg-ink-800 hover:text-parchment-100 md:hidden"
          aria-label="Close menu"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="New conversation"
          icon={<IconPlus />}
          onClick={go(newConversation)}
        />
        <SidebarButton
          label="New workspace"
          icon={<IconPlus />}
          onClick={go(newWorkspace)}
        />
        <SidebarButton
          label="Search"
          icon={<IconSearch />}
          hint="CTRL K"
          onClick={go(() => setSearchOpen(true))}
        />
      </div>

      <SectionLabel>Library</SectionLabel>
      <nav className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="Library"
          icon={<IconBox />}
          active={isOpen("library")}
          onClick={go(() => openWindow("library"))}
        />
      </nav>

      <SectionLabel>Tools</SectionLabel>
      <nav className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="Memories"
          icon={<IconBriefcase />}
          active={isOpen("memories")}
          onClick={go(() => openWindow("memories"))}
        />
        <SidebarButton
          label="Skills"
          icon={<IconCode />}
          active={isOpen("skills")}
          onClick={go(() => openWindow("skills"))}
        />
        <SidebarButton
          label="Tools"
          icon={<IconWrench />}
          active={isOpen("tools")}
          onClick={go(() => openWindow("tools"))}
        />
        <SidebarButton
          label="System Prompt"
          icon={<IconDoc />}
          active={isOpen("systemPrompt")}
          onClick={go(() => openWindow("systemPrompt"))}
        />
        <SidebarButton
          label="Usage & cost"
          icon={<IconCoin />}
          active={isOpen("usage")}
          onClick={go(() => openWindow("usage"))}
        />
      </nav>

      <div className="flex-1" />

      {/* Profile footer */}
      <div className="flex items-center gap-2 border-t border-ink-700 px-3 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-bronze-600/30 font-mono text-xs uppercase text-bronze-300">
          <IconUser />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm text-parchment-400">
          {username}
        </span>
        <button
          onClick={go(() => openWindow("settings"))}
          className="rounded-md p-1.5 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100"
          title="Settings"
          aria-label="Settings"
        >
          <IconGear />
        </button>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
      {children}
    </div>
  );
}

function SidebarButton({
  label,
  icon,
  hint,
  accent,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  hint?: string;
  accent?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-sm transition-colors md:py-1.5",
        active
          ? "bg-ink-800 text-parchment-100"
          : "text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
        accent ? "text-bronze-300 hover:text-bronze-300" : "",
      ].join(" ")}
    >
      <span className={accent ? "text-bronze-400" : "text-parchment-600"}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {hint && (
        <kbd className="font-mono text-[10px] text-parchment-600 max-md:hidden">
          {hint}
        </kbd>
      )}
    </button>
  );
}
