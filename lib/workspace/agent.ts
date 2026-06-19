import { ApiMessage, streamChat, ToolDef } from "../llama";
import {
  ToolEvent,
  ToolRegistry,
  toolMarker,
  TOOL_MARKER_RE,
  parseToolArgs,
  runToolHandler,
} from "../tools";
import {
  AgentRun,
  AgentRunStatus,
  MessageMeta,
  PlanItem,
  WorkspaceFile,
} from "../types";
import { flatManifest, renderTree } from "./fs";
import { composeAgentSystem } from "./agentPrompts";
import { renderPlan } from "./planTool";
import { CONTEXT_COMPACTION_TOOL } from "../contextManager";

/**
 * The workspace agent loop. Where `runToolLoop` (lib/tools.ts) resolves a single
 * chat turn, this drives a *multi-step* autonomous run: the model keeps working
 * toward a goal across many turns, observing tool results between them, until it
 * declares the task complete or hits a safety cap.
 *
 * As of the workspaces overhaul this loop runs ONE conversational turn of a
 * resumable agent. A "turn" is everything the agent does in response to a single
 * prompt — possibly many steps. When the turn ends, the agent goes idle (or
 * finishes), and the user can re-prompt it: a fresh call to `runAgentTurn`
 * replays the prior turns as history and continues the same agent in the same
 * context, rather than starting over. The prior history is reconstructed from
 * the run's persisted steps so resume survives a page reload.
 *
 * The loop also drives the plan checklist (via the plan tools' effect on the
 * run) and per-step message delivery (unread messages are surfaced in the
 * system prompt). It streams every token and tool event out through callbacks
 * so the workspace UI renders the run live.
 */

/** The tool the agent calls to end its run with a summary of what it did. */
export const TASK_COMPLETE_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "task_complete",
    description:
      "Call this once the goal is fully accomplished to end your work for now. Provide a concise summary of what you did and the final state (key files created or changed). Do NOT call this prematurely — only when the work for the current request is genuinely finished. If you cannot finish, call it anyway with a summary that explains what is blocking you. After this, the user can still send you a new instruction to continue.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "A short summary of the outcome: what you built or changed, and anything the user should know.",
        },
      },
      required: ["summary"],
    },
  },
};

export const TASK_COMPLETE_NAME = "task_complete";

/** Strips ⟦tool:N⟧ markers and <think> blocks from step text for replay. */
function cleanStepTextForReplay(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(TOOL_MARKER_RE, "")
    .trim();
}

/**
 * Rebuilds the OpenAI-format working history a model needs from a run's
 * persisted prompts and steps. Each step becomes an assistant message (its
 * prose, with tool-call linkage) followed by one `tool` result message per tool
 * event. User prompts are interleaved at their turn boundaries. This is what
 * makes re-prompting continue the same agent even after a reload — we never
 * relied on an in-memory message array.
 */
export function reconstructWorkingHistory(run: AgentRun): ApiMessage[] {
  const prompts = run.prompts ?? (run.goal ? [run.goal] : []);
  const out: ApiMessage[] = [];

  // Group steps by their turn so prompts can be slotted before each turn's
  // steps. Steps without a turn (legacy) are treated as turn 0.
  const stepsByTurn = new Map<number, typeof run.steps>();
  for (const step of run.steps) {
    const t = step.turn ?? 0;
    const list = stepsByTurn.get(t) ?? [];
    list.push(step);
    stepsByTurn.set(t, list);
  }

  const turnCount = Math.max(
    prompts.length,
    ...[...stepsByTurn.keys()].map((k) => k + 1),
    0
  );

  let callSeq = 0;
  for (let turn = 0; turn < turnCount; turn++) {
    if (prompts[turn] != null) {
      out.push({ role: "user", content: prompts[turn] });
    }
    const steps = stepsByTurn.get(turn) ?? [];
    for (const step of steps) {
      const events = step.toolEvents ?? [];
      const prose = cleanStepTextForReplay(step.content);
      if (events.length === 0) {
        if (prose) out.push({ role: "assistant", content: prose });
        continue;
      }
      const callIds = events.map(() => `call_r_${callSeq++}`);
      out.push({
        role: "assistant",
        content: prose,
        tool_calls: events.map((ev, i) => ({
          id: callIds[i],
          type: "function",
          function: { name: ev.name, arguments: JSON.stringify(ev.args ?? {}) },
        })),
      });
      events.forEach((ev, i) => {
        out.push({
          role: "tool",
          content: ev.result,
          tool_call_id: callIds[i],
          name: ev.name,
        });
      });
    }
  }

  return out;
}

