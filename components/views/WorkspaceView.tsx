"use client";

import { useTalos } from "@/lib/store";
import StubPage from "./StubPage";

export default function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const workspace = useTalos((s) => s.workspaces[workspaceId]);

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-parchment-600">
        This workspace no longer exists.
      </div>
    );
  }

  return (
    <StubPage
      eyebrow="Workspace"
      title={workspace.name}
      description="Workspaces will give a model a container to operate in as an agent: a sandboxed filesystem, a task loop, and tools for building projects end to end. This view is a stub until that design is settled."
      notes={[
        "Container/sandbox per workspace (likely Docker or a chroot jail)",
        "Agent loop: plan, act with tools, observe, repeat",
        "File tree + editor panel for inspecting what the agent produces",
        "Run log so every action the agent takes is auditable",
      ]}
    />
  );
}
