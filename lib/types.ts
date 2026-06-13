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

export type Role = "system" | "user" | "assistant";

/** Generation stats captured from llama.cpp after a completion. */
export interface MessageMeta {
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
  durationMs?: number;
  /** Total time the model spent inside <think> blocks, in ms. */
  thinkingMs?: number;
  /** Server context window size (n_ctx) at the time of generation. */
  contextSize?: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  meta?: MessageMeta;
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
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

export interface Settings {
  /** Base URL of a llama.cpp server, e.g. http://192.168.1.50:8080 */
  endpoint: string;
  username: string;
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

export interface LlamaModel {
  id: string;
}
