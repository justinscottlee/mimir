"use client";

import { AgentRun } from "@/lib/types";
import PlanView from "./PlanView";
import * as Icons from "@/components/icons";

/**
 * The workspace's right sidebar: the checklist plan for the workspace's agent,
 * kept in view while work happens in the center panel. A workspace has a single
 * agent, so there's no agent list or navigation here — just the plan.
 */
export default function WorkspaceAgentSidebar({
  workspaceId,
  selectedRun,
}: {
  workspaceId: string;
  selectedRun: AgentRun | undefined;
}) {
  const plan = selectedRun?.plan ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Icons.IconList className="h-4 w-4 text-bronze-400" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
          Plan
        </span>
        {selectedRun && (
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-parchment-600">
            {selectedRun.title ?? selectedRun.goal}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!selectedRun ? (
          <EmptyHint text="No agent yet. Describe a task below to start one." />
        ) : plan.length === 0 ? (
          <EmptyHint
            text={
              selectedRun.status === "running"
                ? "No plan yet — the agent will lay one out as it starts."
                : "This agent didn't record a checklist plan."
            }
          />
        ) : (
          <PlanView
            workspaceId={workspaceId}
            runId={selectedRun.id}
            plan={plan}
            editable
          />
        )}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="px-3 py-6 text-center text-xs leading-relaxed text-parchment-600">
      {text}
    </div>
  );
}
