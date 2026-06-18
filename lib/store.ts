"use client";

import { create } from "zustand";
import {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  Conversation,
  Endpoint,
  FloatingWindow,
  Memory,
  Message,
  PlanItem,
  Settings,
  Skill,
  SystemPrompt,
  Tab,
  TabKind,
  ToolEventRecord,
  ToolSettings,
  TurnOutcome,
  UserStateSnapshot,
  WindowKind,
  Workspace,
  WorkspaceAgentConfig,
  WorkspaceFile,
} from "./types";
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_TOOL_SETTINGS,
  MAX_WORKSPACE_RUNS,
  WINDOW_SPECS,
  defaultSettings,
  seedSystemPrompts,
  uid,
} from "./defaults";
import * as sync from "./sync";

// Re-exported so existing imports (`import { uid, useMimir, WINDOW_SPECS }
// from "@/lib/store"`) keep working unchanged.
export {
  uid,
  WINDOW_SPECS,
  DEFAULT_TOOL_SETTINGS,
  DEFAULT_AGENT_CONFIG,
  seedSystemPrompts,
};

/** A shallow-per-section patch shape for updateToolSettings. */
export interface PartialToolSettings {
  webSearch?: Partial<ToolSettings["webSearch"]>;
  webFetch?: Partial<ToolSettings["webFetch"]>;
  builtins?: Partial<ToolSettings["builtins"]>;
}

/** Lifecycle of the server-backed store. */
export type StoreStatus = "idle" | "loading" | "ready" | "error";

interface MimirState {
  /** Hydration lifecycle: idle (signed out) → loading → ready. */
  status: StoreStatus;

  tabs: Tab[];
  activeTabId: string | null;
  windows: FloatingWindow[];
  zTop: number;
  conversations: Record<string, Conversation>;
  /**
   * Which conversations currently have an in-flight generation, keyed by id.
   * Kept in the store (not component state) so it survives ChatView remounting
   * when you switch tabs — a generation started in one tab stays visible and
   * guarded against double-sends when you come back.
   */
  streamingConvs: Record<string, boolean>;
  workspaces: Record<string, Workspace>;
  memories: Record<string, Memory>;
  skills: Record<string, Skill>;
  systemPrompts: Record<string, SystemPrompt>;
  settings: Settings;
  searchOpen: boolean;

  // Lifecycle
  loadState: () => Promise<void>;
  hydrate: (snapshot: UserStateSnapshot) => void;
  reset: () => void;

  // Tabs
  openTab: (kind: TabKind, refId: string, title: string) => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  moveTabBefore: (dragTabId: string, targetTabId: string) => void;
  renameTabRef: (tabId: string, title: string) => void;

  // Windows
  openWindow: (kind: WindowKind) => void;
  closeWindow: (windowId: string) => void;
  closeWindowByKind: (kind: WindowKind) => void;
  focusWindow: (windowId: string) => void;
  moveWindow: (windowId: string, x: number, y: number) => void;
  resizeWindow: (windowId: string, w: number, h: number) => void;

