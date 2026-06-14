import { Memory } from "./types";
import { ToolHandler } from "./tools";

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
 *    writing to storage directly — it only emits an intent, and Mimir owns
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
          "Persist a durable fact about the user, their environment, or their standing preferences so it is available in ALL future conversations. This is long-term memory: write to it proactively the moment you learn something that would change how you respond to this person later — do NOT wait for the user to say 'remember this.'\n" +
          "\n" +
          "CALL THIS when what you learned is:\n" +
          "- Durable — likely still true weeks or months from now (a stable preference, an ongoing project, a tool they rely on, a constraint they work under).\n" +
          "- Personal to this user — about them, their setup, their work, their relationships, or how they want you to behave.\n" +
          "- Reusable — would spare the user from re-explaining it, or would let you give a better answer, in a later unrelated conversation.\n" +
          "\n" +
          "Good things to remember:\n" +
          "- 'The user self-hosts LLMs with llama.cpp on a Mac Studio with 192GB of unified memory.'\n" +
          "- 'The user prefers concise answers with code first, explanation after.'\n" +
          "- 'The user is a pediatric nurse named Sam who works night shifts.'\n" +
          "- 'The user is designing a STM32 system-on-module electronics project called Pollux.'\n" +
          "\n" +
          "DO NOT call this for:\n" +
          "- One-off or task-local details (a value being debugged right now, today's to-do list, a figure from the current chat).\n" +
          "- Facts only relevant inside this single conversation.\n" +
          "- Anything the user asked you not to save, or sensitive data they did not clearly want stored.\n" +
          "- Information already in memory — only write when the fact is new or has changed.\n" +
          "\n" +
          "Decision test: 'If this same user starts a brand-new chat next month, would knowing this make me more helpful?' Yes → save it. No → skip it. When the answer is clearly yes, save without being asked.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
                "EXTRACT the durable fact — do not merely transcribe what the user said. Rewrite into a self-contained statement in the third person, as a standing truth, dropping the user's narration, reasoning, hedging, and any 'now/lately/this conversation' framing. Keep the specifics that make it useful (names, versions, numbers); invent nothing and drop nothing essential. Usually one sentence; two at most.\n" +
                "\n" +
                "Example transformation:\n" +
                "User says: 'yeah lately I've basically given up on Terraform, it's a nightmare, I just do everything through the Serverless framework now and deploy to Lambda'\n" +
                "Save: 'The user deploys to AWS Lambda using the Serverless framework and avoids Terraform.'",
          },
          category: {
            type: "string",
            enum: [
              "preference",
              "fact",
              "project",
              "person",
              "environment",
              "instruction",
            ],
            description:
                "The single best-fitting category for this memory.",
          },
        },
        required: ["content", "category"],
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

/**
 * Builds the `remember` registry entry. The handler is given a `save`
 * callback (wired to the store's addMemory in ChatView) so this module stays
 * free of store imports and the write stays owned by Mimir, not the model.
 */
export function rememberTool(
  save: (content: string, category?: string) => void
): ToolHandler {
  return {
    def: MEMORY_TOOLS[0],
    run: (args) => {
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!content) return "Error: a non-empty 'content' is required.";
      const category =
        typeof args.category === "string" ? args.category.trim() : undefined;
      save(content, category);
      return `Saved memory${category ? ` under "${category}"` : ""}: "${content}"`;
    },
  };
}
