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
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface RunLoopResult {
  /** Final assistant prose (the last completion that made no tool calls). */
  content: string;
  /** Stats from the final completion. */
  meta: Omit<ChatResult, "toolCalls" | "content">;
  /** Every tool call executed across all rounds, in order. */
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

  let lastMeta: Omit<ChatResult, "toolCalls" | "content"> = {};
  let finalText = "";

  for (let round = 0; round < maxRounds; round++) {
    const result = await streamChat(
      {
        endpoint,
        model,
        // Pass full messages so tool_calls / tool_call_id linkage survives.
        messages: working,
        system,
        tools,
        signal,
      },
      onText
    );

    const { toolCalls, content, ...meta } = result;
    lastMeta = meta;

    // No tool calls → the model is done. Whatever it streamed is the answer.
    if (toolCalls.length === 0) {
      finalText = content;
      break;
    }

    // Record the assistant's tool-call turn so the model sees its own request
    // alongside the results on the next round. Keep any prose it produced
    // before the call.
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
        name: call.name,
        args: parsedArgs,
        result: resultText,
      };
      toolEvents.push(event);
      onToolEvent?.(event);

      working.push({
        role: "tool",
        content: resultText,
        tool_call_id: `call_${round}_${i}`,
        name: call.name,
      });
    }

    // If we've hit the cap, stop and surface whatever prose exists.
    if (round === maxRounds - 1) {
      finalText = "";
    }
  }

  return { content: finalText, meta: lastMeta, toolEvents };
}
