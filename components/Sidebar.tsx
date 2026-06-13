"use client";

import { useMimir } from "@/lib/store";
import {
  IconBox,
  IconChat,
  IconGear,
  IconClock,
  IconPlus,
  IconSearch,
  IconCode,
  IconWrench, IconMemoryRibbon, IconMemoryScroll, IconBriefcase, IconUser
} from "./icons";
import Image from "next/image"

export default function Sidebar() {
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);
  const openWindow = useMimir((s) => s.openWindow);
  const setSearchOpen = useMimir((s) => s.setSearchOpen);
  const username = useMimir((s) => s.settings.username);
  const windows = useMimir((s) => s.windows);

  const isOpen = (kind: string) => windows.some((w) => w.kind === kind);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5 justify-center select-none">
        <span className="w-10 h-10">
          <img
              src="/mimir-brand-logo.svg"
              alt="brand logo"
          />
        </span>

        <span className="w-24">
          <img
              src="/mimir-brand-text.svg"
              alt={"mimir"}
          />
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="New conversation"
          icon={<IconPlus />}
          onClick={newConversation}
        />
        <SidebarButton
          label="New workspace"
          icon={<IconPlus />}
          onClick={newWorkspace}
        />
        <SidebarButton
          label="Search"
          icon={<IconSearch />}
          hint="CTRL K"
          onClick={() => setSearchOpen(true)}
        />
      </div>

      <SectionLabel>Library</SectionLabel>
      <nav className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="Conversations"
          icon={<IconChat />}
          active={isOpen("conversations")}
          onClick={() => openWindow("conversations")}
        />
        <SidebarButton
          label="Workspaces"
          icon={<IconBox />}
          active={isOpen("workspaces")}
          onClick={() => openWindow("workspaces")}
        />
      </nav>

      <SectionLabel>Tools</SectionLabel>
      <nav className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="Memories"
          icon={<IconBriefcase />}
          active={isOpen("memories")}
          onClick={() => openWindow("memories")}
        />
        <SidebarButton
          label="Skills"
          icon={<IconCode />}
          active={isOpen("skills")}
          onClick={() => openWindow("skills")}
        />
        <SidebarButton
          label="Tools"
          icon={<IconWrench />}
          active={isOpen("tools")}
          onClick={() => openWindow("tools")}
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
          onClick={() => openWindow("settings")}
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
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
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
        <kbd className="font-mono text-[10px] text-parchment-600">{hint}</kbd>
      )}
    </button>
  );
}
