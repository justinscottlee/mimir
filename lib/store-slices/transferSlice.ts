import { StateCreator } from "zustand";
import type { MimirState } from "../store";
import { uid } from "../defaults";
import {
  Conversation,
  Endpoint,
  ImageStudio,
  Memory,
  ModelPrice,
  Settings,
  Skill,
  SystemPrompt,
  Workspace,
} from "../types";
import { reidConversation, reidImageStudio, reidWorkspace } from "../transfer";

/**
 * Import / restore actions: taking parsed export data (see lib/transfer.ts) and
 * folding it into the live store. Everything here is additive and
 * non-destructive — imported conversations, workspaces, studios, memories,
 * skills, and prompts arrive as brand-new items with fresh ids, so importing
 * the same file twice duplicates rather than clobbers, and an import can never
 * overwrite something you already have.
 *
 * Adding entries to the store maps triggers the persistence bridge in store.ts
 * automatically (it diffs by reference), so these actions don't call sync
 * directly. Settings are the one merge: endpoints/defaults/pricing are unioned
 * in so a restore brings back your providers without wiping current config.
 */

export interface BackupApplyResult {
  conversations: number;
  workspaces: number;
  imageStudios: number;
  memories: number;
  skills: number;
  systemPrompts: number;
  endpointsAdded: number;
}

export interface TransferSlice {
  importConversations: (convs: Conversation[]) => string[];
  importWorkspaces: (wss: Workspace[]) => string[];
  importImageStudios: (studios: ImageStudio[]) => string[];
  importMemories: (items: Memory[]) => number;
  importSkills: (items: Skill[]) => number;
  importSystemPrompts: (items: SystemPrompt[]) => number;
  /** Apply a parsed full backup additively; returns how much was imported. */
  applyBackup: (b: {
    conversations: Conversation[];
    workspaces: Workspace[];
    imageStudios: ImageStudio[];
    memories: Memory[];
    skills: Skill[];
    systemPrompts: SystemPrompt[];
    settings?: Settings;
  }) => BackupApplyResult;
}

export const createTransferSlice: StateCreator<
  MimirState,
  [],
  [],
  TransferSlice
