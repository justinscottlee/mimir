"use client";

import { useMimir } from "@/lib/store";
import { IconTrash } from "../icons";

export default function ConversationsView() {
  const conversations = useMimir((s) => s.conversations);
  const openConversation = useMimir((s) => s.openConversation);
  const deleteConversation = useMimir((s) => s.deleteConversation);
  const newConversation = useMimir((s) => s.newConversation);
  const closeWindowByKind = useMimir((s) => s.closeWindowByKind);

  const list = Object.values(conversations).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  function open(id: string) {
    openConversation(id);
    closeWindowByKind("conversations");
  }

  return (
    <div className="p-4">
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center">
          <p className="text-sm text-parchment-600">No conversations yet.</p>
          <button
            onClick={() => {
              newConversation();
              closeWindowByKind("conversations");
            }}
            className="mt-4 rounded-md bg-bronze-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-bronze-400"
          >
            New conversation
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700">
          {list.map((c) => (
            <li
              key={c.id}
              className="group flex cursor-pointer items-center gap-3 bg-ink-900 px-4 py-3 transition-colors hover:bg-ink-850"
              onClick={() => open(c.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-parchment-100">
                  {c.title}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-parchment-600">
                  {c.messages.length} message{c.messages.length === 1 ? "" : "s"}
                  {c.model ? ` · ${c.model}` : ""} ·{" "}
                  {new Date(c.updatedAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
                className="rounded p-1.5 text-parchment-600 opacity-0 transition-opacity hover:bg-ink-700 hover:text-signal-err focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Delete ${c.title}`}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
