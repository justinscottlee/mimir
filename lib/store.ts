"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Conversation,
  FloatingWindow,
  Memory,
  Message,
  Settings,
  Tab,
  TabKind,
  WindowKind,
  Workspace,
} from "./types";

export function uid(prefix = ""): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

/** Default sizes for each window kind. */
const WINDOW_SIZES: Record<WindowKind, { w: number; h: number }> = {
  conversations: { w: 640, h: 500 },
  workspaces: { w: 640, h: 500 },
  memories: { w: 580, h: 540 },
  skills: { w: 560, h: 440 },
  tools: { w: 560, h: 460 },
  settings: { w: 660, h: 560 },
};

interface TalosState {
  tabs: Tab[];
  activeTabId: string | null;
  windows: FloatingWindow[];
  zTop: number;
  conversations: Record<string, Conversation>;
  workspaces: Record<string, Workspace>;
  memories: Record<string, Memory>;
  settings: Settings;
  searchOpen: boolean;

  // Tabs
  openTab: (kind: TabKind, refId: string, title: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  moveTabBefore: (dragTabId: string, targetTabId: string) => void;
  renameTabRef: (tabId: string, title: string) => void;

  // Windows
  openWindow: (kind: WindowKind) => void;
  closeWindow: (windowId: string) => void;
  closeWindowByKind: (kind: WindowKind) => void;
  focusWindow: (windowId: string) => void;
  moveWindow: (windowId: string, x: number, y: number) => void;

  // Conversations
  newConversation: () => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
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

  // Settings / UI
  setSettings: (patch: Partial<Settings>) => void;
  setSearchOpen: (open: boolean) => void;
}

export const useTalos = create<TalosState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      windows: [],
      zTop: 10,
      conversations: {},
      workspaces: {},
      memories: {},
      settings: { endpoint: "http://localhost:8080", username: "operator" },
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
        const size = WINDOW_SIZES[kind];
        const n = windows.length % 7;
        const win: FloatingWindow = {
          id: uid("win_"),
          kind,
          x: 90 + n * 32,
          y: 64 + n * 28,
          w: size.w,
          h: size.h,
          z: zTop + 1,
        };
        set({ windows: [...windows, win], zTop: zTop + 1 });
      },

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

      // ---------- Settings / UI ----------

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setSearchOpen: (open) => set({ searchOpen: open }),
    }),
    {
      name: "talos-store",
      version: 2,
      migrate: (persisted: unknown, version) => {
        const state = persisted as Partial<TalosState> & {
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
        return state as TalosState;
      },
      partialize: (s) => ({
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        windows: s.windows,
        zTop: s.zTop,
        conversations: s.conversations,
        workspaces: s.workspaces,
        memories: s.memories,
        settings: s.settings,
      }),
    }
  )
);