/** Builds the live filesystem block for the system prompt. */
function filesystemBlock(files: WorkspaceFile[]): string {
  const tree = files.length > 0 ? renderTree(files) : "/  (empty)";
  return `Current filesystem (this updates as you work):\n${tree}\n\nFiles:\n${flatManifest(
    files
  )}`;
}

/**
 * Builds the agent's system prompt for a single step, composing the persona,
 * active capability blocks, standing instructions, the live plan, and the
 * filesystem manifest. Exported for the transparency view.
 */
export function buildAgentSystem(args: {
  files: WorkspaceFile[];
  instructions?: string;
  extraSystemPrompts?: string[];
  toolNames: string[];
  persona?: import("../types").AgentPersonaKey;
  plan?: PlanItem[];
}): string {
  const { files, instructions, toolNames } = args;
  const canExecute = toolNames.includes("run_command");
  const hasPlanning = toolNames.includes("set_plan");
  const canWeb =
    toolNames.includes("web_search") || toolNames.includes("web_fetch");

  const planText =
    args.plan && args.plan.length > 0
      ? `Your current plan (keep it updated; the user may have edited it):\n${renderPlan(
          args.plan
        )}`
      : undefined;

  return composeAgentSystem({
    persona: args.persona,
    instructions,
    extraSystemPrompts: args.extraSystemPrompts,
    canExecute,
    canWeb,
    hasPlanning,
    toolNames,
    filesystem: filesystemBlock(files),
    planText,
  });
}

export interface AgentTurnParams {
  endpoint: string;
  apiKey?: string;
  model: string;
  /** The new prompt driving this turn (the latest user instruction). */
  prompt: string;
  /** Prior turns replayed as history so the agent continues in context. */
  history: ApiMessage[];
  /** The turn index this run is (0 for the first prompt). */
  turnIndex: number;
  /** Standing per-workspace instructions, folded into the system prompt. */
  instructions?: string;
  /** Enabled workspace-scoped global system prompts, folded into the prompt. */
  extraSystemPrompts?: string[];
  /** Which persona to use. */
  persona?: import("../types").AgentPersonaKey;
  /** Tool registry (task_complete is added automatically). */
  registry: ToolRegistry;
  /** Reads the current files so the per-step system manifest stays fresh. */
  getFiles: () => WorkspaceFile[];
  /** Reads the current plan so the per-step system prompt shows it. */
  getPlan?: () => PlanItem[];
  maxSteps: number;
  /** Budget on cumulative output (completion) tokens across the run so far. */
  maxTokens: number;
  /** Tokens already spent in prior turns (counts toward maxTokens). */
  priorTokens?: number;
  /** Optional active context management (tool-output pruning + summarization). */
  context?: import("../contextManager").ContextRuntime;
  signal?: AbortSignal;
}

export interface AgentTurnHandlers {
  /** A new step (model turn) has begun; the UI should append an empty step. */
  onStepCreated: (index: number, turn: number) => void;
  /** Live content for the current step (prose, plus ⟦tool:N⟧ markers). */
  onStepText: (index: number, content: string) => void;
  /** A tool finished running during this step. */
  onToolEvent: (index: number, event: ToolEvent) => void;
  /** The step is finalized with its complete content and stats. */
  onStepFinalized: (index: number, content: string, meta: MessageMeta) => void;
}

export interface AgentTurnResult {
  status: AgentRunStatus;
  summary?: string;
  error?: string;
  /** Tokens spent this turn. */
  turnTokens: number;
  /** Cumulative tokens (priorTokens + turnTokens). */
  totalTokens: number;
  steps: number;
}

