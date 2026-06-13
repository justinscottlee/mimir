"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Conversation,
  Message,
  Settings,
  SINGLETON_TABS,
  Tab,
  TabKind,
  Workspace,
} from "./types";

export function uid(prefix = ""): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

interface TalosState {
  tabs: Tab[];
  activeTabId: string | null;
  conversations: Record<string, Conversation>;
  workspaces: Record<string, Workspace>;
  settings: Settings;
  searchOpen: boolean;

  // Tabs
  openTab: (kind: TabKind, opts?: { refId?: string; title?: string }) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (refId: string, title: string) => void;

  // Conversations
  newConversation: () => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  appendMessage: (conversationId: string, message: Message) => void;
  updateMessageContent: (
    conversationId: string,
    messageId: string,
    content: string
  ) => void;
  setConversationModel: (conversationId: string, model: string) => void;
  setConversationTitle: (conversationId: string, title: string) => void;

  // Workspaces
  newWorkspace: () => void;
  openWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => void;

  // Settings / UI
  setSettings: (patch: Partial<Settings>) => void;
  setSearchOpen: (open: boolean) => void;
}

export const useTalos = create<TalosState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      conversations: {},
      workspaces: {},
      settings: { endpoint: "http://localhost:8080", username: "operator" },
      searchOpen: false,

      openTab: (kind, opts) => {
        const { tabs } = get();

        // Singleton tabs (and chat/workspace tabs pointing at the same ref)
        // focus the existing tab instead of opening a duplicate.
        const existing = tabs.find((t) =>
          SINGLETON_TABS.includes(kind)
            ? t.kind === kind
            : t.kind === kind && t.refId === opts?.refId
        );
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }

        const tab: Tab = {
          id: uid("tab_"),
          kind,
          title: opts?.title ?? defaultTabTitle(kind),
          refId: opts?.refId,
        };
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

      renameTab: (refId, title) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.refId === refId ? { ...t, title } : t)),
        })),

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
        get().openTab("chat", { refId: id, title: conversation.title });
      },

      openConversation: (id) => {
        const conv = get().conversations[id];
        if (!conv) return;
        get().openTab("chat", { refId: id, title: conv.title });
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

      updateMessageContent: (conversationId, messageId, content) =>
        set((s) => {
          const conv = s.conversations[conversationId];
          if (!conv) return s;
          return {
            conversations: {
              ...s.conversations,
              [conversationId]: {
                ...conv,
                messages: conv.messages.map((m) =>
                  m.id === messageId ? { ...m, content } : m
                ),
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

      setConversationTitle: (conversationId, title) => {
        set((s) => {
          const conv = s.conversations[conversationId];
          if (!conv) return s;
          return {
            conversations: {
              ...s.conversations,
              [conversationId]: { ...conv, title },
            },
          };
        });
        get().renameTab(conversationId, title);
      },

      newWorkspace: () => {
        const id = uid("ws_");
        const workspace: Workspace = {
          id,
          name: "New workspace",
          createdAt: Date.now(),
        };
        set((s) => ({ workspaces: { ...s.workspaces, [id]: workspace } }));
        get().openTab("workspace", { refId: id, title: workspace.name });
      },

      openWorkspace: (id) => {
        const ws = get().workspaces[id];
        if (!ws) return;
        get().openTab("workspace", { refId: id, title: ws.name });
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

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setSearchOpen: (open) => set({ searchOpen: open }),
    }),
    {
      name: "talos-store",
      // Don't persist transient UI state.
      partialize: (s) => ({
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        conversations: s.conversations,
        workspaces: s.workspaces,
        settings: s.settings,
      }),
    }
  )
);

function defaultTabTitle(kind: TabKind): string {
  switch (kind) {
    case "chat":
      return "New conversation";
    case "workspace":
      return "New workspace";
    case "conversations":
      return "Conversations";
    case "workspaces":
      return "Workspaces";
    case "memories":
      return "Memories";
    case "skills":
      return "Skills";
    case "tools":
      return "Tools";
    case "settings":
      return "Settings";
  }
}
