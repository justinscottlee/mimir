import { LlamaModel, MessageMeta, Role } from "./types";

/**
 * All requests go through /api/llama/* on the Next.js server, which forwards
 * them to the llama.cpp endpoint named in the `x-llama-base` header. This
 * sidesteps CORS entirely and keeps the browser talking only to Mimir.
 *
 * llama.cpp's server exposes an OpenAI-compatible API:
 *   GET  /v1/models            -> { data: [{ id }, ...] }
 *   POST /v1/chat/completions  -> SSE stream when stream: true
 *   GET  /props                -> server properties incl. n_ctx (llama.cpp only)
 */

function headers(endpoint: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-llama-base": endpoint,
  };
}

export async function listModels(endpoint: string): Promise<LlamaModel[]> {
  const res = await fetch("/api/llama/v1/models", {
    headers: headers(endpoint),
  });
  if (!res.ok) {
    throw new Error(`Endpoint responded ${res.status}`);
  }
  const json = await res.json();
  return (json.data ?? []).map((m: { id: string }) => ({ id: m.id }));
}

/** Reads the server context size from llama.cpp's /props, if available. */
export async function fetchContextSize(
  endpoint: string
): Promise<number | null> {
  try {
    const res = await fetch("/api/llama/props", { headers: headers(endpoint) });
    if (!res.ok) return null;
    const json = await res.json();
    return (
      json?.default_generation_settings?.n_ctx ??
      json?.n_ctx ??
      null
    );
  } catch {
    return null;
  }
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  name: string;
  /** Raw JSON argument string as assembled from the stream. */
  arguments: string;
}

/** A message in the OpenAI chat format, including tool-call linkage. */
export interface ApiMessage {
  role: Role | "tool";
  content: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatParams {
  endpoint: string;
  model: string;
  messages: ApiMessage[];
  /** Optional system text prepended ahead of the conversation. */
  system?: string;
  /** Tools advertised to the model (OpenAI function-calling format). */
  tools?: ToolDef[];
  signal?: AbortSignal;
}

export interface ChatResult extends MessageMeta {
  /** The full assistant text produced this completion. */
  content: string;
  /** Any tool calls the model emitted during this completion. */
  toolCalls: ToolCall[];
}

/**
 * Streams a chat completion. `onToken` receives the accumulated text after
 * every delta. Resolves with generation stats and any tool calls once the
 * stream ends.
 */
export async function streamChat(
  { endpoint, model, messages, system, tools, signal }: ChatParams,
  onToken: (accumulated: string) => void
): Promise<ChatResult> {
  const started = performance.now();

  const res = await fetch("/api/llama/v1/chat/completions", {
    method: "POST",
    headers: headers(endpoint),
    signal,
    body: JSON.stringify({
      model,
      messages: system
        ? [{ role: "system", content: system }, ...messages]
        : messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      stream: true,
      // llama.cpp honors this and reports token usage in the final chunk.
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Endpoint responded ${res.status}${text ? `: ${text}` : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let chunkCount = 0;
  // Reasoning handling: llama.cpp's default reasoning_format puts thoughts in a
  // separate `reasoning_content` field rather than inline <think> tags. We
  // re-wrap that field as <think>…</think> so the transcript parser sees one
  // uniform format regardless of server config. `reasoningOpen` tracks whether
  // we've emitted an unclosed <think> that still needs a </think>.
  let reasoningOpen = false;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let timings:
    | { prompt_n?: number; predicted_n?: number; predicted_per_second?: number }
    | undefined;
  // Tool calls stream in fragments keyed by index; assemble them here.
  const toolAcc = new Map<number, { name: string; arguments: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are newline-delimited; each data line is JSON.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const choiceDelta = json.choices?.[0]?.delta;

          // Separate reasoning field (deepseek/auto format). Wrap in <think>.
          const reasoning =
            choiceDelta?.reasoning_content ?? choiceDelta?.reasoning;
          if (reasoning) {
            if (!reasoningOpen) {
              accumulated += "<think>";
              reasoningOpen = true;
            }
            accumulated += reasoning;
            chunkCount++;
            onToken(accumulated);
          }

          const delta = choiceDelta?.content;
          if (delta) {
            // First content token after reasoning closes the think block.
            if (reasoningOpen) {
              accumulated += "</think>";
              reasoningOpen = false;
            }
            accumulated += delta;
            chunkCount++;
            onToken(accumulated);
          }
          // Tool-call fragments: { index, function: { name?, arguments? } }
          const tcs = choiceDelta?.tool_calls;
          if (Array.isArray(tcs)) {
            // A tool call also ends any open reasoning block.
            if (reasoningOpen) {
              accumulated += "</think>";
              reasoningOpen = false;
              onToken(accumulated);
            }
            for (const tc of tcs) {
              const idx = tc.index ?? 0;
              const entry = toolAcc.get(idx) ?? { name: "", arguments: "" };
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
              toolAcc.set(idx, entry);
            }
          }
          if (json.usage) usage = json.usage;
          if (json.timings) timings = json.timings;
        } catch {
          // Partial frame; wait for more bytes.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Close a reasoning block that never saw following content (pure-thought
  // response or abrupt end) so the parser always sees a balanced tag.
  if (reasoningOpen) {
    accumulated += "</think>";
    onToken(accumulated);
  }

  const durationMs = performance.now() - started;
  // Prefer server-reported numbers; fall back to chunk count (≈1 token/chunk).
  const completionTokens =
    usage?.completion_tokens ?? timings?.predicted_n ?? chunkCount;
  const promptTokens = usage?.prompt_tokens ?? timings?.prompt_n;
  const tokensPerSecond =
    timings?.predicted_per_second ??
    (durationMs > 0 ? completionTokens / (durationMs / 1000) : undefined);

  const toolCalls: ToolCall[] = Array.from(toolAcc.values()).filter(
    (t) => t.name
  );

  return {
    content: accumulated,
    promptTokens,
    completionTokens,
    tokensPerSecond,
    durationMs,
    toolCalls,
  };
}
