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
  /** Server context window size (n_ctx) at the time of generation. */
  contextSize?: number;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  meta?: MessageMeta;
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

export interface LlamaModel {
  id: string;
}
