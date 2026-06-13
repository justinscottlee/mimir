import { LlamaModel, MessageMeta, Role } from "./types";

/**
 * All requests go through /api/llama/* on the Next.js server, which forwards
 * them to the llama.cpp endpoint named in the `x-llama-base` header. This
 * sidesteps CORS entirely and keeps the browser talking only to Talos.
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

export interface ChatParams {
  endpoint: string;
  model: string;
  messages: { role: Role; content: string }[];
  signal?: AbortSignal;
}

/**
 * Streams a chat completion. `onToken` receives the accumulated text after
 * every delta. Resolves with generation stats once the stream ends.
 */
export async function streamChat(
  { endpoint, model, messages, signal }: ChatParams,
  onToken: (accumulated: string) => void
): Promise<MessageMeta> {
  const started = performance.now();

  const res = await fetch("/api/llama/v1/chat/completions", {
    method: "POST",
    headers: headers(endpoint),
    signal,
    body: JSON.stringify({
      model,
      messages,
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
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let timings:
    | { prompt_n?: number; predicted_n?: number; predicted_per_second?: number }
    | undefined;

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
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            chunkCount++;
            onToken(accumulated);
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

  const durationMs = performance.now() - started;
  // Prefer server-reported numbers; fall back to chunk count (≈1 token/chunk).
  const completionTokens =
    usage?.completion_tokens ?? timings?.predicted_n ?? chunkCount;
  const promptTokens = usage?.prompt_tokens ?? timings?.prompt_n;
  const tokensPerSecond =
    timings?.predicted_per_second ??
    (durationMs > 0 ? completionTokens / (durationMs / 1000) : undefined);

  return { promptTokens, completionTokens, tokensPerSecond, durationMs };
}
