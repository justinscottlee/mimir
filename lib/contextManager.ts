import { ApiMessage, completeText } from "./llama";
import { ToolHandler, ToolRegistry } from "./tools";
import { ContextManagementSettings } from "./types";

/**
 * Active context management — the machinery that keeps a long-running model loop
 * from drowning in its own history. Two independent strategies, both built on
 * the idea of a *transient* model instance: a brief, single-shot call to the
 * same model that does one job and then disappears (the only thing that
 * survived the removal of the multi-agent system).
 *
 *   1. Tool-output pruning. Verbose tool results (a fetched web page, a long
 *      command log) are handed to a transient instance that distills them down
 *      to what's relevant — driven by the tool call itself (the query, the URL,
 *      the command) — before the result ever enters the main context. The big
 *      raw output never accumulates; only the distilled signal does.
 *
 *   2. Recursive summarization. When the working message history grows past a
 *      configurable token threshold, the oldest messages are compressed into a
 *      single "memory" message by a transient instance, and the recent turns are
 *      kept verbatim. The loop stays bounded no matter how many steps it runs.
 *
 * Both chat conversations and workspace agents use this, via a `ContextRuntime`
 * built by `makeContextRuntime`.
 */

/* ------------------------------ token estimate --------------------------- */

/**
 * A cheap, model-agnostic token estimate (~4 chars/token). We can't use a real
 * tokenizer because the model is arbitrary and self-hosted; this is only used
 * to decide *when* to summarize, where a rough number is fine.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function messagesTokens(messages: ApiMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
    // Tool-call argument payloads also occupy context.
    for (const tc of m.tool_calls ?? []) {
      total += estimateTokens(tc.function.arguments) + estimateTokens(tc.function.name);
    }
  }
  return total;
}

/* ------------------------------ summarizer ------------------------------- */

/** A bound transient-instance call: same model, system + user in, text out. */
export type Summarizer = (input: {
  system: string;
  user: string;
}) => Promise<string>;

export function makeSummarizer(cfg: {
  endpoint: string;
  apiKey?: string;
  model: string;
  signal?: AbortSignal;
}): Summarizer {
  return ({ system, user }) =>
    completeText({
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system,
      user,
      signal: cfg.signal,
    });
}

/* --------------------------- tool-output pruning ------------------------- */

const PRUNE_SYSTEM =
  "You are a focused extraction assistant supporting another AI. That AI ran a tool and received a long result; your sole job is to distill that result down to what actually matters for what it was trying to do, so it doesn't have to hold the whole thing in memory.\n" +
  "\n" +
  "Rules:\n" +
  "- Preserve every concrete, load-bearing detail: facts, figures, dates, names, identifiers, error messages, code, and — critically — any URLs, links, and file paths, exactly as written. Losing a URL or an exact value is a failure.\n" +
  "- Drop boilerplate, navigation, repetition, markup, and anything irrelevant to the stated objective.\n" +
  "- Do not add commentary, caveats, or invented information. Only compress what is present.\n" +
  "- Output the distilled notes directly (compact prose or bullets). No preamble.";

/** Builds the steering line describing why a tool was called (the caller's intent). */
function focusFor(toolName: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (toolName) {
    case "web_search":
      return `A web search for: "${s(args.query)}". Keep all result titles and URLs.`;
    case "web_fetch":
      return `Reading the page at ${s(args.url)} to extract its useful content.`;
    case "run_command":
      return `Running the shell command: ${s(args.command)}. Keep errors, key output, and exit status.`;
    case "read_file":
      return `Reading the file ${s(args.path)}.`;
    default:
      return `Running the tool "${toolName}".`;
  }
}

/**
 * Wraps a registry so that, for the configured tools, any result longer than the
 * threshold is summarized by a transient instance before being returned. The
 * returned (distilled) text is what enters context AND what shows in the tool
 * chip — clearly labeled so it's obvious the raw output was condensed.
 */
/** Reported when a tool output is distilled, so the UI can show what was saved. */
export interface PruneInfo {
  name: string;
  /** Raw output length in characters. */
  before: number;
  /** Distilled length in characters. */
  after: number;
}