  // Conversations
  newConversation: () => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  deleteConversations: (ids: string[]) => void;
  appendMessage: (conversationId: string, message: Message) => void;
  /** Mark a conversation as actively generating (or not). */
  setConvStreaming: (conversationId: string, streaming: boolean) => void;
  patchMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<Message>
  ) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  truncateAfterMessage: (conversationId: string, messageId: string) => void;
  setConversationModel: (conversationId: string, model: string) => void;
  setConversationTitle: (conversationId: string, title: string) => void;

  // Workspaces
  newWorkspace: () => void;
  openWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => void;
  setWorkspaceName: (id: string, name: string) => void;
  setWorkspaceModel: (id: string, model: string) => void;
  /** Replace the workspace's virtual filesystem (used by the fs tool + editor). */
  setWorkspaceFiles: (id: string, files: WorkspaceFile[]) => void;
  /** Patch the agent config (max steps/tokens, standing instructions). */
  setWorkspaceAgentConfig: (
    id: string,
    patch: Partial<WorkspaceAgentConfig>
  ) => void;
  // Workspace agent runs
  startWorkspaceRun: (id: string, run: AgentRun) => void;
  updateWorkspaceRun: (
    id: string,
    runId: string,
    patch: Partial<Omit<AgentRun, "id" | "steps">>
  ) => void;
  appendRunStep: (id: string, runId: string, step: AgentStep) => void;
  patchRunStep: (
    id: string,
    runId: string,
    stepIndex: number,
    patch: Partial<Omit<AgentStep, "index">>
  ) => void;
  appendRunToolEvent: (
    id: string,
    runId: string,
    stepIndex: number,
    event: ToolEventRecord
  ) => void;
  deleteWorkspaceRun: (id: string, runId: string) => void;
  clearWorkspaceRuns: (id: string) => void;
  /**
   * Append a new prompt to a run's history (used when re-prompting an existing
   * agent). Returns the new turn index (0-based), or -1 if the run is missing.
   */
  appendRunPrompt: (id: string, runId: string, prompt: string) => number;
  /** Replace a run's checklist plan (driven by the plan tools and user edits). */
  setRunPlan: (id: string, runId: string, plan: PlanItem[]) => void;
  /** Record how a turn ended, so its summary stays pinned inline to that turn. */
  recordTurnOutcome: (
    id: string,
    runId: string,
    outcome: TurnOutcome
  ) => void;

  // Memories
  addMemory: (
    content: string,
    opts?: { category?: string; source?: "user" | "auto" }
  ) => string;
  updateMemory: (id: string, patch: Partial<Omit<Memory, "id">>) => void;
  deleteMemory: (id: string) => void;
  toggleMemory: (id: string) => void;

  // Skills
  addSkill: (skill: {
    name: string;
    description: string;
    body: string;
    scripts?: string[];
  }) => string;
  updateSkill: (id: string, patch: Partial<Omit<Skill, "id">>) => void;
  deleteSkill: (id: string) => void;
  toggleSkill: (id: string) => void;

  // System prompts
  addSystemPrompt: (prompt: {
    name: string;
    description?: string;
    body: string;
  }) => string;
  updateSystemPrompt: (
    id: string,
    patch: Partial<Omit<SystemPrompt, "id" | "source" | "presetKey">>
  ) => void;
  deleteSystemPrompt: (id: string) => void;
  toggleSystemPrompt: (id: string) => void;

  // Settings / UI
  setSettings: (patch: Partial<Settings>) => void;
  addEndpoint: (
    name: string,
    url: string,
    apiKey?: string,
    manualModels?: string[]
  ) => string;
  updateEndpoint: (id: string, patch: Partial<Omit<Endpoint, "id">>) => void;
  removeEndpoint: (id: string) => void;
  setModelDisabled: (modelKey: string, disabled: boolean) => void;
  updateToolSettings: (patch: PartialToolSettings) => void;
  setConversationWebTools: (conversationId: string, enabled: boolean) => void;
  setSearchOpen: (open: boolean) => void;
}

/** Empty initial state used before hydration and after sign-out. */
function emptyState() {
  return {
    status: "idle" as StoreStatus,
    tabs: [] as Tab[],
    activeTabId: null as string | null,
    windows: [] as FloatingWindow[],
    zTop: 10,
    conversations: {} as Record<string, Conversation>,
    streamingConvs: {} as Record<string, boolean>,
    workspaces: {} as Record<string, Workspace>,
    memories: {} as Record<string, Memory>,
    skills: {} as Record<string, Skill>,
    systemPrompts: {} as Record<string, SystemPrompt>,
    settings: defaultSettings(),
    searchOpen: false,
  };
}

