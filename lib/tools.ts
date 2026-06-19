import { ApiMessage, ChatResult, streamChat, ToolDef } from "./llama";
import { CONTEXT_COMPACTION_TOOL } from "./contextManager";

/**
 * A registered tool: the schema advertised to the model plus the handler that
 * executes a call. Every tool — remember, web_search, read_file, … — is just
 * an entry here. The loop below is tool-agnostic; adding a capability means
 * adding one registry entry, nothing in the loop changes.
 */
export interface ToolHandler {
  def: ToolDef;
  /**
   * Executes the call. `args` is the parsed JSON arguments. Returns a string
   * that is fed back to the model as the tool result. Throwing is fine — the
   * error message is returned to the model so it can react.
   */
  run: (args: Record<string, unknown>) => Promise<string> | string;
}

export type ToolRegistry = Record<string, ToolHandler>;

/** OpenAI-style chat message, including the tool/assistant-tool-call shapes. */
export type ChatMessage = ApiMessage;

export interface RunLoopParams {
  endpoint: string;
  /** Bearer token for hosted APIs; omitted for local llama.cpp. */
  apiKey?: string;
  model: string;
  /** Conversation so far (user/assistant/system), excluding the system prefix. */
  messages: ChatMessage[];
  system?: string;
  registry: ToolRegistry;
  signal?: AbortSignal;
  /** Safety cap on tool rounds so a confused model can't spin forever. */
  maxRounds?: number;
  /** Optional active context management (tool-output pruning + summarization). */
  context?: import("./contextManager").ContextRuntime;
}

export interface ToolEvent {
  /** Stable index used by the inline transcript marker. */
  index: number;
  name: string;
  args: Record<string, unknown>;
  result: string;
  /** True while the tool is still executing (no result yet). */
  pending?: boolean;
  /** Raw vs distilled character counts when the output was pruned. */
  pruned?: { before: number; after: number };
  /** Token counts before/after for a recursive-summarization pass. */
  compaction?: { before: number; after: number };
}

/**
 * Sentinel injected into the message content where a tool call occurred, so
 * the display can render the tool chip inline, in order. Parsed by
 * `parseTranscript` in the chat view. Format: ⟦tool:0⟧ referencing
 * toolEvents[0]. The bracket glyphs are unlikely to appear in model output.
 */
export const TOOL_MARKER_RE = /⟦tool:(\d+)⟧/g;
export function toolMarker(index: number): string {
  return `\n\n⟦tool:${index}⟧\n\n`;
}

/**
 * Parse a tool call's JSON arguments, tolerating empty or malformed input
 * (models occasionally emit invalid JSON). Always returns an object. Shared by
 * the chat and agent loops so they parse identically.
 */