export function makeRegistryPruner(opts: {
  summarizer: Summarizer;
  config: ContextManagementSettings["toolPruning"];
  /** Extra task context to steer the summary (e.g. the latest user request). */
  taskContext?: () => string | undefined;
  /** Fired when a tool output is actually distilled. */
  onPrune?: (info: PruneInfo) => void;
}): (registry: ToolRegistry) => ToolRegistry {
  const prunable = new Set(opts.config.tools);

  return (registry) => {
    if (!opts.config.enabled) return registry;
    const wrapped: ToolRegistry = {};
    for (const [name, handler] of Object.entries(registry)) {
      if (!prunable.has(name)) {
        wrapped[name] = handler;
        continue;
      }
      wrapped[name] = pruneHandler(name, handler, opts);
    }
    return wrapped;
  };
}

function pruneHandler(
  name: string,
  handler: ToolHandler,
  opts: {
    summarizer: Summarizer;
    config: ContextManagementSettings["toolPruning"];
    taskContext?: () => string | undefined;
    onPrune?: (info: PruneInfo) => void;
  }
): ToolHandler {
  return {
    def: handler.def,
    run: async (args) => {
      const raw = await handler.run(args);
      // Don't prune errors or already-small outputs.
      if (
        raw.length <= opts.config.thresholdChars ||
        raw.startsWith("Error:")
      ) {
        return raw;
      }
      try {
        const task = opts.taskContext?.();
        const focus = focusFor(name, args);
        const user =
          `Objective / why this tool was called:\n${focus}` +
          (task ? `\n\nBroader task in progress:\n${task}` : "") +
          `\n\nRaw tool output to distill:\n"""\n${raw}\n"""\n\nDistilled, relevant notes:`;
        const summary = (await opts.summarizer({ system: PRUNE_SYSTEM, user })).trim();
        if (!summary) return raw;
        opts.onPrune?.({ name, before: raw.length, after: summary.length });
        return (
          `[${name} output distilled to the parts relevant here. ` +
          `Ask again or fetch directly if you need the full output.]\n\n${summary}`
        );
      } catch {
        // If the transient call fails, fall back to the raw output so the agent
        // still gets its result — pruning is best-effort, never load-bearing.
        return raw;
      }
    },
  };
}

/* -------------------------- recursive summarization ---------------------- */

const HISTORY_SYSTEM =
  "You compress the earlier part of an ongoing conversation/agent session into a concise running memory, so the rest of the context can be dropped without losing the thread. Capture what still matters going forward.\n" +
  "\n" +
  "Produce a compact status report covering, as applicable:\n" +
  "- The goal / task and where it currently stands.\n" +
  "- Key decisions, findings, and facts established (keep concrete values, names, URLs, and file paths).\n" +
  "- What has been done so far, and any unresolved errors or open questions.\n" +
  "- Anything the assistant must remember to do next.\n" +
  "\n" +
  "Be faithful and specific; do not invent. Output only the report.";

/** Result of a context-management pass over a message list. */
export interface ManageResult {
  messages: ApiMessage[];
  compressed: boolean;
  /** Estimated tokens before/after, when a compression happened. */
  beforeTokens?: number;
  afterTokens?: number;
}

/** The reserved tool-event name used to surface a summarization pass in the UI. */
export const CONTEXT_COMPACTION_TOOL = "context_compaction";

/**
 * If `messages` exceeds the token threshold, compress the oldest ones into a
 * single memory message and keep the most recent `keepRecent` verbatim. The cut
 * is adjusted so it never strands a `tool` message whose owning assistant
 * tool-call message was summarized away (which would break the API contract).
 *
 * Returns the (possibly) rewritten list; callers swap it in for the next model
 * call. Persisted history (e.g. an agent's steps) is untouched — this only
 * shapes what the model sees on a given call.
 */
