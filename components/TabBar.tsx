"use client";

import { useTalos } from "@/lib/store";
import { IconClose } from "./icons";

export default function TabBar() {
  const tabs = useTalos((s) => s.tabs);
  const activeTabId = useTalos((s) => s.activeTabId);
  const setActiveTab = useTalos((s) => s.setActiveTab);
  const closeTab = useTalos((s) => s.closeTab);

  if (tabs.length === 0) {
    return <div className="h-10 border-b border-ink-700 bg-ink-900" />;
  }

  return (
    <div className="flex h-10 items-end gap-1 overflow-x-auto border-b border-ink-700 bg-ink-900 px-2">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => e.key === "Enter" && setActiveTab(tab.id)}
            className={[
              "group flex max-w-[200px] cursor-pointer items-center gap-2 rounded-t-md border-x border-t px-3 py-1.5 text-sm",
              active
                ? "border-ink-700 border-b-transparent bg-ink-950 text-parchment-100"
                : "border-transparent text-parchment-600 hover:bg-ink-850 hover:text-parchment-400",
            ].join(" ")}
          >
            {active && <span className="h-1 w-1 rounded-full bg-bronze-400" />}
            <span className="truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="rounded p-0.5 text-parchment-600 opacity-0 transition-opacity hover:bg-ink-700 hover:text-parchment-100 focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Close ${tab.title}`}
            >
              <IconClose className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
