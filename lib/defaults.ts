import {
  ContextManagementSettings,
  Endpoint,
  ImageGenParams,
  Settings,
  SystemPrompt,
  ToolOutputLimits,
  ToolSettings,
  UsagePricing,
  WindowKind,
  WindowSizeSpec,
  WorkspaceAgentConfig,
} from "./types";
import { SYSTEM_PROMPT_PRESETS } from "./systemPrompts";

/**
 * Pure defaults and seed helpers shared by the client store (initial/optimistic
 * state) and the server (seeding a brand-new user's rows on first load). Kept
 * free of "use client" and of any browser/Node-only imports so both sides can
 * use it.
 */

let counter = 0;
/** Collision-resistant id with an optional prefix. */
export function uid(prefix = ""): string {
  counter = (counter + 1) % 0xffff;
  return (
    prefix +
    Date.now().toString(36) +
    counter.toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * Defaults for tool configuration. Web tools ship disabled — they're the one
 * capability that can send a query off the machine, so enabling them is an
 * explicit, visible choice made in the Tools window. Built-ins stay local and
 * are on by default.
 */
export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  webSearch: {
    enabled: false,
    maxResults: 5,
    safeSearch: 1,
    throttleMs: 0,
  },
  webFetch: {
    enabled: false,
    maxChars: 8000,
  },
  builtins: {
    remember: true,
    loadSkill: true,
  },
};

/**
 * Fixed caps on how much a single tool result can pour into the model's
 * context. These are an internal constant, not user-tunable: they're passed
 * straight to the workspace agent's read_file / run_command tools so a verbose
 * result can't blow up the context window.
 */
export const DEFAULT_TOOL_OUTPUT_LIMITS: ToolOutputLimits = {
  readFileChars: 40000,
  commandOutputChars: 8000,
};

/**
 * Defaults for the workspace agent loop. `maxSteps` caps how many turns the
 * agent can take before we stop it; `maxTokens` is a budget on cumulative
 * output tokens across the run. Both are deliberately modest so a confused
 * model can't burn an endpoint — raise them per workspace for bigger jobs.
 */
export const DEFAULT_AGENT_CONFIG: WorkspaceAgentConfig = {
  maxSteps: 12,
  maxTokens: 8000,
  persona: "standard",
};

/** How many runs to keep per workspace before trimming the oldest. */
export const MAX_WORKSPACE_RUNS = 25;

/**
 * Defaults for a new image studio's composer. A square 1024px is the common
 * baseline; `steps`/`cfgScale` are sane Stable-Diffusion-ish defaults that a
 * strict OpenAI endpoint simply ignores. `seed` is omitted so the first run is
 * random until the user locks one.
 */
export const DEFAULT_IMAGE_PARAMS: ImageGenParams = {
  prompt: "",
  negativePrompt: "",
  width: 1024,
  height: 1024,
  steps: 30,
  cfgScale: 7,
  batchSize: 1,
};

/**
 * Cap on images kept per studio before the oldest are trimmed. Generated
 * images are stored inline (base64) like workspace binary files, so this keeps
 * a single studio's snapshot from growing without bound.
 */
export const MAX_STUDIO_IMAGES = 200;

/** The endpoint every new account starts with. */
export function defaultEndpoints(): Endpoint[] {
  return [{ id: "ep_default", name: "Local", url: "http://localhost:8080" }];
}

/**
 * Defaults for active context management. Tool-output pruning is on by default
 * for the high-volume web/shell tools (it strictly helps once outputs get
 * large); recursive summarization is on with a generous threshold so it only
 * fires on genuinely long sessions. All thresholds are user-tunable.
 */
export const DEFAULT_CONTEXT_MANAGEMENT: ContextManagementSettings = {
  toolPruning: {
    enabled: true,
    thresholdChars: 4000,
    tools: ["web_search", "web_fetch", "run_command"],
  },
  summarization: {
    enabled: true,
    thresholdTokens: 24000,
    keepRecent: 6,
  },
};

/** Default, empty pricing table. Costs are always shown in US dollars. */
export function defaultPricing(): UsagePricing {
  return { models: {} };
}

/** The settings a brand-new user starts with. `username` defaults from email. */
export function defaultSettings(username = "admin"): Settings {
  return {
    endpoints: defaultEndpoints(),
    disabledModels: [],
    username,
    tools: DEFAULT_TOOL_SETTINGS,
    contextManagement: DEFAULT_CONTEXT_MANAGEMENT,
    folders: [],
    tags: [],
    pricing: defaultPricing(),
  };
}

/**
 * Builds the seed set of system-prompt records from the preset catalog. Run on
 * first launch and reconciled later so new presets appear over time.
 * "current_date" starts enabled because it solves the most common failure mode
 * (the model assuming its training-time present is now); the rest are opt-in.
 *
 * Existing records are preserved so a user's enable/disable choices and custom
 * prompts survive reconciliation.
 */
export function seedSystemPrompts(
  existing: Record<string, SystemPrompt> = {}
): Record<string, SystemPrompt> {
  const out: Record<string, SystemPrompt> = { ...existing };
  const now = Date.now();
  SYSTEM_PROMPT_PRESETS.forEach((preset, i) => {
    const id = `sysp_preset_${preset.key}`;
    if (out[id]) {
      // Keep the user's enabled choice; refresh name/description from catalog.
      out[id] = {
        ...out[id],
        name: preset.name,
        description: preset.description,
        presetKey: preset.key,
        source: "preset",
      };
      return;
    }
    out[id] = {
      id,
      name: preset.name,
      description: preset.description,
      presetKey: preset.key,
      body: "",
      enabled: preset.key === "current_date",
      source: "preset",
      createdAt: now + i,
      updatedAt: now + i,
    };
  });
  return out;
}

/** Default + min/max sizes for each window kind, used for resizing. */
export const WINDOW_SPECS: Record<WindowKind, WindowSizeSpec> = {
  library: { defaultW: 760, defaultH: 560, minW: 460, minH: 340, maxW: 1200, maxH: 920 },
  usage: { defaultW: 720, defaultH: 560, minW: 480, minH: 360, maxW: 1100, maxH: 900 },
  memories: { defaultW: 580, defaultH: 540, minW: 420, minH: 360, maxW: 900, maxH: 880 },
  skills: { defaultW: 620, defaultH: 580, minW: 460, minH: 380, maxW: 1000, maxH: 900 },
  tools: { defaultW: 560, defaultH: 460, minW: 420, minH: 320, maxW: 900, maxH: 820 },
  systemPrompt: { defaultW: 640, defaultH: 600, minW: 460, minH: 380, maxW: 1000, maxH: 900 },
  settings: { defaultW: 760, defaultH: 600, minW: 560, minH: 420, maxW: 1100, maxH: 900 },
};

/** Maps a (possibly legacy) window kind string to a current one, for migration. */
export function normalizeWindowKind(kind: string): WindowKind | null {
  if (kind === "conversations" || kind === "workspaces") return "library";
  if (kind in WINDOW_SPECS) return kind as WindowKind;
  return null;
}
