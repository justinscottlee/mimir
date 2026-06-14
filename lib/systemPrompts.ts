import { Memory, Skill, SystemPrompt, ToolSettings } from "./types";
import { buildMemoryPrompt } from "./memory";
import { buildSkillsPrompt } from "./skills";

/**
 * System prompt assembly lives here so the chat (what gets sent) and the
 * System Prompt window (what gets shown) share one source of truth.
 *
 * The final system message is the concatenation, in order, of:
 *   1. enabled system prompts — presets first, then custom
 *   2. the memory prompt (enabled memories, injected as background knowledge)
 *   3. the skills prompt (enabled skills, injected as a discovery menu)
 *
 * Presets can be *dynamic*: their text is generated at send time, which is how
 * the "current date" prompt always reflects today rather than a frozen string.
 */

export interface SystemPromptPreset {
  key: string;
  name: string;
  description: string;
  /** True when the generated text changes over time (shown with a tag). */
  dynamic?: boolean;
  generate: () => string;
}

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The built-in presets. Each is seeded into the store as a toggleable record;
 * the body is produced by `generate()` at use time so dynamic ones stay fresh.
 */
export const SYSTEM_PROMPT_PRESETS: SystemPromptPreset[] = [
  {
    key: "current_date",
    name: "Current date & knowledge cutoff",
    description:
      "Tells the model today's real date and reminds it that its training has a cutoff in the past — so it stops assuming its training-time 'now' is the present.",
    dynamic: true,
    generate: () => {
      const today = formatToday();
      return (
        `Today's date is ${today}. Your training data has a knowledge cutoff at some point in the past, so your built-in sense of the "current" date, the latest versions of things, recent events, and who currently holds various roles is out of date. ` +
        `Treat ${today} as the present. When a question depends on anything that may have changed since your training cutoff — current events, prices, releases, the newest version of a product or library, or the current holder of a position — do not answer from memory as if your training-time snapshot were still current. ` +
        `If web search is available, use it to check; otherwise, answer with what you know but make clear that your information may be outdated and could have changed by ${today}.`
      );
    },
  },
  {
    key: "concise",
    name: "Concise responses",
    description:
      "Asks for direct, proportional answers — lead with the answer, keep explanation short, skip filler.",
    generate: () =>
      "Prefer concise, direct responses. Lead with the answer, keep any explanation proportional to the question, and avoid filler, throat-clearing, and repetition. Expand only when the user asks for more depth.",
  },
  {
    key: "markdown",
    name: "Markdown formatting",
    description:
      "Encourages clean Markdown — headings, lists, tables, and fenced code blocks with language tags.",
    generate: () =>
      "Format your responses in Markdown where it improves readability: use headings, bullet and numbered lists, tables for comparisons, and fenced code blocks with a language tag for code. Do not over-format simple answers.",
  },
  {
    key: "direct",
    name: "Direct & honest",
    description:
      "Reduces flattery and hedging; the model disagrees when warranted and admits uncertainty instead of guessing.",
    generate: () =>
      "Be direct and honest. Skip flattery and unnecessary hedging. If the user is mistaken, say so and explain why. When you are uncertain, say that plainly rather than presenting a guess as fact, and distinguish what you know from what you are inferring.",
  },
  {
    key: "cite_sources",
    name: "Cite web sources",
    description:
      "Pairs with web search: when the model uses results, it cites the title and URL so you can verify them.",
    generate: () =>
      "When you use web search or fetch a page, cite the sources you relied on with their title and URL so the user can verify them. Clearly separate what you found in those sources from what you inferred or already knew.",
  },
];

export function findPreset(key: string): SystemPromptPreset | undefined {
  return SYSTEM_PROMPT_PRESETS.find((p) => p.key === key);
}

/** Produces the body for a system prompt record (generator for presets). */
export function renderSystemPrompt(prompt: SystemPrompt): string {
  if (prompt.source === "preset" && prompt.presetKey) {
    const preset = findPreset(prompt.presetKey);
    return preset ? preset.generate().trim() : "";
  }
  return prompt.body.trim();
}

/** One labeled piece of the final system prompt, for the transparency view. */
export interface SystemPromptSegment {
  /** Source label, e.g. "Current date & knowledge cutoff", "Memories". */
  label: string;
  /** Where it came from — drives grouping/badges in the UI. */
  origin: "preset" | "custom" | "memories" | "skills";
  text: string;
}

/**
 * Builds the ordered, labeled segments that make up the system prompt. Pass the
 * full collections from the store; only enabled items contribute. Used both to
 * assemble the string sent to the model and to render the preview.
 */
export function buildSystemSegments(args: {
  systemPrompts: SystemPrompt[];
  memories: Memory[];
  skills: Skill[];
}): SystemPromptSegment[] {
  const segments: SystemPromptSegment[] = [];

  const enabled = args.systemPrompts.filter((p) => p.enabled);
  // Presets first (in catalog order), then custom (in creation order).
  const presetOrder = new Map(SYSTEM_PROMPT_PRESETS.map((p, i) => [p.key, i]));
  const presets = enabled
    .filter((p) => p.source === "preset")
    .sort(
      (a, b) =>
        (presetOrder.get(a.presetKey ?? "") ?? 999) -
        (presetOrder.get(b.presetKey ?? "") ?? 999)
    );
  const custom = enabled
    .filter((p) => p.source === "user")
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const p of presets) {
    const text = renderSystemPrompt(p);
    if (text) segments.push({ label: p.name, origin: "preset", text });
  }
  for (const p of custom) {
    const text = renderSystemPrompt(p);
    if (text) segments.push({ label: p.name, origin: "custom", text });
  }

  const memoryPrompt = buildMemoryPrompt(args.memories);
  if (memoryPrompt) {
    segments.push({ label: "Memories", origin: "memories", text: memoryPrompt });
  }
  const skillsPrompt = buildSkillsPrompt(args.skills);
  if (skillsPrompt) {
    segments.push({ label: "Skills", origin: "skills", text: skillsPrompt });
  }

  return segments;
}

/** Joins segments into the final system string sent to the model. */
export function joinSegments(segments: SystemPromptSegment[]): string | undefined {
  return segments.map((s) => s.text).join("\n\n") || undefined;
}

/**
 * Names of the tools that would be advertised to the model given the current
 * tool settings and this conversation's web toggle. Not part of the system
 * *text* (they're sent as function schemas), but shown in the transparency
 * view so the full picture of what's sent is visible.
 */
export function advertisedToolNames(
  tools: ToolSettings,
  webEnabledForConversation: boolean
): string[] {
  const names: string[] = [];
  if (tools.builtins.remember) names.push("remember");
  if (tools.builtins.loadSkill) names.push("load_skill");
  if (tools.webSearch.enabled && webEnabledForConversation) names.push("web_search");
  if (tools.webFetch.enabled && webEnabledForConversation) names.push("web_fetch");
  return names;
}
