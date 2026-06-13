export type TabKind =
  | "chat"
  | "workspace"
  | "conversations"
  | "workspaces"
  | "memories"
  | "skills"
  | "tools"
  | "settings";

/** Tab kinds that should only ever have one instance open. */
export const SINGLETON_TABS: TabKind[] = [
  "conversations",
  "workspaces",
  "memories",
  "skills",
  "tools",
  "settings",
];

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** For chat tabs: conversation id. For workspace tabs: workspace id. */
  refId?: string;
}

export type Role = "system" | "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
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
