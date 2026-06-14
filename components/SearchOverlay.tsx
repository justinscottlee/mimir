"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMimir } from "@/lib/store";
import { IconBox, IconChat, IconSearch } from "./icons";

interface Result {
  kind: "conversation" | "workspace";
  id: string;
  title: string;
  detail: string;
}

export default function SearchOverlay() {
  const open = useMimir((s) => s.searchOpen);
  const setOpen = useMimir((s) => s.setSearchOpen);
  const conversations = useMimir((s) => s.conversations);
  const workspaces = useMimir((s) => s.workspaces);
  const openConversation = useMimir((s) => s.openConversation);
  const openWorkspace = useMimir((s) => s.openWorkspace);

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // Focus after the overlay renders.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const fromConversations: Result[] = Object.values(conversations)
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => m.content.toLowerCase().includes(q))
      )
      .map((c) => {
        const hit = c.messages.find((m) =>
          m.content.toLowerCase().includes(q)
        );
        return {
          kind: "conversation" as const,
          id: c.id,
          title: c.title,
          detail: hit
            ? snippet(hit.content, q)
            : `${c.messages.length} messages`,
        };
      });

    const fromWorkspaces: Result[] = Object.values(workspaces)
      .filter((w) => w.name.toLowerCase().includes(q))
      .map((w) => ({
        kind: "workspace" as const,
        id: w.id,
        title: w.name,
        detail: "workspace",
      }));

    return [...fromConversations, ...fromWorkspaces].slice(0, 12);
  }, [query, conversations, workspaces]);

  if (!open) return null;

  function choose(r: Result) {
    if (r.kind === "conversation") openConversation(r.id);
    else openWorkspace(r.id);
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-3 pt-[12vh] md:pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3">
          <IconSearch className="h-4 w-4 text-parchment-600" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              }
              if (e.key === "Enter" && results[highlight]) {
                choose(results[highlight]);
              }
            }}
            placeholder="Search conversations and workspaces…"
            className="flex-1 bg-transparent text-base md:text-sm text-parchment-100 placeholder:text-parchment-600 focus:outline-none"
          />
          <kbd className="font-mono text-[10px] text-parchment-600 max-md:hidden">esc</kbd>
        </div>

        {query.trim() && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {results.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-parchment-600">
                Nothing matches “{query.trim()}”.
              </li>
            )}
            {results.map((r, i) => (
              <li key={r.kind + r.id}>
                <button
                  onClick={() => choose(r)}
                  onMouseEnter={() => setHighlight(i)}
                  className={[
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left",
                    i === highlight ? "bg-ink-800" : "",
                  ].join(" ")}
                >
                  <span className="text-parchment-600">
                    {r.kind === "conversation" ? <IconChat /> : <IconBox />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-parchment-100">
                      {r.title}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-parchment-600">
                      {r.detail}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function snippet(content: string, q: string): string {
  const idx = content.toLowerCase().indexOf(q);
  const start = Math.max(0, idx - 30);
  const slice = content.slice(start, start + 90).replace(/\s+/g, " ");
  return (start > 0 ? "…" : "") + slice + (start + 90 < content.length ? "…" : "");
}
