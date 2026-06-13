"use client";

import { useTalos } from "@/lib/store";

export default function EmptyState() {
  const newConversation = useTalos((s) => s.newConversation);
  const newWorkspace = useTalos((s) => s.newWorkspace);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center">
        <div className="font-mono text-xs uppercase tracking-[0.35em] text-bronze-500">
          Talos
        </div>
        <p className="mt-2 max-w-sm text-sm text-parchment-600">
          The forge is lit. Start a conversation or open a workspace to put a
          model to work.
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
