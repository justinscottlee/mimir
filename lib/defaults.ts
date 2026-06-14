import {
  Endpoint,
  Settings,
  SystemPrompt,
  ToolSettings,
  WindowKind,
  WindowSizeSpec,
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
    searxngUrl: "http://localhost:8888",
    maxResults: 5,
    safeSearch: 1,
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

/** The endpoint every new account starts with. */
export function defaultEndpoints(): Endpoint[] {
  return [{ id: "ep_default", name: "Local", url: "http://localhost:8080" }];
}

/** The settings a brand-new user starts with. `username` defaults from email. */
export function defaultSettings(username = "admin"): Settings {
  return {
    endpoints: defaultEndpoints(),
    disabledModels: [],
    username,
    tools: DEFAULT_TOOL_SETTINGS,
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
  conversations: { defaultW: 680, defaultH: 540, minW: 420, minH: 320, maxW: 1100, maxH: 900 },
  workspaces: { defaultW: 640, defaultH: 500, minW: 420, minH: 320, maxW: 1000, maxH: 860 },
  memories: { defaultW: 580, defaultH: 540, minW: 420, minH: 360, maxW: 900, maxH: 880 },
  skills: { defaultW: 620, defaultH: 580, minW: 460, minH: 380, maxW: 1000, maxH: 900 },
  tools: { defaultW: 560, defaultH: 460, minW: 420, minH: 320, maxW: 900, maxH: 820 },
  systemPrompt: { defaultW: 640, defaultH: 600, minW: 460, minH: 380, maxW: 1000, maxH: 900 },
  settings: { defaultW: 760, defaultH: 600, minW: 560, minH: 420, maxW: 1100, maxH: 900 },
};
