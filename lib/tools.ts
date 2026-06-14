import { ApiMessage, ChatResult, streamChat, ToolDef } from "./llama";

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
}

export interface ToolEvent {
  /** Stable index used by the inline transcript marker. */
  index: number;
  name: string;
  args: Record<string, unknown>;
  result: string;
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
  }: RunLoopParams,
  onText: (accumulated: string) => void,
  onToolEvent?: (event: ToolEvent) => void
): Promise<RunLoopResult> {
  const tools = Object.values(registry).map((t) => t.def);
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
      const handler = registry[call.name];
      let resultText: string;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        parsedArgs = {};
      }

      if (!handler) {
        resultText = `Error: no tool named "${call.name}" is available.`;
      } else {
        try {
          resultText = await handler.run(parsedArgs);
        } catch (e) {
          resultText = `Error: ${(e as Error).message}`;
        }
      }

      const event: ToolEvent = {
        index: toolEvents.length,
        name: call.name,
        args: parsedArgs,
        result: resultText,
      };
      committed += toolMarker(event.index);
      toolEvents.push(event);
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
