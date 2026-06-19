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
  | "library"
  | "memories"
  | "skills"
  | "tools"
  | "systemPrompt"
  | "settings"
  | "usage";

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
  /** True while the tool is still executing (no result yet). */
  pending?: boolean;
  /**
   * Set when this tool's output was distilled by the context manager. Holds the
   * raw vs distilled character counts so the chip can show what was saved.
   */
  pruned?: { before: number; after: number };
  /**
   * Set on a synthetic event representing a recursive-summarization pass. Holds
   * the estimated token counts before/after compaction.
   */
  compaction?: { before: number; after: number };
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
  /**
   * Organization metadata (shared with workspaces, since the Library window
   * lists both together). `folderId` points at a Folder in Settings, or is
   * absent for the top level. `tagIds` references Tags in Settings. `pinned`
   * floats the item to the top of its folder.
   */
  folderId?: string;
  tagIds?: string[];
  pinned?: boolean;
}

/* ============================================================================
 * Workspaces — agentic sandboxes
 *
 * A workspace gives a model a container to operate in as an autonomous agent:
 * a sandboxed virtual filesystem it can read and write through tools, an agent
 * loop that runs plan→act→observe across many turns, and a run log so every
 * action is auditable. The "sandbox" is capability-based — the agent's only
 * actuators are the tools we hand it, and the filesystem tool is scoped to one
 * workspace's tree, so the agent can never reach the host. The data model keeps
 * the filesystem as plain data (WorkspaceFile[]) so the same UI can later sit on
 * top of a container/chroot backend without changing.
 * ==========================================================================*/

/** A node in a workspace's virtual filesystem. */
export interface WorkspaceFile {
  /** Normalized POSIX-style absolute path, e.g. "/src/main.py" or "/notes". */
  path: string;
  /** Whether this node is a regular file or a directory. */
  type: "file" | "dir";
  /**
   * File contents. Always "" for directories. For a `utf8` file (the default
   * and overwhelmingly common case) this is the literal text. For a `base64`
   * file this is the base64-encoded bytes — that's how genuinely binary
   * artifacts (images, PDFs, archives, compiled output, uploaded zips) survive
   * a round trip through the store, the sandbox sync, and zip download.
   */
  content: string;
  /**
   * How `content` is encoded. Absent or "utf8" means plain text; "base64" means
   * `content` holds base64-encoded binary bytes. Kept optional so every
   * existing text node stays valid without a migration.
   */
  encoding?: "utf8" | "base64";
  createdAt: number;
  updatedAt: number;
}

/** Tunable limits for the agent loop, configurable per workspace. */
export interface WorkspaceAgentConfig {
  /** Hard cap on loop iterations (model turns) before the run is stopped. */
  maxSteps: number;
  /** Budget on cumulative output (completion) tokens across a run. */
  maxTokens: number;
  /** Standing instructions prepended to the agent's system prompt. */
  instructions?: string;
  /**
   * The agentic persona/system-prompt preset folded into every run in this
   * workspace (see lib/workspace/agentPrompts.ts). Controls how methodical the
   * agent is — planning and verifying. Defaults to "standard".
   */
  persona?: AgentPersonaKey;
  /**
   * Optional per-workspace override of the sandbox network mode ("none" =
   * isolated, "bridge" = internet for installs). Inherits the server-wide
   * `SANDBOX_NETWORK` when undefined. The toolchain image is always the
   * server-configured default (`SANDBOX_IMAGE`) — not per-workspace.
   */
  sandboxNetwork?: "none" | "bridge";
}

/** Identifies one of the built-in agent personas in agentPrompts.ts. */
export type AgentPersonaKey = "standard" | "planner" | "concise" | "researcher";

/** Why an agent run ended (or that it's still going). */
export type AgentRunStatus =
  | "running"
  | "done" // the model called task_complete
  | "stopped" // the user aborted the run
  | "idle" // the agent finished a turn and is awaiting a new prompt
  | "max_steps" // hit the configured step cap
  | "max_tokens" // hit the configured output-token budget
  | "stalled" // the model stopped using tools without finishing
  | "error"; // an exception ended the run

/** One iteration of the agent loop: a single model completion + its tool runs. */
export interface AgentStep {
  index: number;
  /** Assistant text for this step (may contain <think> blocks). */
  content: string;
  /** Tools executed this step, indexed to ⟦tool:N⟧ markers in `content`. */
  toolEvents: ToolEventRecord[];
  meta?: MessageMeta;
  /** When this step began (ms epoch); used to interleave messages inline. */
  at?: number;
  /**
   * Which conversational turn this step belongs to. Steps from the first prompt
   * are turn 0; re-prompting the same agent starts turn 1, and so on. Lets the
   * transcript group a multi-prompt run by the instruction that drove each part.
   */
  turn?: number;
}

