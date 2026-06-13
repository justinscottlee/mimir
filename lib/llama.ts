import { LlamaModel, Role } from "./types";

/**
 * All requests go through /api/llama/* on the Next.js server, which forwards
 * them to the llama.cpp endpoint named in the `x-llama-base` header. This
 * sidesteps CORS entirely and keeps the browser talking only to Talos.
 *
 * llama.cpp's server exposes an OpenAI-compatible API:
 *   GET  /v1/models            -> { data: [{ id }, ...] }
 *   POST /v1/chat/completions  -> SSE stream when stream: true
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

export interface ChatParams {
  endpoint: string;
  model: string;
  messages: { role: Role; content: string }[];
  signal?: AbortSignal;
}

/** Streams assistant tokens as they arrive. */
export async function* streamChat({
  endpoint,
  model,
  messages,
  signal,
}: ChatParams): AsyncGenerator<string> {
  const res = await fetch("/api/llama/v1/chat/completions", {
    method: "POST",
    headers: headers(endpoint),
    signal,
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Endpoint responded ${res.status}${text ? `: ${text}` : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines; each data line is JSON.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Partial frame; wait for more bytes.
      }
    }
  }
}
