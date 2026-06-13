"use client";

import { useTalos } from "@/lib/store";
import {
  IconBox,
  IconChat,
  IconGear,
  IconMemory,
  IconPlus,
  IconSearch,
  IconSkill,
  IconStack,
  IconTool,
} from "./icons";

export default function Sidebar() {
  const newConversation = useTalos((s) => s.newConversation);
  const newWorkspace = useTalos((s) => s.newWorkspace);
  const openWindow = useTalos((s) => s.openWindow);
  const setSearchOpen = useTalos((s) => s.setSearchOpen);
  const username = useTalos((s) => s.settings.username);
  const windows = useTalos((s) => s.windows);

  const isOpen = (kind: string) => windows.some((w) => w.kind === kind);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bronze-500 opacity-40" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-bronze-400" />
        </span>
        <span className="font-mono text-sm font-semibold tracking-[0.3em] text-parchment-100">
          TALOS
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="New conversation"
          icon={<IconPlus />}
          accent
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
          hint="⌘K"
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

      <SectionLabel>Forge</SectionLabel>
      <nav className="flex flex-col gap-1 px-2">
        <SidebarButton
          label="Memories"
          icon={<IconMemory />}
          active={isOpen("memories")}
          onClick={() => openWindow("memories")}
        />
        <SidebarButton
          label="Skills"
          icon={<IconSkill />}
          active={isOpen("skills")}
          onClick={() => openWindow("skills")}
        />
        <SidebarButton
          label="Tools"
          icon={<IconTool />}
          active={isOpen("tools")}
          onClick={() => openWindow("tools")}
        />
      </nav>

      <div className="flex-1" />

      {/* Profile footer */}
      <div className="flex items-center gap-2 border-t border-ink-700 px-3 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-bronze-600/30 font-mono text-xs uppercase text-bronze-300">
          {username.slice(0, 1) || "?"}
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