export const useMimir = create<MimirState>()((set, get) => ({
  ...emptyState(),

  // ---------- Lifecycle ----------

  loadState: async () => {
    set({ status: "loading" });
    try {
      const { fetchState } = await import("./api");
      const snapshot = await fetchState();
      if (!snapshot) {
        // Not signed in.
        set({ status: "idle" });
        return;
      }
      get().hydrate(snapshot);
    } catch {
      set({ status: "error" });
    }
  },

  /** Replaces local state with a server snapshot without echoing saves back. */
  hydrate: (snapshot) => {
    suspendSync(() => {
      set({
        conversations: snapshot.conversations,
        workspaces: snapshot.workspaces,
        memories: snapshot.memories,
        skills: snapshot.skills,
        systemPrompts: snapshot.systemPrompts,
        settings: snapshot.settings,
        tabs: snapshot.ui.tabs,
        activeTabId: snapshot.ui.activeTabId,
        windows: snapshot.ui.windows,
        zTop: snapshot.ui.zTop,
        status: "ready",
      });
    });
  },

  /** Clears everything on sign-out. */
  reset: () => {
    suspendSync(() => set({ ...emptyState() }));
  },

  // ---------- Tabs ----------

  openTab: (kind, refId, title) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.kind === kind && t.refId === refId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: Tab = { id: uid("tab_"), kind, title, refId };
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    const next = tabs.filter((t) => t.id !== tabId);
    let nextActive = activeTabId;
    if (activeTabId === tabId) {
      nextActive = next[Math.max(0, idx - 1)]?.id ?? null;
    }
    set({ tabs: next, activeTabId: nextActive });
  },

  closeOtherTabs: (tabId) => {
    const { tabs } = get();
    if (!tabs.some((t) => t.id === tabId)) return;
    set({ tabs: tabs.filter((t) => t.id === tabId), activeTabId: tabId });
  },

  closeTabsToRight: (tabId) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const next = tabs.slice(0, idx + 1);
    const nextActive = next.some((t) => t.id === activeTabId)
      ? activeTabId
      : tabId;
    set({ tabs: next, activeTabId: nextActive });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  moveTabBefore: (dragTabId, targetTabId) => {
    if (dragTabId === targetTabId) return;
    set((s) => {
      const tabs = [...s.tabs];
      const from = tabs.findIndex((t) => t.id === dragTabId);
      const to = tabs.findIndex((t) => t.id === targetTabId);
      if (from === -1 || to === -1) return s;
      const [dragged] = tabs.splice(from, 1);
      tabs.splice(to, 0, dragged);
      return { tabs };
    });
  },

  /** Renames a tab and the conversation/workspace it points at. */
  renameTabRef: (tabId, title) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const clean = title.trim();
    if (!clean) return;
    if (tab.kind === "chat") {
      get().setConversationTitle(tab.refId, clean);
    } else {
      get().setWorkspaceName(tab.refId, clean);
    }
  },

  // ---------- Windows ----------

  openWindow: (kind) => {
    const { windows, zTop } = get();
    const existing = windows.find((w) => w.kind === kind);
    if (existing) {
      get().focusWindow(existing.id);
      return;
    }
    const spec = WINDOW_SPECS[kind];
    const n = windows.length % 7;
    const win: FloatingWindow = {
      id: uid("win_"),
      kind,
      x: 248 + n * 30,
      y: 72 + n * 28,
      w: spec.defaultW,
      h: spec.defaultH,
      z: zTop + 1,
    };
    set({ windows: [...windows, win], zTop: zTop + 1 });
  },

  resizeWindow: (windowId, w, h) =>
    set((s) => ({
      windows: s.windows.map((win) => {
        if (win.id !== windowId) return win;
        const spec = WINDOW_SPECS[win.kind];
        return {
          ...win,
          w: Math.min(spec.maxW, Math.max(spec.minW, w)),
          h: Math.min(spec.maxH, Math.max(spec.minH, h)),
        };
      }),
    })),

  closeWindow: (windowId) =>
    set((s) => ({ windows: s.windows.filter((w) => w.id !== windowId) })),

  closeWindowByKind: (kind) =>
    set((s) => ({ windows: s.windows.filter((w) => w.kind !== kind) })),

  focusWindow: (windowId) =>
    set((s) => {
      const win = s.windows.find((w) => w.id === windowId);
      if (!win || win.z === s.zTop) return s;
      return {
        zTop: s.zTop + 1,
        windows: s.windows.map((w) =>
          w.id === windowId ? { ...w, z: s.zTop + 1 } : w
        ),
      };
    }),

  moveWindow: (windowId, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === windowId ? { ...w, x, y } : w
      ),
    })),

  // ---------- Conversations ----------

  newConversation: () => {
    const id = uid("conv_");
    const now = Date.now();
    const conversation: Conversation = {
      id,
      title: "New conversation",
      model: get().settings.defaultConversationModel,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      conversations: { ...s.conversations, [id]: conversation },
    }));
    get().openTab("chat", id, conversation.title);
  },

  openConversation: (id) => {
    const conv = get().conversations[id];
    if (!conv) return;
    get().openTab("chat", id, conv.title);
  },

  deleteConversation: (id) => {
    set((s) => {
      const conversations = { ...s.conversations };
      delete conversations[id];
      const tabs = s.tabs.filter(
        (t) => !(t.kind === "chat" && t.refId === id)
      );
      const activeTabId = tabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : tabs[tabs.length - 1]?.id ?? null;
      return { conversations, tabs, activeTabId };
    });
    void sync.deleteConversation(id);
  },

  deleteConversations: (ids) => {
    const idSet = new Set(ids);
    set((s) => {
      const conversations = { ...s.conversations };
      for (const id of ids) delete conversations[id];
      const tabs = s.tabs.filter(
        (t) => !(t.kind === "chat" && idSet.has(t.refId))
      );
      const activeTabId = tabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : tabs[tabs.length - 1]?.id ?? null;
      return { conversations, tabs, activeTabId };
    });
    void sync.deleteConversationsBatch(ids);
  },

  appendMessage: (conversationId, message) =>
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...conv,
            messages: [...conv.messages, message],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setConvStreaming: (conversationId, streaming) =>
    set((s) => {
      if (!!s.streamingConvs[conversationId] === streaming) return s;
      const next = { ...s.streamingConvs };
      if (streaming) next[conversationId] = true;
      else delete next[conversationId];
      return { streamingConvs: next };
    }),

  patchMessage: (conversationId, messageId, patch) =>
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === messageId ? { ...m, ...patch } : m
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  deleteMessage: (conversationId, messageId) =>
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...conv,
            messages: conv.messages.filter((m) => m.id !== messageId),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  truncateAfterMessage: (conversationId, messageId) =>
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv) return s;
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return s;
      return {
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...conv,
            messages: conv.messages.slice(0, idx + 1),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setConversationModel: (conversationId, model) =>
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [conversationId]: { ...conv, model },
        },
      };
    }),

  setConversationTitle: (conversationId, title) =>
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [conversationId]: { ...conv, title },
        },
        tabs: s.tabs.map((t) =>
          t.kind === "chat" && t.refId === conversationId
            ? { ...t, title }
            : t
        ),
      };
    }),

  // ---------- Workspaces ----------

  newWorkspace: () => {
    const id = uid("ws_");
    const workspace: Workspace = {
      id,
      name: "New workspace",
      model: get().settings.defaultWorkspaceModel,
      createdAt: Date.now(),
      files: [],
      runs: [],
      agent: { ...DEFAULT_AGENT_CONFIG },
    };
    set((s) => ({ workspaces: { ...s.workspaces, [id]: workspace } }));
    get().openTab("workspace", id, workspace.name);
  },

  openWorkspace: (id) => {
    const ws = get().workspaces[id];
    if (!ws) return;
    get().openTab("workspace", id, ws.name);
  },

  deleteWorkspace: (id) => {
    set((s) => {
      const workspaces = { ...s.workspaces };
      delete workspaces[id];
      const tabs = s.tabs.filter(
        (t) => !(t.kind === "workspace" && t.refId === id)
      );
      const activeTabId = tabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : tabs[tabs.length - 1]?.id ?? null;
      return { workspaces, tabs, activeTabId };
    });
    void sync.deleteWorkspace(id);
  },

  setWorkspaceName: (id, name) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: { ...s.workspaces, [id]: { ...ws, name } },
        tabs: s.tabs.map((t) =>
          t.kind === "workspace" && t.refId === id ? { ...t, title: name } : t
        ),
      };
    }),

  setWorkspaceModel: (id, model) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return { workspaces: { ...s.workspaces, [id]: { ...ws, model } } };
    }),

  setWorkspaceFiles: (id, files) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return { workspaces: { ...s.workspaces, [id]: { ...ws, files } } };
    }),

  setWorkspaceAgentConfig: (id, patch) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: { ...ws, agent: { ...ws.agent, ...patch } },
        },
      };
    }),

  // ---------- Workspace agent runs ----------

  startWorkspaceRun: (id, run) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      // Keep only the most recent runs to bound the stored workspace size.
      const runs = [...ws.runs, run].slice(-MAX_WORKSPACE_RUNS);
      return { workspaces: { ...s.workspaces, [id]: { ...ws, runs } } };
    }),

  updateWorkspaceRun: (id, runId, patch) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)),
          },
        },
      };
    }),

  appendRunStep: (id, runId, step) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) =>
              r.id === runId ? { ...r, steps: [...r.steps, step] } : r
            ),
          },
        },
      };
    }),

  patchRunStep: (id, runId, stepIndex, patch) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) =>
              r.id === runId
                ? {
                    ...r,
                    steps: r.steps.map((st) =>
                      st.index === stepIndex ? { ...st, ...patch } : st
                    ),
                  }
                : r
            ),
          },
        },
      };
    }),

  appendRunToolEvent: (id, runId, stepIndex, event) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) =>
              r.id === runId
                ? {
                    ...r,
                    steps: r.steps.map((st) => {
                      if (st.index !== stepIndex) return st;
                      // Upsert by tool index: a tool first reports itself as
                      // pending (so a live chip shows), then reports again with
                      // its result, replacing the pending entry in place.
                      const existing = st.toolEvents.findIndex(
                        (e) => e.index === event.index
                      );
                      const toolEvents =
                        existing >= 0
                          ? st.toolEvents.map((e, i) =>
                              i === existing ? event : e
                            )
                          : [...st.toolEvents, event];
                      return { ...st, toolEvents };
                    }),
                  }
                : r
            ),
          },
        },
      };
    }),

  deleteWorkspaceRun: (id, runId) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: { ...ws, runs: ws.runs.filter((r) => r.id !== runId) },
        },
      };
    }),

  appendRunPrompt: (id, runId, prompt) => {
    let turnIndex = -1;
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => {
              if (r.id !== runId) return r;
              const prompts = r.prompts ?? (r.goal ? [r.goal] : []);
              const nextPrompts = [...prompts, prompt];
              turnIndex = nextPrompts.length - 1;
              return { ...r, prompts: nextPrompts };
            }),
          },
        },
      };
    });
    return turnIndex;
  },

  setRunPlan: (id, runId, plan) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => (r.id === runId ? { ...r, plan } : r)),
          },
        },
      };
    }),

  recordTurnOutcome: (id, runId, outcome) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return {
        workspaces: {
          ...s.workspaces,
          [id]: {
            ...ws,
            runs: ws.runs.map((r) => {
              if (r.id !== runId) return r;
              const rest = (r.turns ?? []).filter(
                (t) => t.turn !== outcome.turn
              );
              return {
                ...r,
                turns: [...rest, outcome].sort((a, b) => a.turn - b.turn),
              };
            }),
          },
        },
      };
    }),

  clearWorkspaceRuns: (id) =>
    set((s) => {
      const ws = s.workspaces[id];
      if (!ws) return s;
      return { workspaces: { ...s.workspaces, [id]: { ...ws, runs: [] } } };
    }),

  // ---------- Memories ----------

  addMemory: (content, opts) => {
    const id = uid("mem_");
    const now = Date.now();
    const memory: Memory = {
      id,
      content: content.trim(),
      category: opts?.category?.trim() || undefined,
      source: opts?.source ?? "user",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ memories: { ...s.memories, [id]: memory } }));
    return id;
  },

  updateMemory: (id, patch) =>
    set((s) => {
      const mem = s.memories[id];
      if (!mem) return s;
      return {
        memories: {
          ...s.memories,
          [id]: { ...mem, ...patch, updatedAt: Date.now() },
        },
      };
    }),

  deleteMemory: (id) => {
    set((s) => {
      const memories = { ...s.memories };
      delete memories[id];
      return { memories };
    });
    void sync.deleteMemory(id);
  },

  toggleMemory: (id) =>
    set((s) => {
      const mem = s.memories[id];
      if (!mem) return s;
      return {
        memories: {
          ...s.memories,
          [id]: { ...mem, enabled: !mem.enabled, updatedAt: Date.now() },
        },
      };
    }),

  // ---------- Skills ----------

  addSkill: (skill) => {
    const id = uid("skill_");
    const now = Date.now();
    const record: Skill = {
      id,
      name: skill.name.trim(),
      description: skill.description.trim(),
      body: skill.body,
      scripts: skill.scripts ?? [],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ skills: { ...s.skills, [id]: record } }));
    return id;
  },

  updateSkill: (id, patch) =>
    set((s) => {
      const skill = s.skills[id];
      if (!skill) return s;
      return {
        skills: {
          ...s.skills,
          [id]: { ...skill, ...patch, updatedAt: Date.now() },
        },
      };
    }),

  deleteSkill: (id) => {
    set((s) => {
      const skills = { ...s.skills };
      delete skills[id];
      return { skills };
    });
    void sync.deleteSkill(id);
  },

  toggleSkill: (id) =>
    set((s) => {
      const skill = s.skills[id];
      if (!skill) return s;
      return {
        skills: {
          ...s.skills,
          [id]: { ...skill, enabled: !skill.enabled, updatedAt: Date.now() },
        },
      };
    }),

  // ---------- System prompts ----------

  addSystemPrompt: (prompt) => {
    const id = uid("sysp_");
    const now = Date.now();
    const record: SystemPrompt = {
      id,
      name: prompt.name.trim() || "Untitled prompt",
      description: prompt.description?.trim() || undefined,
      body: prompt.body,
      enabled: true,
      source: "user",
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ systemPrompts: { ...s.systemPrompts, [id]: record } }));
    return id;
  },

  updateSystemPrompt: (id, patch) =>
    set((s) => {
      const prompt = s.systemPrompts[id];
      if (!prompt) return s;
      // Presets are generated; only their enabled flag is mutable.
      const safePatch =
        prompt.source === "preset"
          ? { enabled: patch.enabled ?? prompt.enabled }
          : patch;
      return {
        systemPrompts: {
          ...s.systemPrompts,
          [id]: { ...prompt, ...safePatch, updatedAt: Date.now() },
        },
      };
    }),

  deleteSystemPrompt: (id) => {
    const prompt = get().systemPrompts[id];
    // Presets can't be deleted — disable them instead.
    if (!prompt || prompt.source === "preset") return;
    set((s) => {
      const systemPrompts = { ...s.systemPrompts };
      delete systemPrompts[id];
      return { systemPrompts };
    });
    void sync.deleteSystemPrompt(id);
  },

  toggleSystemPrompt: (id) =>
    set((s) => {
      const prompt = s.systemPrompts[id];
      if (!prompt) return s;
      return {
        systemPrompts: {
          ...s.systemPrompts,
          [id]: { ...prompt, enabled: !prompt.enabled, updatedAt: Date.now() },
        },
      };
    }),

  // ---------- Settings / UI ----------

  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),

  addEndpoint: (name, url, apiKey, manualModels) => {
    const id = uid("ep_");
    set((s) => ({
      settings: {
        ...s.settings,
        endpoints: [
          ...s.settings.endpoints,
          {
            id,
            name: name.trim() || "Endpoint",
            url: url.trim(),
            apiKey: apiKey?.trim() || undefined,
            manualModels: manualModels?.length ? manualModels : undefined,
          },
        ],
      },
    }));
    return id;
  },

  updateEndpoint: (id, patch) =>
    set((s) => ({
      settings: {
        ...s.settings,
        endpoints: s.settings.endpoints.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      },
    })),

  removeEndpoint: (id) =>
    set((s) => ({
      settings: {
        ...s.settings,
        endpoints: s.settings.endpoints.filter((e) => e.id !== id),
        // Drop disabled entries and default selections that referenced it.
        disabledModels: s.settings.disabledModels.filter(
          (k) => !k.startsWith(`${id}::`)
        ),
        defaultConversationModel:
          s.settings.defaultConversationModel?.startsWith(`${id}::`)
            ? undefined
            : s.settings.defaultConversationModel,
        defaultWorkspaceModel: s.settings.defaultWorkspaceModel?.startsWith(
          `${id}::`
        )
          ? undefined
          : s.settings.defaultWorkspaceModel,
      },
    })),

  setModelDisabled: (modelKey, disabled) =>
    set((s) => {
      const cur = new Set(s.settings.disabledModels);
      if (disabled) cur.add(modelKey);
      else cur.delete(modelKey);
      return {
        settings: { ...s.settings, disabledModels: [...cur] },
      };
    }),

  updateToolSettings: (patch) =>
    set((s) => {
      const cur = s.settings.tools;
      return {
        settings: {
          ...s.settings,
          tools: {
            webSearch: { ...cur.webSearch, ...(patch.webSearch ?? {}) },
            webFetch: { ...cur.webFetch, ...(patch.webFetch ?? {}) },
            builtins: { ...cur.builtins, ...(patch.builtins ?? {}) },
          },
        },
      };
    }),

  setConversationWebTools: (conversationId, enabled) =>
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv) return s;
      return {
        conversations: {
          ...s.conversations,
          [conversationId]: { ...conv, webToolsEnabled: enabled },
        },
      };
    }),

  setSearchOpen: (open) => set({ searchOpen: open }),
}));

