"use client";

import { useMimir } from "@/lib/store";

export default function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const workspace = useMimir((s) => s.workspaces[workspaceId]);

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-parchment-600">
        This workspace no longer exists.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-bronze-500">
        Workspace
      </div>
      <h1 className="mt-2 text-xl font-semibold text-parchment-100">
        {workspace.name}
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-parchment-400">
        Workspaces will give a model a container to operate in as an agent: a
        sandboxed filesystem, a task loop, and tools for building projects end
        to end. This view is a stub until that design is settled.
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-ink-700 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
          Planned
        </div>
        <ul className="mt-3 space-y-2 text-sm text-parchment-400">
          {[
            "Container/sandbox per workspace (likely Docker or a chroot jail)",
            "Agent loop: plan, act with tools, observe, repeat",
            "File tree + editor panel for inspecting what the agent produces",
            "Run log so every action the agent takes is auditable",
          ].map((n) => (
            <li key={n} className="flex gap-2.5">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-bronze-500" />
              {n}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
