"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Conversation,
  Endpoint,
  FloatingWindow,
  Memory,
  Message,
  Settings,
  Skill,
  SystemPrompt,
  Tab,
  TabKind,
  ToolSettings,
  WindowKind,
  WindowSizeSpec,
  Workspace,
} from "./types";
import { SYSTEM_PROMPT_PRESETS } from "./systemPrompts";

export function uid(prefix = ""): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * Defaults for tool configuration. Web tools ship disabled — they're the one
 * capability that can send a query off the machine (to your SearXNG and, from
 * there, the open web), so enabling them is an explicit, visible choice made in
 * the Tools window. Built-ins stay local and are on by default.
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

/**
 * Builds the seed set of system-prompt records from the preset catalog. Run on
 * first launch and reconciled on migration so new presets appear over time.
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

interface MimirState {
  tabs: Tab[];
  activeTabId: string | null;
  windows: FloatingWindow[];
  zTop: number;
  conversations: Record<string, Conversation>;
  workspaces: Record<string, Workspace>;
  memories: Record<string, Memory>;
  skills: Record<string, Skill>;
  systemPrompts: Record<string, SystemPrompt>;
  settings: Settings;
  searchOpen: boolean;

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
  patchMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<Message>
  ) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  /** Drops every message after the given one (used by resend). */
  truncateAfterMessage: (conversationId: string, messageId: string) => void;
  setConversationModel: (conversationId: string, model: string) => void;
  setConversationTitle: (conversationId: string, title: string) => void;

  // Workspaces
  newWorkspace: () => void;
  openWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => void;
  setWorkspaceName: (id: string, name: string) => void;

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
  addEndpoint: (name: string, url: string, apiKey?: string, manualModels?: string[]) => string;
  updateEndpoint: (id: string, patch: Partial<Omit<Endpoint, "id">>) => void;
  removeEndpoint: (id: string) => void;
  setModelDisabled: (modelKey: string, disabled: boolean) => void;
  /** Deep-merges a patch into the tool settings (web search/fetch, built-ins). */
  updateToolSettings: (patch: PartialToolSettings) => void;
  /** Per-conversation on/off for the web tools (the chat input toggle). */
  setConversationWebTools: (conversationId: string, enabled: boolean) => void;
  setSearchOpen: (open: boolean) => void;
}

/** A shallow-per-section patch shape for updateToolSettings. */
export interface PartialToolSettings {
  webSearch?: Partial<ToolSettings["webSearch"]>;
  webFetch?: Partial<ToolSettings["webFetch"]>;
  builtins?: Partial<ToolSettings["builtins"]>;
}

export const useMimir = create<MimirState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      windows: [],
      zTop: 10,
      conversations: {},
      workspaces: {},
      memories: {},
      skills: {},
      systemPrompts: seedSystemPrompts(),
      settings: {
        endpoints: [
          { id: "ep_default", name: "Local", url: "http://localhost:8080" },
        ],
        disabledModels: [],
        username: "admin",
        tools: DEFAULT_TOOL_SETTINGS,
      },
      searchOpen: false,

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

      deleteMemory: (id) =>
        set((s) => {
          const memories = { ...s.memories };
          delete memories[id];
          return { memories };
        }),

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

      deleteSkill: (id) =>
        set((s) => {
          const skills = { ...s.skills };
          delete skills[id];
          return { skills };
        }),

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

      deleteSystemPrompt: (id) =>
        set((s) => {
          const prompt = s.systemPrompts[id];
          // Presets can't be deleted — disable them instead.
          if (!prompt || prompt.source === "preset") return s;
          const systemPrompts = { ...s.systemPrompts };
          delete systemPrompts[id];
          return { systemPrompts };
        }),

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
    }),
    {
      name: "mimir-store",
      version: 5,
      migrate: (persisted: unknown, version) => {
        const state = persisted as Partial<MimirState> & {
          tabs?: { kind: string; refId?: string }[];
        };
        if (version < 2) {
          // v1 allowed manager pages as tabs; those are windows now.
          state.tabs = (state.tabs ?? []).filter(
            (t) =>
              (t.kind === "chat" || t.kind === "workspace") && t.refId
          ) as Tab[];
          state.windows = [];
          state.zTop = 10;
          if (
            state.activeTabId &&
            !state.tabs.some((t) => (t as Tab).id === state.activeTabId)
          ) {
            state.activeTabId =
              (state.tabs[state.tabs.length - 1] as Tab | undefined)?.id ?? null;
          }
        }
        if (version < 3) {
          // v2 had a single `endpoint` string; promote to an endpoints array.
          const old = (state.settings ?? {}) as {
            endpoint?: string;
            endpoints?: Endpoint[];
            disabledModels?: string[];
            username?: string;
          };
          const url = old.endpoint ?? "http://localhost:8080";
          state.settings = {
            endpoints: old.endpoints ?? [
              { id: "ep_default", name: "Local", url },
            ],
            disabledModels: old.disabledModels ?? [],
            username: old.username ?? "admin",
          } as Settings;
        }
        if (version < 4) {
          // v3 had no tool settings; backfill with defaults (web tools off).
          const settings = (state.settings ?? {}) as Partial<Settings>;
          if (!settings.tools) {
            settings.tools = DEFAULT_TOOL_SETTINGS;
          }
          state.settings = settings as Settings;
        }
        if (version < 5) {
          // v4 had no system prompts; seed the preset catalog (current_date on).
          const existing = (state as { systemPrompts?: Record<string, SystemPrompt> })
            .systemPrompts;
          (state as { systemPrompts: Record<string, SystemPrompt> }).systemPrompts =
            seedSystemPrompts(existing ?? {});
        }
        return state as MimirState;
      },
      partialize: (s) => ({
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        windows: s.windows,
        zTop: s.zTop,
        conversations: s.conversations,
        workspaces: s.workspaces,
        memories: s.memories,
        skills: s.skills,
        systemPrompts: s.systemPrompts,
        settings: s.settings,
      }),
    }
  )
);
