/** Tabs are reserved for things you interact with: chats, workspaces, images. */
export type TabKind = "chat" | "workspace" | "image";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /**
   * Conversation id for chat tabs, workspace id for workspace tabs, image
   * studio id for image tabs.
   */
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
  /**
   * Files the user attached to this message as context. The extracted text is
   * injected ahead of the message's prose on every request that includes this
   * message (direct context injection — see lib/attachments.ts), so the model
   * always sees the file contents while the chat shows compact chips. Only set
   * on user messages.
   */
  attachments?: Attachment[];
}

/**
 * A file attached to a chat message and injected into the model's context as
 * text. Binary formats that aren't text and aren't extractable (images,
 * archives) are rejected at attach time, so an attachment always carries usable
 * `text`. Persisted on the message (jsonb) so the context survives a reload.
 */
export interface Attachment {
  id: string;
  /** Original filename, e.g. "report.pdf" or "main.c". */
  name: string;
  /** Best-effort MIME type reported by the browser, e.g. "application/pdf". */
  mimeType?: string;
  /** Size of the original file in bytes. */
  size: number;
  /**
   * How the file became context:
   *  - "text": decoded directly as UTF-8 (code, markdown, csv, plain text, …)
   *  - "pdf":  text extracted from a PDF server-side (lib/attachments + /api/extract)
   */
  kind: "text" | "pdf";
  /** The extracted text injected into the model's context. */
  text: string;
  /** Page count for PDFs (informational, shown on the chip). */
  pages?: number;
  /** True if `text` was truncated to fit the per-file size cap. */
  truncated?: boolean;
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
 * Image studios — text-to-image generation
 *
 * A studio is the image-generation analogue of a Conversation: a durable,
 * named workspace that remembers its composer settings (prompt + parameters)
 * and accumulates a gallery of results. Generation hits the OpenAI-compatible
 * `/v1/images/generations` endpoint on the selected model's endpoint, proxied
 * through /api/llama/* exactly like chat — see lib/imagegen.ts.
 * ==========================================================================*/

/**
 * The composer parameters for a generation. Sticky between runs (they live on
 * the studio) so re-rolling or tweaking is one edit away. `width`/`height` map
 * to the OpenAI `size` field; the rest are sent as widely-recognized
 * extensions and are honored only if the backend understands them (a local
 * Stable Diffusion / Flux server typically does; a strict OpenAI endpoint
 * ignores the extras). `seed` undefined means "random each time".
 */
export interface ImageGenParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  /** Diffusion steps (extension; ignored by backends that don't support it). */
  steps?: number;
  /** Classifier-free guidance scale (extension). */
  cfgScale?: number;
  /** Sampler / scheduler name (extension), e.g. "euler_a". */
  sampler?: string;
  /** Fixed seed for reproducibility; undefined = random each generation. */
  seed?: number;
  /** How many images to request per generation (OpenAI `n`). */
  batchSize: number;
  /**
   * Reference images as `data:` URIs for FLUX.2 editing / image-guided
   * generation. When present, the prompt edits or composes from these rather
   * than generating from scratch. The model takes several, but each one costs
   * extra VRAM. Sent to the backend as the `image` field.
   */
  referenceImages?: string[];
}

/**
 * One generated image plus the settings that produced it, so a result is
 * self-describing (hover for its prompt/seed, or copy its settings back into
 * the composer to iterate). `src` is render-ready: a `data:` URI when the
 * backend returned base64 (the default we request), or a remote URL when it
 * returned one instead.
 */
/**
 * The pristine, pre-edit version of an image, captured the first time it is
 * resized or upscaled so the original bytes are never lost. Lets the gallery
 * mark an image as edited, show the original on demand, and revert to it.
 */
export interface ImageEditOriginal {
  src: string;
  mimeType?: string;
  width: number;
  height: number;
}

export interface GeneratedImage {
  id: string;
  /** Render-ready image source: a `data:image/...;base64,…` URI or a URL. */
  src: string;
  /** Best-effort MIME type (informational; e.g. "image/png"). */
  mimeType?: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps?: number;
  cfgScale?: number;
  sampler?: string;
  seed?: number;
  /** Model key (endpointId::modelId) that produced this image. */
  model?: string;
  createdAt: number;
  /** Pinned/favorited within the gallery. */
  favorite?: boolean;
  /**
   * How this image entered the studio. `"upload"` images are dropped/picked in
   * by the user (typically to resize); everything else is model-generated.
   * Absent is treated as `"generated"` for back-compat with older rows.
   */
  source?: "generated" | "upload";
  /**
   * Set once the image has been resized or upscaled: the pristine original it
   * was edited from. Absent means the image is still its original self.
   */
  original?: ImageEditOriginal;
}

export interface ImageStudio {
  id: string;
  title: string;
  /** Image model key (endpointId::modelId). */
  model?: string;
  /** Current composer settings (carried between generations). */
  params: ImageGenParams;
  /** Gallery, newest last (mirrors message/run ordering). */
  images: GeneratedImage[];
  createdAt: number;
  updatedAt: number;
  /**
   * Organization metadata, shared with conversations and workspaces so the
   * Library window lists all three together (see Conversation).
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
  /**
   * What this endpoint serves, used to filter the model pickers. "text" shows
   * its models only in chat/workspace, "image" only in the image studio,
   * "both" everywhere. Unset is treated as "both" so existing endpoints keep
   * appearing everywhere until tagged. Lets you keep a chat LLM out of the
   * image picker and a diffusion server out of the chat picker.
   */
  kind?: EndpointKind;
}

/** Which kind of model an endpoint serves; gates where it shows in the UI. */
export type EndpointKind = "text" | "image" | "both";

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
  /**
   * Persistent per-model token ledger for the usage/cost view, keyed the same
   * way as `models`. Unlike a tally derived from the current conversations and
   * runs, this accumulates as responses are produced and SURVIVES deleting the
   * conversation or workspace that produced them — so spend isn't lost when you
   * clean up. Incremented once per finalized assistant message / agent step.
   *
   * Optional for back-compat: settings persisted before this field existed
   * hydrate with it `undefined`, which triggers a one-time backfill from
   * existing data (see the store's `seedUsageLedgerIfNeeded`). A seeded-but-empty
   * ledger is `{}` (defined), so the backfill never runs twice.
   */
  ledger?: Record<string, ModelUsageTotals>;
}

/** Accumulated token usage for one model in the persistent usage ledger. */
export interface ModelUsageTotals {
  /** Summed prompt (input) tokens across every billed response. */
  inputTokens: number;
  /** Summed completion (output) tokens across every billed response. */
  outputTokens: number;
  /** Number of billed responses (assistant messages + agent steps). */
  responses: number;
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
  /** Default model key for new image studios (an image-generation model). */
  defaultImageModel?: string;
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
  imageStudios: Record<string, ImageStudio>;
  memories: Record<string, Memory>;
  skills: Record<string, Skill>;
  systemPrompts: Record<string, SystemPrompt>;
  settings: Settings;
  ui: UserUiState;
}