/** Max consecutive turns with no tool call before we declare the run stalled. */
const MAX_NOOP_STEPS = 2;

/**
 * Runs ONE conversational turn of a resumable agent. The next step index is the
 * length of the run's existing steps, so a resumed agent keeps numbering up.
 */
export async function runAgentTurn(
  params: AgentTurnParams,
  handlers: AgentTurnHandlers,
  /** The step index to start numbering at (existing steps count). */
  startStepIndex: number
): Promise<AgentTurnResult> {
  const {
    endpoint,
    apiKey,
    model,
    prompt,
    history,
    turnIndex,
    instructions,
    extraSystemPrompts,
    persona,
    registry,
    getFiles,
    getPlan,
    maxSteps,
    maxTokens,
    priorTokens = 0,
    context,
    signal,
  } = params;

  // task_complete is owned by the loop, not the tool registry. Tool-output
  // pruning (if enabled) wraps the registry so verbose results are distilled by
  // a transient model call before they enter context.
  const liveRegistry = context?.pruneRegistry
    ? context.pruneRegistry(registry)
    : registry;
  const tools: ToolDef[] = [
    ...Object.values(liveRegistry).map((t) => t.def),
    TASK_COMPLETE_TOOL,
  ];
  const toolNames = [...Object.keys(liveRegistry), TASK_COMPLETE_NAME];

  const working: ApiMessage[] = [...history, { role: "user", content: prompt }];

  let turnTokens = 0;
  let noopStreak = 0;
  let status: AgentRunStatus = "running";
  let summary: string | undefined;
  let error: string | undefined;
  let stepsRun = 0;
  let stepIndex = startStepIndex;

  // True once this turn's tokens (plus the run's prior tokens) reach the cap.
  const budgetExhausted = () => priorTokens + turnTokens >= maxTokens;

  for (let step = 0; step < maxSteps; step++) {
    const idx = stepIndex++;
    handlers.onStepCreated(idx, turnIndex);

    // Stop promptly if the run was aborted between model calls (e.g. while a
    // slow tool was finishing) rather than only noticing inside streamChat.
    if (signal?.aborted) {
      status = "stopped";
      break;
    }

    // Recursive summarization: if the working context has grown past the
    // configured threshold, compress the oldest messages into a memory block
    // (via a transient model call) before sending this step. We remember it so
    // it can be surfaced as the step's first chip once the step has content.
    let compaction: { before: number; after: number } | null = null;
    if (context?.manageContext) {
      const managed = await context.manageContext(working);
      if (managed.compressed) {
        working.length = 0;
        working.push(...managed.messages);
        compaction = {
          before: managed.beforeTokens ?? 0,
          after: managed.afterTokens ?? 0,
        };
      }
    }

    const system = buildAgentSystem({
      files: getFiles(),
      instructions,
      extraSystemPrompts,
      toolNames,
      persona,
      plan: getPlan?.(),
    });

    // Think-timing, mirroring the chat: measure time spent inside <think>.
    let committed = "";
    let thinkStart: number | null = null;
    let thinkingMs = 0;
    let sawOpen = false;
    let sawClose = false;

    let result;
    try {
      result = await streamChat(
        { endpoint, apiKey, model, messages: working, system, tools, signal },
        (accumulated) => {
          if (!sawOpen && accumulated.includes("<think>")) {
            sawOpen = true;
            thinkStart = performance.now();
          }
          if (sawOpen && !sawClose && accumulated.includes("</think>")) {
            sawClose = true;
            if (thinkStart != null) thinkingMs = performance.now() - thinkStart;
          }
          handlers.onStepText(idx, accumulated);
        }
      );
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        status = "stopped";
      } else {
        status = "error";
        error = (e as Error).message;
      }
      break;
    }

    stepsRun++;
    if (sawOpen && !sawClose && thinkStart != null) {
      thinkingMs = performance.now() - thinkStart;
    }

    const { toolCalls, content, ...meta } = result;
    turnTokens += meta.completionTokens ?? 0;
    committed = content;

    // If we compacted context before this step, show it as the step's first
    // chip (prepended) so it's visible how much context was saved.
    let localIndex = 0;
    if (compaction) {
      const ci = localIndex++;
      committed = toolMarker(ci) + committed;
      handlers.onToolEvent(idx, {
        index: ci,
        name: CONTEXT_COMPACTION_TOOL,
        args: {},
        result:
          "Compressed the earlier part of this run into a summary to free up context.",
        compaction,
      });
    }
    handlers.onStepText(idx, committed);

    const stepMeta: MessageMeta = {
      promptTokens: meta.promptTokens,
      completionTokens: meta.completionTokens,
      tokensPerSecond: meta.tokensPerSecond,
      durationMs: meta.durationMs,
      thinkingMs: thinkingMs || undefined,
    };

    // No tool calls this turn → the model is talking, not acting. Nudge it back
    // to work (or to finish), and stall if it keeps doing this.
    if (toolCalls.length === 0) {
      handlers.onStepFinalized(idx, committed, stepMeta);
      noopStreak++;
      if (noopStreak > MAX_NOOP_STEPS) {
        status = "stalled";
        error =
          "The model stopped calling tools without finishing the task. Try a clearer goal or a more capable model.";
        break;
      }
      working.push({ role: "assistant", content });
      working.push({
        role: "user",
        content:
          "You did not call any tool. Remember: you are running autonomously and must act through tools. If the task is fully complete, call task_complete with a summary now. Otherwise continue the work by calling your tools — do not just describe what you would do.",
      });
      if (budgetExhausted()) {
        status = "max_tokens";
        break;
      }
      continue;
    }

    noopStreak = 0;

    // Record the assistant turn with its tool calls for protocol linkage.
    working.push({
      role: "assistant",
      content,
      tool_calls: toolCalls.map((tc, i) => ({
        id: `call_${idx}_${i}`,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    let finished = false;
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const parsedArgs = parseToolArgs(call.arguments);

      // Show the tool as in-flight *before* running it: inject its marker and
      // emit a pending event so a live, spinning chip with the command appears
      // immediately, instead of the UI looking stalled during a slow tool.
      const toolIndex = localIndex;
      committed += toolMarker(toolIndex);
      handlers.onStepText(idx, committed);
      handlers.onToolEvent(idx, {
        index: toolIndex,
        name: call.name,
        args: parsedArgs,
        result: "",
        pending: true,
      });

      let resultText: string;
      if (call.name === TASK_COMPLETE_NAME) {
        const s =
          typeof parsedArgs.summary === "string" ? parsedArgs.summary.trim() : "";
        summary = s || "(no summary provided)";
        resultText = "Run marked complete.";
        finished = true;
      } else {
        resultText = await runToolHandler(liveRegistry, call.name, parsedArgs);
      }

      const event: ToolEvent = {
        index: toolIndex,
        name: call.name,
        args: parsedArgs,
        result: resultText,
      };
      // If the context manager distilled this tool's output, tag the chip.
      const pruneInfo = context?.takePruneInfo();
      if (pruneInfo) {
        event.pruned = { before: pruneInfo.before, after: pruneInfo.after };
      }
      // Replace the pending event with the finished one (upsert by index).
      handlers.onToolEvent(idx, event);
      localIndex++;

      working.push({
        role: "tool",
        content: resultText,
        tool_call_id: `call_${idx}_${i}`,
        name: call.name,
      });

      // A stop pressed during a slow tool takes effect as soon as it returns.
      if (signal?.aborted) {
        finished = false;
        status = "stopped";
        break;
      }
    }

    handlers.onStepFinalized(idx, committed, stepMeta);

    if (status === "stopped") break;
    if (finished) {
      status = "done";
      break;
    }
    if (budgetExhausted()) {
      status = "max_tokens";
      break;
    }
  }

  // Fell out of the loop without finishing → we exhausted the step cap.
  if (status === "running") {
    status = "max_steps";
  }

  return {
    status,
    summary,
    error,
    turnTokens,
    totalTokens: priorTokens + turnTokens,
    steps: stepsRun,
  };
}