> = (set, get) => ({
  importConversations: (convs) => {
    const fresh = convs.filter(isConversationLike).map((c) => reidConversation(c, uid));
    if (fresh.length === 0) return [];
    set((s) => {
      const conversations = { ...s.conversations };
      for (const c of fresh) conversations[c.id] = c;
      return { conversations };
    });
    return fresh.map((c) => c.id);
  },

  importWorkspaces: (wss) => {
    const fresh = wss.filter(isWorkspaceLike).map((w) => reidWorkspace(w, uid));
    if (fresh.length === 0) return [];
    set((s) => {
      const workspaces = { ...s.workspaces };
      for (const w of fresh) workspaces[w.id] = w;
      return { workspaces };
    });
    return fresh.map((w) => w.id);
  },

  importImageStudios: (studios) => {
    const fresh = studios
      .filter(isImageStudioLike)
      .map((st) => reidImageStudio(st, uid));
    if (fresh.length === 0) return [];
    set((s) => {
      const imageStudios = { ...s.imageStudios };
      for (const st of fresh) imageStudios[st.id] = st;
      return { imageStudios };
    });
    return fresh.map((st) => st.id);
  },

  importMemories: (items) => {
    const now = Date.now();
    const fresh: Memory[] = [];
    for (const m of items) {
      const content = typeof m?.content === "string" ? m.content.trim() : "";
      if (!content) continue;
      fresh.push({
        id: uid("mem_"),
        content,
        category: typeof m.category === "string" ? m.category : undefined,
        source: m.source === "auto" ? "auto" : "user",
        enabled: m.enabled !== false,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (fresh.length === 0) return 0;
    set((s) => {
      const memories = { ...s.memories };
      for (const m of fresh) memories[m.id] = m;
      return { memories };
    });
    return fresh.length;
  },

  importSkills: (items) => {
    const now = Date.now();
    const fresh: Skill[] = [];
    for (const sk of items) {
      const name = typeof sk?.name === "string" ? sk.name.trim() : "";
      const body = typeof sk?.body === "string" ? sk.body : "";
      if (!name || !body) continue;
      fresh.push({
        id: uid("skill_"),
        name,
        description:
          typeof sk.description === "string" ? sk.description : "Imported skill.",
        body,
        scripts: Array.isArray(sk.scripts)
          ? sk.scripts.filter((x): x is string => typeof x === "string")
          : [],
        enabled: sk.enabled !== false,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (fresh.length === 0) return 0;
    set((s) => {
      const skills = { ...s.skills };
      for (const sk of fresh) skills[sk.id] = sk;
      return { skills };
    });
    return fresh.length;
  },

  importSystemPrompts: (items) => {
    const now = Date.now();
    const fresh: SystemPrompt[] = [];
    for (const p of items) {
      // Presets are generated from code, not portable — skip them on import.
      if (p?.source === "preset" || p?.presetKey) continue;
      const name = typeof p?.name === "string" ? p.name.trim() : "";
      const body = typeof p?.body === "string" ? p.body : "";
      if (!name || !body) continue;
      fresh.push({
        id: uid("sysp_"),
        name,
        description: typeof p.description === "string" ? p.description : undefined,
        body,
        enabled: p.enabled !== false,
        source: "user",
        createdAt: now,
        updatedAt: now,
      });
    }
    if (fresh.length === 0) return 0;
    set((s) => {
      const systemPrompts = { ...s.systemPrompts };
      for (const p of fresh) systemPrompts[p.id] = p;
      return { systemPrompts };
    });
    return fresh.length;
  },

  applyBackup: (b) => {
    const result: BackupApplyResult = {
      conversations: get().importConversations(b.conversations ?? []).length,
      workspaces: get().importWorkspaces(b.workspaces ?? []).length,
      imageStudios: get().importImageStudios(b.imageStudios ?? []).length,
      memories: get().importMemories(b.memories ?? []),
      skills: get().importSkills(b.skills ?? []),
      systemPrompts: get().importSystemPrompts(b.systemPrompts ?? []),
      endpointsAdded: 0,
    };

    // Merge settings non-destructively: bring back providers (endpoints) and
    // pricing/defaults the user would otherwise have to re-enter, without
    // touching their current tool/context preferences or organization.
    if (b.settings) {
      result.endpointsAdded = mergeImportedSettings(set, get, b.settings);
    }

    return result;
  },
});

/** Endpoint/default/pricing merge for a restore. Returns endpoints added. */
function mergeImportedSettings(
  set: Parameters<StateCreator<MimirState, [], [], TransferSlice>>[0],
  get: Parameters<StateCreator<MimirState, [], [], TransferSlice>>[1],
  imported: Settings
): number {
  const cur = get().settings;
  const haveUrls = new Set(cur.endpoints.map((e) => e.url));
  const haveIds = new Set(cur.endpoints.map((e) => e.id));

  const toAdd: Endpoint[] = [];
  for (const ep of imported.endpoints ?? []) {
    if (!ep?.url || haveUrls.has(ep.url)) continue;
    // Re-id on collision so we never overwrite an existing endpoint row.
    const id = haveIds.has(ep.id) ? uid("ep_") : ep.id;
    haveIds.add(id);
    haveUrls.add(ep.url);
    toAdd.push({ ...ep, id });
  }

  const mergedPricing: Record<string, ModelPrice> = {
    ...(imported.pricing?.models ?? {}),
    ...cur.pricing.models, // existing prices win on conflict
  };

  const disabled = new Set([
    ...cur.disabledModels,
    ...(imported.disabledModels ?? []),
  ]);

  set((s) => ({
    settings: {
      ...s.settings,
      endpoints: [...s.settings.endpoints, ...toAdd],
      disabledModels: [...disabled],
      // Fill in defaults only where the user hasn't chosen one.
      defaultConversationModel:
        s.settings.defaultConversationModel ?? imported.defaultConversationModel,
      defaultWorkspaceModel:
        s.settings.defaultWorkspaceModel ?? imported.defaultWorkspaceModel,
      defaultImageModel:
        s.settings.defaultImageModel ?? imported.defaultImageModel,
      pricing: { models: mergedPricing },
    },
  }));

  return toAdd.length;
}

/* --------------------------- shape guards --------------------------- */

function isConversationLike(c: unknown): c is Conversation {
  return (
    typeof c === "object" &&
    c !== null &&
    Array.isArray((c as Conversation).messages)
  );
}

function isWorkspaceLike(w: unknown): w is Workspace {
  return (
    typeof w === "object" &&
    w !== null &&
    Array.isArray((w as Workspace).files)
  );
}

function isImageStudioLike(s: unknown): s is ImageStudio {
  return (
    typeof s === "object" &&
    s !== null &&
    Array.isArray((s as ImageStudio).images)
  );
}
