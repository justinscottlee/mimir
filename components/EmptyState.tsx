"use client";

import { useMimir } from "@/lib/store";

export default function EmptyState() {
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <div className="justify-items-center text-center">
        <div className="relative flex select-none items-center justify-center gap-2.5">
          <span className="h-16 w-16">
          <img src="/mimir-brand-logo.svg" alt="brand logo" />
        </span>

          <span className="w-36">
          <img src="/mimir-brand-text.svg" alt={"mimir"} />
        </span>
        </div>
        <p className="mt-8 max-w-sm text-sm text-parchment-600">
          Nothing is open. Start a new conversation or workspace; or open a previous one.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:flex-row">
        <button
          onClick={newConversation}
          className="rounded-md bg-bronze-500 px-4 py-2.5 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400 sm:py-2"
        >
          New conversation
        </button>
        <button
          onClick={newWorkspace}
          className="rounded-md border border-ink-700 px-4 py-2.5 text-sm text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100 sm:py-2"
        >
          New workspace
        </button>
      </div>
    </div>
  );
}