export function parseToolArgs(rawArguments?: string): Record<string, unknown> {
  if (!rawArguments) return {};
  try {
    const v = JSON.parse(rawArguments);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Run a tool handler from a registry with uniform error capture, or report an
 * unknown tool. The result string is fed back to the model as the tool result.
 * Shared by both loops; the differing parts (how the in-flight/finished chips
 * are surfaced, marker indexing, task_complete, abort handling) stay in each
 * loop because their transcript models intentionally differ.
 */
export async function runToolHandler(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const handler = registry[name];
  if (!handler) return `Error: no tool named "${name}" is available.`;
  try {
    return await handler.run(args);
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

export interface RunLoopResult {
  /**
   * The full assistant transcript across all rounds: each round's text in
   * order, with a ⟦tool:N⟧ marker inserted where each tool call occurred.
   */
  content: string;
  /** Stats from the final completion. */
  meta: Omit<ChatResult, "toolCalls" | "content">;
  /** Every tool call executed across all rounds, indexed to match markers. */
  toolEvents: ToolEvent[];
}

/**
 * Drives the full tool-use protocol within one logical response:
 *
 *   1. Stream a completion (with tools advertised).
 *   2. If the model emitted tool calls, run each, append the assistant
 *      tool-call message and a `tool` result message, and loop.
 *   3. If it emitted only prose, we're done.
 *
 * `onText` streams the *current* completion's accumulated text so the UI can
 * show tokens live; it's called fresh for each round. `onToolEvent` fires
 * after each tool runs so the UI can show "calling remember…" style status.
 */
export async function runToolLoop(
  {
    endpoint,
    apiKey,
    model,
    messages,
    system,
    registry,
    signal,
    maxRounds = 5,
    context,
  }: RunLoopParams,
  onText: (accumulated: string) => void,
  onToolEvent?: (event: ToolEvent) => void
): Promise<RunLoopResult> {
  // Tool-output pruning (if enabled) wraps the registry so verbose results get
  // distilled by a transient model call before entering context.
  const liveRegistry = context?.pruneRegistry
    ? context.pruneRegistry(registry)
    : registry;
  const tools = Object.values(liveRegistry).map((t) => t.def);
  const working: ChatMessage[] = [...messages];
  const toolEvents: ToolEvent[] = [];

  // Accumulate stats across every round so the reported duration and token
  // counts cover the whole response, not just the final request. A response
  // with tool calls makes several HTTP requests; previously only the last
  // one's timing was kept, undercounting the real generation time.
  let totalDurationMs = 0; // wall-clock across all requests (shown as the time)
  let totalCompletionTokens = 0;
  let totalGenMs = 0; // pure generation time, for an accurate tok/s
  let lastPromptTokens: number | undefined;
  let lastTps: number | undefined;
  let rounds = 0;
  let committed = "";

  for (let round = 0; round < maxRounds; round++) {
    // Recursive summarization: compress old history if the context grew large.
    // When it fires, surface it as a chip so it's visible that context was saved.
    if (context?.manageContext) {
      const managed = await context.manageContext(working);
      if (managed.compressed) {
        working.length = 0;
        working.push(...managed.messages);
        const event: ToolEvent = {
          index: toolEvents.length,
          name: CONTEXT_COMPACTION_TOOL,
          args: {},
          result:
            "Compressed the earlier part of this conversation into a summary to free up context.",
          compaction: {
            before: managed.beforeTokens ?? 0,
            after: managed.afterTokens ?? 0,
          },
        };
        committed += toolMarker(event.index);
        toolEvents.push(event);
        onToolEvent?.(event);
        onText(committed);
      }
    }

    const result = await streamChat(
      {
        endpoint,
        apiKey,
        model,
        messages: working,
        system,
        tools,
        signal,
      },
      (accumulated) => onText(committed + accumulated)
    );

    const { toolCalls, content, ...meta } = result;
    rounds++;
    totalDurationMs += meta.durationMs ?? 0;
    totalCompletionTokens += meta.completionTokens ?? 0;
    lastTps = meta.tokensPerSecond;
    // Estimate this round's pure generation time from its reported throughput,
    // falling back to wall-clock. Used to derive an aggregate tok/s.
    totalGenMs +=
      meta.tokensPerSecond && meta.completionTokens
        ? (meta.completionTokens / meta.tokensPerSecond) * 1000
        : meta.durationMs ?? 0;
    // The final round's prompt is the largest (it includes all prior tool
    // results), so it best reflects the context the model actually saw.
    if (meta.promptTokens != null) lastPromptTokens = meta.promptTokens;

    // No tool calls → done. Append this round's text and finish.
    if (toolCalls.length === 0) {
      committed += content;
      break;
    }

    // Keep this round's prose (it precedes the tool calls), then a marker per
    // tool call so the display can render chips inline and in order.
    committed += content;

    working.push({
      role: "assistant",
      content,
      tool_calls: toolCalls.map((tc, i) => ({
        id: `call_${round}_${i}`,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Execute each call and append its result.
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const known = !!liveRegistry[call.name];
      const parsedArgs = parseToolArgs(call.arguments);
      let resultText: string;

      if (!known) {
        resultText = `Error: no tool named "${call.name}" is available.`;
      } else {
        // Reserve this event's slot and show a live, spinning chip *before* the
        // tool runs, so a slow tool (a web search, plus any pruning of its
        // output) is visibly in progress instead of looking like generation
        // stalled. We re-emit the same index with the result when it finishes.
        const pendingIndex = toolEvents.length;
        const pendingEvent: ToolEvent = {
          index: pendingIndex,
          name: call.name,
          args: parsedArgs,
          result: "",
          pending: true,
        };
        committed += toolMarker(pendingIndex);
        toolEvents.push(pendingEvent);
        onToolEvent?.(pendingEvent);
        onText(committed);
        resultText = await runToolHandler(liveRegistry, call.name, parsedArgs);
      }

      const event: ToolEvent = {
        index: known ? toolEvents.length - 1 : toolEvents.length,
        name: call.name,
        args: parsedArgs,
        result: resultText,
      };
      // If the context manager distilled this tool's output, tag the chip.
      const pruneInfo = context?.takePruneInfo();
      if (pruneInfo) {
        event.pruned = { before: pruneInfo.before, after: pruneInfo.after };
      }
      if (known) {
        // Replace the pending chip (same index) with the finished one.
        toolEvents[event.index] = event;
      } else {
        committed += toolMarker(event.index);
        toolEvents.push(event);
      }
      onToolEvent?.(event);
      onText(committed); // reflect the new chip immediately

      working.push({
        role: "tool",
        content: resultText,
        tool_call_id: `call_${round}_${i}`,
        name: call.name,
      });
    }
  }

  const aggregatedMeta: Omit<ChatResult, "toolCalls" | "content"> = {
    promptTokens: lastPromptTokens,
    completionTokens: totalCompletionTokens || undefined,
    durationMs: totalDurationMs || undefined,
    // Single round: keep the server-reported throughput (most accurate).
    // Multiple rounds: derive overall throughput from total generation time.
    tokensPerSecond:
      rounds <= 1
        ? lastTps
        : totalGenMs > 0
        ? totalCompletionTokens / (totalGenMs / 1000)
        : undefined,
  };

  return { content: committed, meta: aggregatedMeta, toolEvents };
}
