import { Memory } from "./types";

/**
 * How memories reach the model — two directions:
 *
 * 1. READ (injection): before each completion we take the enabled memories
 *    and prepend them as a system message. The model simply "knows" them.
 *
 * 2. WRITE (tool call): we advertise a `remember` tool in the request. When
 *    the model decides a fact is worth keeping, it calls the tool instead of
 *    (or alongside) replying. We intercept the call, store the memory, and
 *    feed back a confirmation so the model can continue. The model is never
 *    writing to storage directly — it only emits an intent, and Talos owns
 *    the actual mutation. That keeps the user in control (every write is
 *    visible and reversible in the Memories window).
 *
 * llama.cpp supports OpenAI-style tools/function-calling on models trained
 * for it. On models that don't, the tool is simply never called and only the
 * injection path is active — graceful degradation, nothing breaks.
 */

/** The tools we expose to the model. Kept here so chat and docs share one source. */
export const MEMORY_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "remember",
      description:
        "Save a durable fact about the user or their environment that will be useful in future conversations. Use for stable preferences, recurring context, names of machines/projects, and standing instructions — not for one-off details or anything the user asked you to forget.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The fact as a standalone statement, e.g. 'The user runs llama.cpp on a machine named brutus at 192.168.1.50'.",
          },
          category: {
            type: "string",
            description:
              "Optional short grouping label, e.g. 'preferences', 'hardware', 'projects'.",
          },
        },
        required: ["content"],
      },
    },
  },
];

/** Builds the system message that carries enabled memories into a completion. */
export function buildMemoryPrompt(memories: Memory[]): string | null {
  const active = memories.filter((m) => m.enabled);
  if (active.length === 0) return null;

  const byCategory = new Map<string, Memory[]>();
  for (const m of active) {
    const key = m.category?.trim() || "general";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(m);
  }

  const lines: string[] = [
    "The following are saved facts about the user and their environment. Treat them as background knowledge. Do not repeat them back unless relevant.",
  ];
  for (const [category, items] of byCategory) {
    lines.push(`\n[${category}]`);
    for (const m of items) lines.push(`- ${m.content}`);
  }
  return lines.join("\n");
}

/** Parses a `remember` tool call's arguments into a memory draft. */
export function parseRememberArgs(
  argsJson: string
): { content: string; category?: string } | null {
  try {
    const parsed = JSON.parse(argsJson);
    if (typeof parsed.content !== "string" || !parsed.content.trim()) {
      return null;
    }
    return {
      content: parsed.content.trim(),
      category:
        typeof parsed.category === "string" ? parsed.category.trim() : undefined,
    };
  } catch {
    return null;
  }
}
