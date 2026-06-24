import { StateCreator } from "zustand";
import type { MimirState } from "../store";
import { uid } from "../defaults";
import { bumpUsage, computeUsageLedger } from "../usage";
import {
  Conversation,
  Folder,
  ImageStudio,
  ModelPrice,
  TabKind,
  Tag,
  TagColor,
  Workspace,
} from "../types";

/**
 * Library organization (folders + color tags) and usage pricing.
 *
 * These are self-contained: folder/tag definitions and the per-model price
 * table all live inside `settings` (so they ride the existing settings-save
 * path with no new API routes), and item membership (folderId/tagIds/pinned)
 * lives on the conversation/workspace objects. Nothing here touches the
 * streaming, run, or persistence-bridge machinery, which is why it lifts out of
 * the main store cleanly as the first extracted slice.
 *
 * Item-membership edits intentionally do not bump a conversation's updatedAt —
 * filing or tagging shouldn't reorder a "recently updated" list.
 */
export interface OrganizationSlice {
  // Folder + tag definitions (live in settings).
  addFolder: (name: string, color?: TagColor) => string;
  updateFolder: (id: string, patch: Partial<Pick<Folder, "name" | "color">>) => void;
  deleteFolder: (id: string) => void;
  addTag: (label: string, color: TagColor) => string;
  updateTag: (id: string, patch: Partial<Pick<Tag, "label" | "color">>) => void;
  deleteTag: (id: string) => void;
  /** Move a conversation ("chat") or workspace into a folder (null = top level). */
  setItemFolder: (kind: TabKind, id: string, folderId: string | null) => void;
  /** Toggle a tag on a conversation/workspace. */
  toggleItemTag: (kind: TabKind, id: string, tagId: string) => void;
  /** Pin/unpin a conversation/workspace within the Library. */
  setItemPinned: (kind: TabKind, id: string, pinned: boolean) => void;

  // Usage / cost pricing (lives in settings.pricing).
  setModelPrice: (key: string, price: ModelPrice) => void;
  removeModelPrice: (key: string) => void;

  // Usage / cost ledger (persistent per-model token totals, lives in
  // settings.pricing.ledger).
  /**
   * Fold one finished response's tokens into a model's running total. Called
   * once per finalized assistant message / agent step. Persists independently of
   * the conversation that produced it, so deleting a chat doesn't erase its
   * usage.
   */
  recordUsage: (key: string, inputTokens: number, outputTokens: number) => void;
  /** Clear a single model's usage history (the per-row reset in the Usage view). */
  resetModelUsage: (key: string) => void;
  /** Clear every model's usage history. */
  resetAllUsage: () => void;
  /**
   * One-time migration: if the ledger has never been initialized (settings
   * predate it), backfill it from existing conversations and runs so historical
   * usage isn't lost. A no-op once the ledger is defined.
   */
  seedUsageLedgerIfNeeded: () => void;
}

export const createOrganizationSlice: StateCreator<
  MimirState,
  [],
  [],
  OrganizationSlice
