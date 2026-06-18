"use client";

import { useCallback, useRef } from "react";
import { uid, useMimir } from "@/lib/store";
import { resolveModelKey } from "@/lib/models";
import { AgentRun, AgentRunStatus } from "@/lib/types";
import { ToolEvent, ToolRegistry } from "@/lib/tools";
import {
  buildFilesystemTools,
  WorkspaceFsApi,
} from "@/lib/workspace/filesystemTool";
import { buildRunCommandTool } from "@/lib/workspace/execTool";
import { buildPlanningTools, PlanApi } from "@/lib/workspace/planTool";
import { runAgentTurn, reconstructWorkingHistory } from "@/lib/workspace/agent";
import { workspaceScopedPromptTexts } from "@/lib/systemPrompts";
import { makeContextRuntime } from "@/lib/contextManager";

/**
 * The agent runtime for a single workspace, exposed as a hook.
 *
 * This is the one place that ties the pure agent loop to the store, the model
 * resolver, and React: it builds each agent's tool registry, runs turns, tracks
 * which runs are live, and applies active context management (tool-output
 * pruning + recursive summarization) so a long run stays within a bounded
 * context window.
 *
 * Agents are single and focused — there is no sub-agent delegation. Re-prompting
 * a run replays its persisted history (reconstructed from steps) and continues
 * the same agent rather than starting fresh.
 */

/** A run is "live" while its loop is actively executing in this session. */
interface LiveHandle {
  controller: AbortController;
  done: Promise<AgentRunStatus>;
}

export interface WorkspaceRunner {
  /** Start a brand-new agent on a goal. Returns its run id. */
  startLead: (goal: string) => Promise<string>;
  /** Continue an existing agent with a new instruction (same context). */
  reprompt: (runId: string, prompt: string) => Promise<void>;
  /** Abort a specific run's current turn. */
  stop: (runId: string) => void;
  /** True if any run in this workspace is currently executing. */
  isRunning: (runId?: string) => boolean;
}