export async function manageContextWindow(
  messages: ApiMessage[],
  opts: {
    summarizer: Summarizer;
    config: ContextManagementSettings["summarization"];
  }
): Promise<ManageResult> {
  const { enabled, thresholdTokens, keepRecent } = opts.config;
  if (!enabled || messages.length <= keepRecent + 1) {
    return { messages, compressed: false };
  }
  const beforeTokens = messagesTokens(messages);
  if (beforeTokens <= thresholdTokens) {
    return { messages, compressed: false };
  }

  // Choose a cut point: keep the last `keepRecent`, but move the boundary
  // forward past any leading tool messages so we don't keep a tool result whose
  // assistant tool-call we're about to drop.
  let cut = Math.max(1, messages.length - keepRecent);
  while (cut < messages.length && messages[cut].role === "tool") cut++;
  // If a summary memory message is already at the very front, fold it in too.
  const older = messages.slice(0, cut);
  const recent = messages.slice(cut);
  if (older.length === 0) return { messages, compressed: false };

  const transcript = older
    .map((m) => {
      const who = m.role === "tool" ? `tool(${m.name ?? ""})` : m.role;
      const calls = (m.tool_calls ?? [])
        .map((c) => `→ called ${c.function.name}(${c.function.arguments})`)
        .join("\n");
      return [`${who}: ${m.content}`.trim(), calls].filter(Boolean).join("\n");
    })
    .join("\n\n");

  let summary: string;
  try {
    summary = (
      await opts.summarizer({
        system: HISTORY_SYSTEM,
        user: `Summarize the earlier turns below into a running memory.\n\n"""\n${transcript}\n"""\n\nRunning memory:`,
      })
    ).trim();
  } catch {
    // Summarization failed — leave history as-is rather than risk losing it.
    return { messages, compressed: false };
  }
  if (!summary) return { messages, compressed: false };

  const memory: ApiMessage = {
    role: "user",
    content: `[CONTEXT NOTE — summary of earlier turns in this session, condensed to save context]\n\n${summary}`,
  };
  const compressed = [memory, ...recent];
  return {
    messages: compressed,
    compressed: true,
    beforeTokens,
    afterTokens: messagesTokens(compressed),
  };
}

/* ------------------------------- runtime --------------------------------- */

/**
 * The bundle a loop uses to apply context management. `pruneRegistry` wraps a
 * tool registry; `manageContext` compresses a working message list. Either may
 * be a no-op depending on settings.
 */
export interface ContextRuntime {
  pruneRegistry: (registry: ToolRegistry) => ToolRegistry;
  manageContext: (messages: ApiMessage[]) => Promise<ManageResult>;
  /**
   * Returns and clears info about the most recent tool-output prune. The loop
   * calls this right after a tool runs to tag that tool's chip with what was
   * saved. Tools run sequentially, so the latest prune belongs to the last tool.
   */
  takePruneInfo: () => PruneInfo | undefined;
}

/**
 * Builds a ContextRuntime for the current model + settings. `taskContext`
 * supplies optional steering text for tool-output pruning (typically the latest
 * user message). Returns undefined when both features are disabled, so callers
 * can skip the machinery entirely.
 */
export function makeContextRuntime(args: {
  endpoint: string;
  apiKey?: string;
  model: string;
  settings: ContextManagementSettings;
  taskContext?: () => string | undefined;
  signal?: AbortSignal;
}): ContextRuntime | undefined {
  const { settings } = args;
  if (!settings.toolPruning.enabled && !settings.summarization.enabled) {
    return undefined;
  }
  // The transient summarizer shares the run's signal, so cancelling the run also
  // cancels any in-flight pruning/summarization call.
  const summarizer = makeSummarizer({
    endpoint: args.endpoint,
    apiKey: args.apiKey,
    model: args.model,
    signal: args.signal,
  });
  let lastPrune: PruneInfo | undefined;
  const pruner = makeRegistryPruner({
    summarizer,
    config: settings.toolPruning,
    taskContext: args.taskContext,
    onPrune: (info) => {
      lastPrune = info;
    },
  });
  return {
    pruneRegistry: (registry) => pruner(registry),
    manageContext: (messages) =>
      manageContextWindow(messages, {
        summarizer,
        config: settings.summarization,
      }),
    takePruneInfo: () => {
      const p = lastPrune;
      lastPrune = undefined;
      return p;
    },
  };
}