/** State of a single checklist item in an agent's plan. */
export type PlanItemStatus = "pending" | "active" | "done" | "blocked";

/**
 * One step in the agent's visible checklist plan. The agent creates and updates
 * the plan through the planning tools; the user can also edit it, and the agent
 * is told to re-read the plan when it changes. `note` carries an optional short
 * status the agent or user attaches (e.g. why something is blocked).
 */
export interface PlanItem {
  id: string;
  text: string;
  status: PlanItemStatus;
  note?: string;
}

/**
 * A single autonomous agent in a workspace. Despite the legacy name "run", an
 * AgentRun is a *resumable* agent with a turn-by-turn history: the user can
 * re-prompt it after it stops and it continues in the same context rather than
 * starting fresh.
 */
export interface AgentRun {
  id: string;
  /** The first task the user handed the agent (the run's display title). */
  goal: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  /** Model key (endpointId::modelId) the run used. */
  model?: string;
  /** Final summary the model passed to task_complete when it finished cleanly. */
  summary?: string;
  /** Human-readable reason when status is "error" / "stalled". */
  error?: string;
  /** Cumulative output (completion) tokens across all turns. */
  totalTokens: number;
  createdAt: number;
  finishedAt?: number;

  /* ---- resumable-agent / planning extensions ---- */

  /**
   * Every prompt the agent has received in order, including the initial goal.
   * Length − 1 is the index of the latest turn. Re-prompting pushes a new entry
   * and resumes the loop; the loop replays prior turns as the model's history.
   */
  prompts?: string[];
  /** The agent's visible checklist plan, created and updated as it works. */
  plan?: PlanItem[];
  /** Short display label (currently mirrors the goal). */
  title?: string;
  /**
   * One entry per completed turn, recording how that turn ended. This is what
   * lets a finished turn's summary stay pinned inline where it finished, rather
   * than a single run-level summary that gets overwritten by the next turn.
   */
  turns?: TurnOutcome[];
}

/** How a single turn of a resumable agent ended. */
export interface TurnOutcome {
  /** The turn index (matches AgentStep.turn and prompts[] index). */
  turn: number;
  /** The clean summary from task_complete, if the turn finished cleanly. */
  summary?: string;
  /** Human-readable reason when the turn ended in error/stalled. */
  error?: string;
  /** The status this turn settled into. */
  status: AgentRunStatus;
  finishedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  model?: string;
  createdAt: number;
  /** The sandboxed virtual filesystem the agent operates in. */
  files: WorkspaceFile[];
  /** History of agent runs, oldest first. Capped for storage. */
  runs: AgentRun[];
  /** Agent loop limits and standing instructions. */
  agent: WorkspaceAgentConfig;
  /** Organization metadata, shared with conversations (see Conversation). */
  folderId?: string;
  tagIds?: string[];
  pinned?: boolean;
}

/** The outcome of running one command in a workspace's execution sandbox. */
export interface WorkspaceExecResult {
  command: string;
  stdout: string;
  stderr: string;
  /** Process exit code, or null if the command was killed before exiting. */
  exitCode: number | null;
  /** True if the command exceeded the time limit and was killed. */
  timedOut: boolean;
  durationMs: number;
  /** True if stdout/stderr were truncated to fit the output cap. */
  truncated?: boolean;
  /** Files that exceeded the sync caps and were not mirrored to the store. */
  skippedFiles?: string[];
  /** The working directory the sandbox is left in after this command (cwd persists). */
  cwd?: string;
}