export function useWorkspaceRunner(workspaceId: string): WorkspaceRunner {
  // Live handles keyed by run id. A ref (not state) because the loop reads/writes
  // it across awaits without needing re-renders.
  const liveRef = useRef<Map<string, LiveHandle>>(new Map());

  const startWorkspaceRun = useMimir((s) => s.startWorkspaceRun);
  const updateWorkspaceRun = useMimir((s) => s.updateWorkspaceRun);
  const appendRunStep = useMimir((s) => s.appendRunStep);
  const patchRunStep = useMimir((s) => s.patchRunStep);
  const appendRunToolEvent = useMimir((s) => s.appendRunToolEvent);
  const appendRunPrompt = useMimir((s) => s.appendRunPrompt);
  const setRunPlan = useMimir((s) => s.setRunPlan);
  const recordTurnOutcome = useMimir((s) => s.recordTurnOutcome);
  const setWorkspaceFiles = useMimir((s) => s.setWorkspaceFiles);

  /* ------------------------------ shared helpers ------------------------ */

  const getRun = useCallback(
    (runId: string): AgentRun | undefined =>
      useMimir.getState().workspaces[workspaceId]?.runs.find(
        (r) => r.id === runId
      ),
    [workspaceId]
  );

  const fsApi: WorkspaceFsApi = {
    getFiles: () => useMimir.getState().workspaces[workspaceId]?.files ?? [],
    setFiles: (files) => setWorkspaceFiles(workspaceId, files),
  };

  const planApiFor = useCallback(
    (runId: string): PlanApi => ({
      getPlan: () => getRun(runId)?.plan ?? [],
      setPlan: (plan) => setRunPlan(workspaceId, runId, plan),
    }),
    [workspaceId, getRun, setRunPlan]
  );

  /** Handlers that stream a turn's steps into the store for a given run. */
  const handlersFor = useCallback(
    (runId: string) => ({
      onStepCreated: (index: number, turn: number) =>
        appendRunStep(workspaceId, runId, {
          index,
          content: "",
          toolEvents: [],
          turn,
          at: Date.now(),
        }),
      onStepText: (index: number, content: string) =>
        patchRunStep(workspaceId, runId, index, { content }),
      onToolEvent: (index: number, event: ToolEvent) =>
        appendRunToolEvent(workspaceId, runId, index, event),
      onStepFinalized: (
        index: number,
        content: string,
        meta: import("@/lib/types").MessageMeta
      ) => patchRunStep(workspaceId, runId, index, { content, meta }),
    }),
    [workspaceId, appendRunStep, patchRunStep, appendRunToolEvent]
  );

  /* ------------------------------- the runner --------------------------- */

  /**
   * Runs one turn of a run. Builds the tool registry, wires up the loop, tracks
   * the live handle, and writes the terminal status back. Shared by startLead
   * and reprompt.
   */
  const startTurn = useCallback(
    (runId: string, prompt: string, turnIndex: number): Promise<AgentRunStatus> => {
      const state = useMimir.getState();
      const ws = state.workspaces[workspaceId];
      const run = ws?.runs.find((r) => r.id === runId);
      if (!ws || !run) return Promise.resolve("error" as AgentRunStatus);

      const resolved = resolveModelKey(run.model ?? ws.model, state.settings);
      if (!resolved) {
        updateWorkspaceRun(workspaceId, runId, {
          status: "error",
          error: "No model selected. Add an endpoint in Settings and pick a model.",
          finishedAt: Date.now(),
        });
        return Promise.resolve("error" as AgentRunStatus);
      }

      const cfg = ws.agent;

      const controller = new AbortController();

      // Filesystem always; shell always (it self-reports when unavailable);
      // planning always. No sub-agent tools — agents are single. The shell tool
      // gets the run's abort signal so Stop interrupts a long command promptly.
      const registry: ToolRegistry = {
        ...buildFilesystemTools(fsApi),
        run_command: buildRunCommandTool(workspaceId, fsApi, controller.signal),
        ...buildPlanningTools(planApiFor(runId)),
      };

      updateWorkspaceRun(workspaceId, runId, { status: "running" });

      const history = reconstructWorkingHistory(run).filter(
        // Drop the trailing copy of the prompt we're about to send.
        (_, i, arr) =>
          !(turnIndex > 0 && i === arr.length - 1 && arr[i]?.content === prompt)
      );

      const startStepIndex = run.steps.length;

      // Active context management for this turn (pruning + summarization),
      // built from the current settings and bound to this run's model.
      const contextSettings =
        state.settings.contextManagement ??
        // Defensive default for sessions whose settings predate this feature.
        ({
          toolPruning: { enabled: false, thresholdChars: 4000, tools: [] },
          summarization: { enabled: false, thresholdTokens: 24000, keepRecent: 6 },
        } as const);
      const context = makeContextRuntime({
        endpoint: resolved.url,
        apiKey: resolved.apiKey,
        model: resolved.modelId,
        settings: contextSettings,
        taskContext: () => prompt,
        signal: controller.signal,
      });

      const done = (async (): Promise<AgentRunStatus> => {
        try {
          const result = await runAgentTurn(
            {
              endpoint: resolved.url,
              apiKey: resolved.apiKey,
              model: resolved.modelId,
              prompt,
              history,
              turnIndex,
              instructions: cfg.instructions,
              extraSystemPrompts: workspaceScopedPromptTexts(
                Object.values(useMimir.getState().systemPrompts)
              ),
              persona: cfg.persona,
              registry,
              getFiles: fsApi.getFiles,
              getPlan: () => getRun(runId)?.plan ?? [],
              maxSteps: cfg.maxSteps,
              maxTokens: cfg.maxTokens,
              priorTokens: run.totalTokens,
              context,
              signal: controller.signal,
            },
            handlersFor(runId),
            startStepIndex
          );

          const status: AgentRunStatus =
            result.status === "max_steps" || result.status === "max_tokens"
              ? "idle"
              : result.status;

          updateWorkspaceRun(workspaceId, runId, {
            status,
            summary: result.summary,
            error: result.error,
            totalTokens: result.totalTokens,
            finishedAt: Date.now(),
          });
          recordTurnOutcome(workspaceId, runId, {
            turn: turnIndex,
            summary: result.summary,
            error: result.error,
            status,
            finishedAt: Date.now(),
          });
          return status;
        } catch (e) {
          updateWorkspaceRun(workspaceId, runId, {
            status: "error",
            error: (e as Error).message,
            finishedAt: Date.now(),
          });
          recordTurnOutcome(workspaceId, runId, {
            turn: turnIndex,
            error: (e as Error).message,
            status: "error",
            finishedAt: Date.now(),
          });
          return "error";
        } finally {
          liveRef.current.delete(runId);
        }
      })();

      liveRef.current.set(runId, { controller, done });
      return done;
    },
    [
      workspaceId,
      updateWorkspaceRun,
      planApiFor,
      handlersFor,
      getRun,
      recordTurnOutcome,
    ]
  );

  /* -------------------------------- public API -------------------------- */

  const startLead = useCallback(
    async (goal: string): Promise<string> => {
      const state = useMimir.getState();
      const ws = state.workspaces[workspaceId];
      if (!ws) return "";
      const runId = uid("run_");
      const run: AgentRun = {
        id: runId,
        goal,
        status: "running",
        steps: [],
        model: ws.model,
        totalTokens: 0,
        createdAt: Date.now(),
        prompts: [goal],
      };
      startWorkspaceRun(workspaceId, run);
      void startTurn(runId, goal, 0);
      return runId;
    },
    [workspaceId, startWorkspaceRun, startTurn]
  );

  const reprompt = useCallback(
    async (runId: string, prompt: string): Promise<void> => {
      const turnIndex = appendRunPrompt(workspaceId, runId, prompt);
      if (turnIndex < 0) return;
      void startTurn(runId, prompt, turnIndex);
    },
    [workspaceId, appendRunPrompt, startTurn]
  );

  const stop = useCallback(
    (runId: string) => {
      const handle = liveRef.current.get(runId);
      if (handle) {
        handle.controller.abort();
      } else {
        // Defensive: if we somehow don't have a handle for this run id, abort
        // every live run so a stuck loop can't keep going.
        for (const h of liveRef.current.values()) h.controller.abort();
      }
      // Optimistically reflect the stop in the store so the composer flips to
      // Send immediately, even if the loop is mid-tool and slow to notice the
      // aborted signal. The loop's own terminal write will be consistent.
      const run = getRun(runId);
      if (run && run.status === "running") {
        updateWorkspaceRun(workspaceId, runId, {
          status: "stopped",
          finishedAt: Date.now(),
        });
      }
    },
    [workspaceId, getRun, updateWorkspaceRun]
  );

  const isRunning = useCallback((runId?: string) => {
    if (runId) return liveRef.current.has(runId);
    return liveRef.current.size > 0;
  }, []);

  return { startLead, reprompt, stop, isRunning };
}
