/** Tabs are reserved for things you interact with: chats and workspaces. */
export type TabKind = "chat" | "workspace";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** Conversation id for chat tabs, workspace id for workspace tabs. */
  refId: string;
}

/** Library and manager pages open as floating windows instead of tabs. */
export type WindowKind =
  | "conversations"
  | "workspaces"
  | "memories"
  | "skills"
  | "tools"
  | "systemPrompt"
  | "settings";

export interface FloatingWindow {
  id: string;
  kind: WindowKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/** Size constraints per window kind for resizing. */
export interface WindowSizeSpec {
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
}

export type Role = "system" | "user" | "assistant";

/** Generation stats captured from llama.cpp after a completion. */
export interface MessageMeta {
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  durationMs?: number;
  /** Total time the model spent inside <think> blocks, in ms. */
  thinkingMs?: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  meta?: MessageMeta;
  /** Model key (endpointId::modelId) that produced an assistant message. */
  model?: string;
  /** True if generation was manually stopped before completing. */
  interrupted?: boolean;
  /**
   * Tool calls executed while producing this message, indexed to match the
   * ⟦tool:N⟧ markers embedded in `content`. Lets the chat render tool chips
   * inline and survive reload.
   */
  toolEvents?: ToolEventRecord[];
}

/** Persisted form of a tool event (mirrors ToolEvent in lib/tools.ts). */
export interface ToolEventRecord {
  index: number;
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface Conversation {
  id: string;
  title: string;
  model?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  /**
   * Per-conversation switch for the web tools (web_search / web_fetch),
   * toggled by the button above the chat input. When undefined it inherits
   * "on" as long as the tools are enabled globally in the Tools window. Set
   * explicitly to false to keep a single conversation fully local even while
   * web access is enabled elsewhere.
   */
  webToolsEnabled?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  model?: string;
  createdAt: number;
}

/** A configured llama.cpp server or OpenAI-compatible API endpoint. */
export interface Endpoint {
  id: string;
  /** Friendly label shown in the UI, e.g. "Workstation" or "Groq". */
  name: string;
  /** Base URL, e.g. http://192.168.1.50:8080 or https://api.groq.com/openai/v1 */
  url: string;
  /**
   * Bearer token for hosted APIs (Groq, OpenAI, Anthropic, …). Sent as
   * Authorization: Bearer <key>. Omitted for local llama.cpp servers, which
   * need no auth. Stored locally like all settings.
   */
  apiKey?: string;
  /**
   * Model IDs to use instead of fetching /v1/models. Required for providers
   * like Anthropic that don't expose a model-list endpoint. One model ID per
   * line when edited in the UI.
   */
  manualModels?: string[];
}

/**
 * A fully-qualified model reference: which endpoint, which model id on it.
 * Serialized as `${endpointId}::${modelId}` for use as a stable key/value in
 * selects and the disabled set.
 */
export interface ModelRef {
  endpointId: string;
  modelId: string;
}

export function modelKey(endpointId: string, modelId: string): string {
  return `${endpointId}::${modelId}`;
}

export function parseModelKey(key: string): ModelRef | null {
  const idx = key.indexOf("::");
  if (idx === -1) return null;
  return { endpointId: key.slice(0, idx), modelId: key.slice(idx + 2) };
}

/**
 * Configuration for the web_search tool. Search runs against a self-hosted
 * SearXNG instance: the model emits a query, Mimir forwards it to SearXNG's
 * JSON API, and the ranked results come back. Nothing about your prompt leaves
 * the machine except the search query you can see in the tool chip.
 */
export interface WebSearchConfig {
  /** Master switch — when false the tool is never advertised to the model. */
  enabled: boolean;
  /** Base URL of the SearXNG instance, e.g. http://localhost:8888 */
  searxngUrl: string;
  /** How many results to hand back to the model (1–10). */
  maxResults: number;
  /** SearXNG safe-search level: 0 off, 1 moderate, 2 strict. */
  safeSearch: 0 | 1 | 2;
}

/**
 * Configuration for the web_fetch tool, which downloads a single URL and
 * returns its readable text so the model can read a page in full.
 */
export interface WebFetchConfig {
  /** Master switch — when false the tool is never advertised to the model. */
  enabled: boolean;
  /** Cap on characters of extracted text returned to the model. */
  maxChars: number;
}

/** On/off switches for the always-local built-in tools. */
export interface BuiltinToolToggles {
  remember: boolean;
  loadSkill: boolean;
}

/** All tool configuration, surfaced in the Tools window. */
export interface ToolSettings {
  webSearch: WebSearchConfig;
  webFetch: WebFetchConfig;
  builtins: BuiltinToolToggles;
}

export interface Settings {
  /** Configured llama.cpp servers. */
  endpoints: Endpoint[];
  /** Model keys (endpointId::modelId) that are hidden from pickers. */
  disabledModels: string[];
  /** Default model key for new conversations. */
  defaultConversationModel?: string;
  /** Default model key for new workspaces. */
  defaultWorkspaceModel?: string;
  username: string;
  /** Tool availability and parameters (web search/fetch, built-ins). */
  tools: ToolSettings;
}

/**
 * A durable fact the model can recall across conversations. Memories are
 * surfaced to the model two ways: every "always" memory is injected into the
 * system prompt, and the model can write new ones via a tool call (see
 * lib/memoryTool.ts). Stored locally alongside everything else.
 */
export interface Memory {
  id: string;
  /** The fact itself, phrased as a standalone statement. */
  content: string;
  /** Optional grouping for the manager UI and future scoping. */
  category?: string;
  /**
   * "always" memories are always injected. "auto" memories were created by
   * the model and behave the same for now, but the distinction lets you later
   * add relevance-based retrieval without re-tagging everything.
   */
  source: "user" | "auto";
  /** When false, the memory is kept but not injected. */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A skill is a reusable instruction pack the model can load on demand —
 * modeled on the skills.sh / SKILL.md format. The instruction tier (name,
 * description, body) is fully supported. Scripts are tracked for display but
 * executing them needs a sandboxed backend that isn't built yet.
 */
export interface Skill {
  id: string;
  /** Short identifier the model uses to load the skill, e.g. "pdf-fill". */
  name: string;
  /** One-line summary shown in the discovery menu and the manager. */
  description: string;
  /** Full SKILL.md body — the procedure/instructions returned on load. */
  body: string;
  /**
   * Paths of scripts the skill references (relative to the skill folder).
   * Display-only for now; running them is a future backend capability.
   */
  scripts: string[];
  /** When false, the skill is hidden from the model's discovery menu. */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A reusable chunk of system-prompt text. Active prompts are concatenated and
 * sent ahead of the conversation, alongside the auto-generated memory and
 * skill prompts. Two flavors:
 *
 *  - source "preset": backed by a generator in lib/systemPrompts.ts, keyed by
 *    `presetKey`. The body is produced fresh at send time (e.g. the current
 *    date), so it can be dynamic. Presets can be enabled/disabled but not
 *    edited or deleted.
 *  - source "user": a custom prompt whose `body` is the literal text. Fully
 *    editable and deletable, toggled on/off like a skill.
 */
export interface SystemPrompt {
  id: string;
  /** Short label shown in the manager and the transparency view. */
  name: string;
  /** One-line explanation of what it does. */
  description?: string;
  /** For presets: the generator key in lib/systemPrompts.ts. */
  presetKey?: string;
  /** Literal text for custom prompts; ignored for presets (generated). */
  body: string;
  enabled: boolean;
  source: "preset" | "user";
  createdAt: number;
  updatedAt: number;
}

export interface LlamaModel {
  id: string;
  /** Optional metadata surfaced by some llama.cpp builds via /v1/models. */
  contextLength?: number;
  /** Owner/creator field if reported. */
  ownedBy?: string;
}

/** A model paired with the endpoint it lives on, for pickers. */
export interface ResolvedModel {
  key: string;
  endpointId: string;
  endpointName: string;
  modelId: string;
  contextLength?: number;
  ownedBy?: string;
}

/**
 * The full per-user snapshot the client store hydrates from and the server
 * assembles from Postgres (cached in Valkey). Mirrors the persisted slice of
 * the old localStorage store, minus the code-defined preset generators.
 */
export interface UserUiState {
  tabs: Tab[];
  activeTabId: string | null;
  windows: FloatingWindow[];
  zTop: number;
}

export interface UserStateSnapshot {
  conversations: Record<string, Conversation>;
  workspaces: Record<string, Workspace>;
  memories: Record<string, Memory>;
  skills: Record<string, Skill>;
  systemPrompts: Record<string, SystemPrompt>;
  settings: Settings;
  ui: UserUiState;
}