> = (set) => ({
  // ---------- Folders + tags ----------

  addFolder: (name, color) => {
    const id = uid("fld_");
    const now = Date.now();
    const folder: Folder = {
      id,
      name: name.trim() || "Untitled folder",
      color,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      settings: { ...s.settings, folders: [...s.settings.folders, folder] },
    }));
    return id;
  },

  updateFolder: (id, patch) =>
    set((s) => ({
      settings: {
        ...s.settings,
        folders: s.settings.folders.map((f) =>
          f.id === id
            ? {
                ...f,
                ...(patch.name !== undefined
                  ? { name: patch.name.trim() || f.name }
                  : {}),
                ...(patch.color !== undefined ? { color: patch.color } : {}),
                updatedAt: Date.now(),
              }
            : f
        ),
      },
    })),

  deleteFolder: (id) =>
    set((s) => {
      // Drop the folder and orphan its members back to the top level.
      const conversations: Record<string, Conversation> = {};
      for (const [cid, c] of Object.entries(s.conversations)) {
        conversations[cid] =
          c.folderId === id ? { ...c, folderId: undefined } : c;
      }
      const workspaces: Record<string, Workspace> = {};
      for (const [wid, w] of Object.entries(s.workspaces)) {
        workspaces[wid] = w.folderId === id ? { ...w, folderId: undefined } : w;
      }
      const imageStudios: Record<string, ImageStudio> = {};
      for (const [sid, st] of Object.entries(s.imageStudios)) {
        imageStudios[sid] =
          st.folderId === id ? { ...st, folderId: undefined } : st;
      }
      return {
        settings: {
          ...s.settings,
          folders: s.settings.folders.filter((f) => f.id !== id),
        },
        conversations,
        workspaces,
        imageStudios,
      };
    }),

  addTag: (label, color) => {
    const id = uid("tag_");
    const now = Date.now();
    const tag: Tag = {
      id,
      label: label.trim() || "tag",
      color,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      settings: { ...s.settings, tags: [...s.settings.tags, tag] },
    }));
    return id;
  },

  updateTag: (id, patch) =>
    set((s) => ({
      settings: {
        ...s.settings,
        tags: s.settings.tags.map((t) =>
          t.id === id
            ? {
                ...t,
                ...(patch.label !== undefined
                  ? { label: patch.label.trim() || t.label }
                  : {}),
                ...(patch.color !== undefined ? { color: patch.color } : {}),
                updatedAt: Date.now(),
              }
            : t
        ),
      },
    })),

  deleteTag: (id) =>
    set((s) => {
      // Remove the tag and strip it from every item that referenced it.
      const strip = (ids?: string[]) =>
        ids && ids.includes(id) ? ids.filter((t) => t !== id) : ids;
      const conversations: Record<string, Conversation> = {};
      for (const [cid, c] of Object.entries(s.conversations)) {
        const next = strip(c.tagIds);
        conversations[cid] = next === c.tagIds ? c : { ...c, tagIds: next };
      }
      const workspaces: Record<string, Workspace> = {};
      for (const [wid, w] of Object.entries(s.workspaces)) {
        const next = strip(w.tagIds);
        workspaces[wid] = next === w.tagIds ? w : { ...w, tagIds: next };
      }
      const imageStudios: Record<string, ImageStudio> = {};
      for (const [sid, st] of Object.entries(s.imageStudios)) {
        const next = strip(st.tagIds);
        imageStudios[sid] = next === st.tagIds ? st : { ...st, tagIds: next };
      }
      return {
        settings: {
          ...s.settings,
          tags: s.settings.tags.filter((t) => t.id !== id),
        },
        conversations,
        workspaces,
        imageStudios,
      };
    }),

  setItemFolder: (kind, id, folderId) =>
    set((s) => {
      const fid = folderId ?? undefined;
      if (kind === "chat") {
        const c = s.conversations[id];
        if (!c) return s;
        return {
          conversations: { ...s.conversations, [id]: { ...c, folderId: fid } },
        };
      }
      if (kind === "image") {
        const st = s.imageStudios[id];
        if (!st) return s;
        return {
          imageStudios: { ...s.imageStudios, [id]: { ...st, folderId: fid } },
        };
      }
      const w = s.workspaces[id];
      if (!w) return s;
      return { workspaces: { ...s.workspaces, [id]: { ...w, folderId: fid } } };
    }),

  toggleItemTag: (kind, id, tagId) =>
    set((s) => {
      const flip = (ids?: string[]) => {
        const set_ = new Set(ids ?? []);
        if (set_.has(tagId)) set_.delete(tagId);
        else set_.add(tagId);
        return [...set_];
      };
      if (kind === "chat") {
        const c = s.conversations[id];
        if (!c) return s;
        return {
          conversations: {
            ...s.conversations,
            [id]: { ...c, tagIds: flip(c.tagIds) },
          },
        };
      }
      if (kind === "image") {
        const st = s.imageStudios[id];
        if (!st) return s;
        return {
          imageStudios: {
            ...s.imageStudios,
            [id]: { ...st, tagIds: flip(st.tagIds) },
          },
        };
      }
      const w = s.workspaces[id];
      if (!w) return s;
      return {
        workspaces: { ...s.workspaces, [id]: { ...w, tagIds: flip(w.tagIds) } },
      };
    }),

  setItemPinned: (kind, id, pinned) =>
    set((s) => {
      if (kind === "chat") {
        const c = s.conversations[id];
        if (!c) return s;
        return {
          conversations: { ...s.conversations, [id]: { ...c, pinned } },
        };
      }
      if (kind === "image") {
        const st = s.imageStudios[id];
        if (!st) return s;
        return {
          imageStudios: { ...s.imageStudios, [id]: { ...st, pinned } },
        };
      }
      const w = s.workspaces[id];
      if (!w) return s;
      return { workspaces: { ...s.workspaces, [id]: { ...w, pinned } } };
    }),

  // ---------- Usage / cost pricing ----------

  setModelPrice: (key, price) =>
    set((s) => ({
      settings: {
        ...s.settings,
        pricing: {
          ...s.settings.pricing,
          models: { ...s.settings.pricing.models, [key]: price },
        },
      },
    })),

  removeModelPrice: (key) =>
    set((s) => {
      const models = { ...s.settings.pricing.models };
      delete models[key];
      return {
        settings: {
          ...s.settings,
          pricing: { ...s.settings.pricing, models },
        },
      };
    }),

  // ---------- Usage / cost ledger ----------

  recordUsage: (key, inputTokens, outputTokens) =>
    set((s) => {
      // No-op for unattributable or empty events so the table doesn't sprout an
      // "unknown" row from a zero-token blip; real responses always have a key.
      if (!key) return {};
      const pricing = s.settings.pricing ?? { models: {} };
      const ledger = bumpUsage(
        pricing.ledger ?? {},
        key,
        inputTokens,
        outputTokens
      );
      return {
        settings: { ...s.settings, pricing: { ...pricing, ledger } },
      };
    }),

  resetModelUsage: (key) =>
    set((s) => {
      const pricing = s.settings.pricing ?? { models: {} };
      if (!pricing.ledger || !(key in pricing.ledger)) return {};
      const ledger = { ...pricing.ledger };
      delete ledger[key];
      return {
        settings: { ...s.settings, pricing: { ...pricing, ledger } },
      };
    }),

  resetAllUsage: () =>
    set((s) => {
      const pricing = s.settings.pricing ?? { models: {} };
      return {
        settings: { ...s.settings, pricing: { ...pricing, ledger: {} } },
      };
    }),

  seedUsageLedgerIfNeeded: () =>
    set((s) => {
      const pricing = s.settings.pricing ?? { models: {} };
      // Already initialized (even if empty) → nothing to do, and crucially never
      // re-derive, so going-forward increments aren't double-counted.
      if (pricing.ledger !== undefined) return {};
      const ledger = computeUsageLedger(s.conversations, s.workspaces);
      return {
        settings: { ...s.settings, pricing: { ...pricing, ledger } },
      };
    }),
});