/** Whether the execution sandbox is configured and the Docker daemon reachable. */
export interface SandboxStatus {
  /** The sandbox is turned on AND Docker responded to a ping. */
  available: boolean;
  /** Why the sandbox is unavailable, when it is. */
  reason?: string;
  image?: string;
  /** Docker network mode in effect ("none" means no internet for code). */
  network?: string;
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
 * SearXNG instance configured *by the server* (the `SEARXNG_URL` env var), not
 * by the browser — so there's no per-user URL to get wrong and a query can only
 * ever go to the instance the operator chose. The model emits a query, Mimir
 * forwards it server-side to SearXNG's JSON API, and the ranked results come
 * back. Nothing about your prompt leaves the machine except the search query
 * you can see in the tool chip.
 */
export interface WebSearchConfig {
  /** Master switch — when false the tool is never advertised to the model. */
  enabled: boolean;
  /** How many results to hand back to the model (1–10). */
  maxResults: number;
  /** SearXNG safe-search level: 0 off, 1 moderate, 2 strict. */
  safeSearch: 0 | 1 | 2;
  /**
   * Minimum milliseconds between consecutive web searches, enforced globally
   * across all conversations and agents. Spaces out (and serializes) outbound
   * searches so a search engine is less likely to rate-limit or captcha-block
   * you. 0 disables throttling.
   */
  throttleMs: number;
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

/**
 * A user-defined folder for organizing the Library (conversations AND
 * workspaces live in the same window now, so a folder can hold either kind).
 * Folders are flat for now — an item's `folderId` points at one of these, or is
 * absent for the top level. Definitions live in Settings (low-volume metadata),
 * while membership lives on each conversation/workspace via `folderId`.
 */
export interface Folder {
  id: string;
  name: string;
  /** Optional accent color key (see TAG_COLORS) for the folder's icon. */
  color?: TagColor;
  createdAt: number;
  updatedAt: number;
}

/**
 * A color-coded label assignable to conversations and workspaces. Membership is
 * on each item via `tagIds`; the definitions (label + color) live here so a tag
 * can be renamed/recolored in one place.
 */
export interface Tag {
  id: string;
  label: string;
  color: TagColor;
  createdAt: number;
  updatedAt: number;
}

/** The fixed palette tags and folders pick from (keeps the UI coherent). */
export type TagColor =
  | "bronze"
  | "blue"
  | "green"
  | "red"
  | "purple"
  | "amber"
  | "teal"
  | "pink"
  | "slate";

export const TAG_COLORS: TagColor[] = [
  "bronze",
  "blue",
  "green",
  "red",
  "purple",
  "amber",
  "teal",
  "pink",
  "slate",
];

/**
 * Per-model token pricing for the usage/cost view. Keyed by either a fully
 * qualified model key (`endpointId::modelId`) or a bare `modelId` (so one price
 * can cover the same hosted model across endpoints). Prices are per **one
 * million** tokens, the unit hosted providers quote, in US dollars.
 */
export interface ModelPrice {
  /** Cost per 1M input (prompt) tokens. */
  inputPerMTok: number;
  /** Cost per 1M output (completion) tokens. */
  outputPerMTok: number;
}

export interface UsagePricing {
  /** Map of model key (or bare model id) → price. */
  models: Record<string, ModelPrice>;
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
  /** Active context-window management (tool-output pruning + summarization). */
  contextManagement: ContextManagementSettings;
  /** Folder definitions for the Library window (membership lives on items). */
  folders: Folder[];
  /** Color-coded tag definitions (membership lives on items via tagIds). */
  tags: Tag[];
  /** Per-model token pricing for the usage/cost view. */
  pricing: UsagePricing;
}

/**
 * Fixed, internal caps on tool output size, applied so a single tool result
 * can't pour an unbounded amount of text into the model's context. These are
 * not user-tunable — they live as a constant (DEFAULT_TOOL_OUTPUT_LIMITS) and
 * are passed straight to the workspace agent's tools. The sandbox's own
 * server-side stdout cap (SANDBOX_MAX_OUTPUT_KB) is a separate hard limit
 * applied before this.
 */
export interface ToolOutputLimits {
  /** Max characters returned by read_file before truncation. */
  readFileChars: number;
  /** Max characters of a command's combined output kept in the tool result. */
  commandOutputChars: number;
}

/**
 * Settings for keeping long model loops within a bounded context window. Both
 * conversations and workspace agents honor these.
 */
export interface ContextManagementSettings {
  /**
   * Tool-output pruning: route verbose tool results through a transient model
   * instance that distills them to what's relevant before they enter context.
   */
  toolPruning: {
    enabled: boolean;
    /** Only prune outputs longer than this many characters. */
    thresholdChars: number;
    /** Which tools to prune, by name (e.g. web_search, web_fetch, run_command). */
    tools: string[];
  };
  /**
   * Recursive summarization: once the working history exceeds the token
   * threshold, compress the oldest messages into a memory block and keep the
   * most recent ones verbatim.
   */
  summarization: {
    enabled: boolean;
    /** Approximate context-token threshold that triggers a compression pass. */
    thresholdTokens: number;
    /** How many of the most recent messages to always keep uncompressed. */
    keepRecent: number;
  };
}

/**
 * A durable fact the model can recall across conversations. Memories are
 * surfaced to the model two ways: every "always" memory is injected into the
 * system prompt, and the model can write new ones via a tool call (see
 * lib/memory.ts). Persisted per-account in PostgreSQL alongside everything else.
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