/* ===========================================================================
 * Persistence bridge
 *
 * Every change to durable data is mirrored to the server.
 * We subscribe to the store and diff the persisted slices by object
 * reference: any conversation/workspace/memory/skill/system-prompt whose
 * reference changed (or is new) gets a debounced upsert; a changed settings or
 * UI slice gets its own debounced save. Deletions are handled inside the delete
 * actions (which also cancel any pending save), so the diff only needs to look
 * at added/changed entries.
 *
 * `suspendSync` turns the bridge off around hydration/reset so loading a server
 * snapshot doesn't immediately echo every row back as a "change".
 * ==========================================================================*/

let syncActive = false;

type PersistedSlices = Pick<
  MimirState,
  | "conversations"
  | "workspaces"
  | "memories"
  | "skills"
  | "systemPrompts"
  | "settings"
  | "tabs"
  | "activeTabId"
  | "windows"
  | "zTop"
>;

function snapshotSlices(s: MimirState): PersistedSlices {
  return {
    conversations: s.conversations,
    workspaces: s.workspaces,
    memories: s.memories,
    skills: s.skills,
    systemPrompts: s.systemPrompts,
    settings: s.settings,
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    windows: s.windows,
    zTop: s.zTop,
  };
}

let prevSlices: PersistedSlices = snapshotSlices(useMimir.getState());

