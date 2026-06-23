import { StateCreator } from "zustand";
import type { MimirState } from "../store";
import { MAX_WORKSPACE_RUNS } from "../defaults";
import {
  AgentRun,
  AgentStep,
  PlanItem,
  ToolEventRecord,
  TurnOutcome,
} from "../types";

/**
 * Workspace agent-run actions: the store mutations that the agent runner
 * (lib/workspace/useWorkspaceRunner) drives as a run streams in — appending
 * steps, upserting tool-call chips, tracking the plan, and recording how each
 * turn ended. They only ever touch `workspaces[id].runs`, so they lift out of
 * the main store cleanly (the same slice pattern as organization / image-studio
 * / transfer). The persistence bridge in store.ts mirrors the resulting
 * workspace change to Postgres; nothing here calls sync directly.
 */
export interface WorkspaceRunSlice {
  startWorkspaceRun: (id: string, run: AgentRun) => void;
  updateWorkspaceRun: (
    id: string,
    runId: string,
    patch: Partial<Omit<AgentRun, "id" | "steps">>
  ) => void;
  appendRunStep: (id: string, runId: string, step: AgentStep) => void;
  patchRunStep: (
    id: string,
    runId: string,
    stepIndex: number,
    patch: Partial<Omit<AgentStep, "index">>
  ) => void;
  appendRunToolEvent: (
    id: string,
    runId: string,
    stepIndex: number,
    event: ToolEventRecord
  ) => void;
  deleteWorkspaceRun: (id: string, runId: string) => void;
  clearWorkspaceRuns: (id: string) => void;
  /**
   * Append a new prompt to a run's history (used when re-prompting an existing
   * agent). Returns the new turn index (0-based), or -1 if the run is missing.
   */
  appendRunPrompt: (id: string, runId: string, prompt: string) => number;
  /** Replace a run's checklist plan (driven by the plan tools and user edits). */
  setRunPlan: (id: string, runId: string, plan: PlanItem[]) => void;
  /** Record how a turn ended, so its summary stays pinned inline to that turn. */
  recordTurnOutcome: (id: string, runId: string, outcome: TurnOutcome) => void;
}

export const createWorkspaceRunSlice: StateCreator<
  MimirState,
  [],
  [],
  WorkspaceRunSlice
> = (set) => ({
  startWorkspaceRun: (id, run) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      // Keep only the most recent runs to bound the stored workspace size.
      const runs = [...ws.runs, run].slice(-MAX_WORKSPACE_RUNS);
      return { workspaces: { ...s.workspaces, [id]: { ...ws, runs } } };
    }),

  updateWorkspaceRun: (id, runId, patch) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)),
          },
        },
      };
    }),

  appendRunStep: (id, runId, step) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) =>
              r.id === runId ? { ...r, steps: [...r.steps, step] } : r
            ),
          },
        },
      };
    }),

  patchRunStep: (id, runId, stepIndex, patch) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) =>
              r.id === runId
                ? {
                    ...r,
                    steps: r.steps.map((st) =>
                      st.index === stepIndex ? { ...st, ...patch } : st
                    ),
                  }
                : r
            ),
          },
        },
      };
    }),

  appendRunToolEvent: (id, runId, stepIndex, event) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) =>
              r.id === runId
                ? {
                    ...r,
                    steps: r.steps.map((st) => {
                      if (st.index !== stepIndex) return st;
                      // Upsert by tool index: a tool first reports itself as
                      // pending (so a live chip shows), then reports again with
                      // its result, replacing the pending entry in place.
                      const existing = st.toolEvents.findIndex(
                        (e) => e.index === event.index
                      );
                      const toolEvents =
                        existing >= 0
                          ? st.toolEvents.map((e, i) =>
                              i === existing ? event : e
                            )
                          : [...st.toolEvents, event];
                      return { ...st, toolEvents };
                    }),
                  }
                : r
            ),
          },
        },
      };
    }),

  deleteWorkspaceRun: (id, runId) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: { ...ws, runs: ws.runs.filter((r) => r.id !== runId) },
        },
      };
    }),

  appendRunPrompt: (id, runId, prompt) => {
    let turnIndex = -1;
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => {
              if (r.id !== runId) return r;
              const prompts = r.prompts ?? (r.goal ? [r.goal] : []);
              const nextPrompts = [...prompts, prompt];
              turnIndex = nextPrompts.length - 1;
              return { ...r, prompts: nextPrompts };
            }),
          },
        },
      };
    });
    return turnIndex;
  },

  setRunPlan: (id, runId, plan) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => (r.id === runId ? { ...r, plan } : r)),
          },
        },
      };
    }),

  recordTurnOutcome: (id, runId, outcome) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => {
              if (r.id !== runId) return r;
              const rest = (r.turns ?? []).filter(
                (t) => t.turn !== outcome.turn
              );
              return {
                ...r,
                turns: [...rest, outcome].sort((a, b) => a.turn - b.turn),
              };
            }),
          },
        },
      };
    }),

  clearWorkspaceRuns: (id) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return { workspaces: { ...s.workspaces, [id]: { ...ws, runs: [] } } };
    }),
});
