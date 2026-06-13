"use client";

import { useMimir } from "@/lib/store";

export default function EmptyState() {
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <div className="text-center justify-items-center">
        <div className="w-24">
          <img
              src="/mimir-brand-text.svg"
              alt={"mimir"}
          />
        </div>
        <p className="mt-8 max-w-sm text-sm text-parchment-600">
          Nothing is open. Start a new conversation or workspace; or open a previous one.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={newConversation}
          className="rounded-md bg-bronze-500 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400"
        >
          New conversation
        </button>
        <button
          onClick={newWorkspace}
          className="rounded-md border border-ink-700 px-4 py-2 text-sm text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
        >
          New workspace
        </button>
      </div>
    </div>
  );
}