/** Runs a state update with the persistence bridge muted, then re-syncs prev. */
function suspendSync(run: () => void) {
  syncActive = false;
  run();
  prevSlices = snapshotSlices(useMimir.getState());
  syncActive = true;
}

function diffMap<T>(
  prev: Record<string, T>,
  next: Record<string, T>,
  push: (v: T) => void
) {
  for (const id in next) {
    if (prev[id] !== next[id]) push(next[id]);
  }
}

useMimir.subscribe((state) => {
  if (!syncActive) return;
  const prev = prevSlices;

  diffMap(prev.conversations, state.conversations, sync.syncConversation);
  diffMap(prev.workspaces, state.workspaces, sync.syncWorkspace);
  diffMap(prev.memories, state.memories, sync.syncMemory);
  diffMap(prev.skills, state.skills, sync.syncSkill);
  diffMap(prev.systemPrompts, state.systemPrompts, sync.syncSystemPrompt);

  if (state.settings !== prev.settings) sync.syncSettings(state.settings);

  if (
    state.tabs !== prev.tabs ||
    state.activeTabId !== prev.activeTabId ||
    state.windows !== prev.windows ||
    state.zTop !== prev.zTop
  ) {
    sync.syncUiState({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      windows: state.windows,
      zTop: state.zTop,
    });
  }

  prevSlices = snapshotSlices(state);
});

// Flush any pending debounced saves when the tab is hidden or closing, so a
// quick close right after an edit doesn't lose the last write.
if (typeof window !== "undefined") {
  const flush = () => sync.flushAll();
  window.addEventListener("pagehide", flush);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
