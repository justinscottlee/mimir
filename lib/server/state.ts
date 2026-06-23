import "server-only";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations as convT,
  messages as msgT,
  workspaces as wsT,
  workspaceFiles as wfT,
  workspaceRuns as wrT,
  imageStudios as isT,
  generatedImages as giT,
  memories as memT,
  skills as skillT,
  systemPrompts as spT,
  settings as settingsT,
  uiState as uiT,
} from "@/lib/db/schema";
import {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  Conversation,
  Folder,
  GeneratedImage,
  ImageGenParams,
  ImageStudio,
  Memory,
  Message,
  MessageMeta,
  Settings,
  Skill,
  SystemPrompt,
  Tag,
  ToolEventRecord,
  ToolSettings,
  Endpoint,
  UsagePricing,
  UserStateSnapshot,
  UserUiState,
  Workspace,
  WorkspaceAgentConfig,
  WorkspaceFile,
} from "@/lib/types";
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CONTEXT_MANAGEMENT,
  DEFAULT_IMAGE_PARAMS,
  defaultPricing,
  defaultSettings,
  normalizeWindowKind,
  seedSystemPrompts,
} from "@/lib/defaults";
import {
  cacheGetJSON,
  cacheSetJSON,
  invalidateUserState,
  userStateKey,
} from "@/lib/cache";

/* --------------------------- small conversions --------------------------- */

const ms = (d: Date | null | undefined): number =>
  d ? d.getTime() : Date.now();
const toDate = (n: number | undefined): Date =>
  new Date(typeof n === "number" ? n : Date.now());

/* ------------------------------- seeding -------------------------------- */

/**
 * Ensures a user has their baseline rows: a settings row (with the default
 * endpoint + tool config) and the system-prompt preset records. Idempotent —
 * safe to call on every cache miss. Returns nothing; callers read afterwards.
 */
async function ensureSeeded(userId: string, username: string): Promise<void> {
  const existing = await db
    .select({ userId: settingsT.userId })
    .from(settingsT)
    .where(eq(settingsT.userId, userId))
    .limit(1);

  if (existing.length === 0) {
    const s = defaultSettings(username);
    await db
      .insert(settingsT)
      .values({
        userId,
        endpoints: s.endpoints,
        disabledModels: s.disabledModels,
        defaultConversationModel: s.defaultConversationModel,
        defaultWorkspaceModel: s.defaultWorkspaceModel,
        defaultImageModel: s.defaultImageModel,
        username: s.username,
        tools: s.tools,
        contextManagement: s.contextManagement,
        folders: s.folders,
        tags: s.tags,
        pricing: s.pricing,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .insert(uiT)
      .values({ userId, tabs: [], activeTabId: null, windows: [], zTop: 10 })
      .onConflictDoNothing();
  }

  // Reconcile preset system prompts (insert any missing; preserves user state).
  const seeded = Object.values(seedSystemPrompts());
  await db
    .insert(spT)
    .values(
      seeded.map((p) => ({
        id: p.id,
        userId,
        name: p.name,
        description: p.description ?? null,
        presetKey: p.presetKey ?? null,
        body: p.body,
        enabled: p.enabled,
        source: p.source,
        createdAt: toDate(p.createdAt),
        updatedAt: toDate(p.updatedAt),
      }))
    )
    .onConflictDoNothing();

  // Remove preset rows whose preset was retired from the catalog (e.g. the
  // workspace-only presets), so they don't linger in existing databases. Custom
  // (user-authored) prompts are never touched.
  const seededIds = seeded.map((p) => p.id);
  await db
    .delete(spT)
    .where(
      and(
        eq(spT.userId, userId),
        eq(spT.source, "preset"),
        notInArray(spT.id, seededIds)
      )
    );
}

/* ------------------------------ read path ------------------------------- */

/**
 * Returns the full per-user snapshot. Tries the Valkey cache first; on a miss,
 * seeds (if needed), reads every table, assembles the snapshot, caches it, and
 * returns it.
 */
export async function getUserState(
  userId: string,
  username: string
): Promise<UserStateSnapshot> {
  const cached = await cacheGetJSON<UserStateSnapshot>(userStateKey(userId));
  if (cached) return cached;

  await ensureSeeded(userId, username);
  const snapshot = await readUserState(userId, username);
  await cacheSetJSON(userStateKey(userId), snapshot);
  return snapshot;
}

/** Reads and assembles the snapshot straight from Postgres (no cache). */
async function readUserState(
  userId: string,
  username: string
): Promise<UserStateSnapshot> {
  const [
    convRows,
    msgRows,
    wsRows,
    wfRows,
    wrRows,
    isRows,
    giRows,
    memRows,
    skillRows,
    spRows,
    settingsRows,
    uiRows,
  ] = await Promise.all([
    db.select().from(convT).where(eq(convT.userId, userId)),
    db
      .select()
      .from(msgT)
      .innerJoin(convT, eq(msgT.conversationId, convT.id))
      .where(eq(convT.userId, userId))
      .orderBy(asc(msgT.seq)),
    db.select().from(wsT).where(eq(wsT.userId, userId)),
    db
      .select({ f: wfT })
      .from(wfT)
      .innerJoin(wsT, eq(wfT.workspaceId, wsT.id))
      .where(eq(wsT.userId, userId)),
    db
      .select({ r: wrT })
      .from(wrT)
      .innerJoin(wsT, eq(wrT.workspaceId, wsT.id))
      .where(eq(wsT.userId, userId))
      .orderBy(asc(wrT.seq)),
    db.select().from(isT).where(eq(isT.userId, userId)),
    db
      .select({ g: giT })
      .from(giT)
      .innerJoin(isT, eq(giT.studioId, isT.id))
      .where(eq(isT.userId, userId))
      .orderBy(asc(giT.seq)),
    db.select().from(memT).where(eq(memT.userId, userId)),
    db.select().from(skillT).where(eq(skillT.userId, userId)),
    db.select().from(spT).where(eq(spT.userId, userId)),
    db.select().from(settingsT).where(eq(settingsT.userId, userId)).limit(1),
    db.select().from(uiT).where(eq(uiT.userId, userId)).limit(1),
  ]);

  // Group messages under their conversation, preserving seq order.
  const msgsByConv = new Map<string, Message[]>();
  for (const row of msgRows) {
    const m = row.messages;
    const list = msgsByConv.get(m.conversationId) ?? [];
    list.push({
      id: m.id,
      role: m.role as Message["role"],
      content: m.content,
      createdAt: ms(m.createdAt),
      model: m.model ?? undefined,
      interrupted: m.interrupted ?? undefined,
      meta: (m.meta as MessageMeta | null) ?? undefined,
      toolEvents: (m.toolEvents as ToolEventRecord[] | null) ?? undefined,
      attachments: (m.attachments as Message["attachments"]) ?? undefined,
    });
    msgsByConv.set(m.conversationId, list);
  }

  const conversations: Record<string, Conversation> = {};
  for (const c of convRows) {
    conversations[c.id] = {
      id: c.id,
      title: c.title,
      model: c.model ?? undefined,
      messages: msgsByConv.get(c.id) ?? [],
      createdAt: ms(c.createdAt),
      updatedAt: ms(c.updatedAt),
      webToolsEnabled: c.webToolsEnabled ?? undefined,
      folderId: c.folderId ?? undefined,
      tagIds: (c.tagIds as string[] | null) ?? [],
      pinned: c.pinned ?? false,
    };
  }

  // Group workspace files and runs under their workspace.
  const filesByWs = new Map<string, WorkspaceFile[]>();
  for (const { f } of wfRows) {
    const list = filesByWs.get(f.workspaceId) ?? [];
    list.push({
      path: f.path,
      type: f.type as WorkspaceFile["type"],
      content: f.content,
      encoding: (f.encoding as WorkspaceFile["encoding"]) ?? undefined,
      createdAt: ms(f.createdAt),
      updatedAt: ms(f.updatedAt),
    });
    filesByWs.set(f.workspaceId, list);
  }

  const runsByWs = new Map<string, AgentRun[]>();
  for (const { r } of wrRows) {
    const list = runsByWs.get(r.workspaceId) ?? [];
    // The resumable-agent extensions ride in `meta` jsonb (see schema). Pull
    // them back out so the plan, prompt history, and per-turn outcomes survive
    // a reload rather than resetting to empty.
    const meta = (r.meta as Partial<AgentRun> | null) ?? {};
    list.push({
      id: r.id,
      goal: r.goal,
      status: r.status as AgentRunStatus,
      steps: (r.steps as AgentStep[] | null) ?? [],
      model: r.model ?? undefined,
      summary: r.summary ?? undefined,
      error: r.error ?? undefined,
      totalTokens: r.totalTokens ?? 0,
      createdAt: ms(r.createdAt),
      finishedAt: r.finishedAt ? ms(r.finishedAt) : undefined,
      prompts: meta.prompts,
      plan: meta.plan,
      title: meta.title,
      turns: meta.turns,
    });
    runsByWs.set(r.workspaceId, list);
  }

  const workspaces: Record<string, Workspace> = {};
  for (const w of wsRows) {
    workspaces[w.id] = {
      id: w.id,
      name: w.name,
      model: w.model ?? undefined,
      createdAt: ms(w.createdAt),
      files: filesByWs.get(w.id) ?? [],
      runs: runsByWs.get(w.id) ?? [],
      agent: (w.agent as WorkspaceAgentConfig | null) ?? {
        ...DEFAULT_AGENT_CONFIG,
      },
      folderId: w.folderId ?? undefined,
      tagIds: (w.tagIds as string[] | null) ?? [],
      pinned: w.pinned ?? false,
    };
  }

  // Group generated images under their studio, preserving seq order.
  const imagesByStudio = new Map<string, GeneratedImage[]>();
  for (const { g } of giRows) {
    const meta = (g.meta as Partial<GeneratedImage> | null) ?? {};
    const list = imagesByStudio.get(g.studioId) ?? [];
    list.push({
      id: g.id,
      src: g.src,
      favorite: g.favorite ?? false,
      createdAt: ms(g.createdAt),
      prompt: meta.prompt ?? "",
      negativePrompt: meta.negativePrompt,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      steps: meta.steps,
      cfgScale: meta.cfgScale,
      sampler: meta.sampler,
      seed: meta.seed,
      model: meta.model,
      mimeType: meta.mimeType,
      source: meta.source,
      original: meta.original,
    });
    imagesByStudio.set(g.studioId, list);
  }

  const imageStudios: Record<string, ImageStudio> = {};
  for (const s of isRows) {
    imageStudios[s.id] = {
      id: s.id,
      title: s.title,
      model: s.model ?? undefined,
      params: (s.params as ImageGenParams | null) ?? { ...DEFAULT_IMAGE_PARAMS },
      images: imagesByStudio.get(s.id) ?? [],
      createdAt: ms(s.createdAt),
      updatedAt: ms(s.updatedAt),
      folderId: s.folderId ?? undefined,
      tagIds: (s.tagIds as string[] | null) ?? [],
      pinned: s.pinned ?? false,
    };
  }

  const memories: Record<string, Memory> = {};
  for (const m of memRows) {
    memories[m.id] = {
      id: m.id,
      content: m.content,
      category: m.category ?? undefined,
      source: m.source as Memory["source"],
      enabled: m.enabled,
      createdAt: ms(m.createdAt),
      updatedAt: ms(m.updatedAt),
    };
  }

  const skills: Record<string, Skill> = {};
  for (const s of skillRows) {
    skills[s.id] = {
      id: s.id,
      name: s.name,
      description: s.description,
      body: s.body,
      scripts: (s.scripts as string[]) ?? [],
      enabled: s.enabled,
      createdAt: ms(s.createdAt),
      updatedAt: ms(s.updatedAt),
    };
  }

  const systemPrompts: Record<string, SystemPrompt> = {};
  for (const p of spRows) {
    systemPrompts[p.id] = {
      id: p.id,
      name: p.name,
      description: p.description ?? undefined,
      presetKey: p.presetKey ?? undefined,
      body: p.body,
      enabled: p.enabled,
      source: p.source as SystemPrompt["source"],
      createdAt: ms(p.createdAt),
      updatedAt: ms(p.updatedAt),
    };
  }

  const sRow = settingsRows[0];
  const settings: Settings = sRow
    ? {
        endpoints: (sRow.endpoints as Endpoint[]) ?? [],
        disabledModels: (sRow.disabledModels as string[]) ?? [],
        defaultConversationModel: sRow.defaultConversationModel ?? undefined,
        defaultWorkspaceModel: sRow.defaultWorkspaceModel ?? undefined,
        defaultImageModel: sRow.defaultImageModel ?? undefined,
        username: sRow.username,
        tools: sRow.tools as ToolSettings,
        contextManagement:
          (sRow.contextManagement as Settings["contextManagement"]) ??
          DEFAULT_CONTEXT_MANAGEMENT,
        folders: (sRow.folders as Folder[] | null) ?? [],
        tags: (sRow.tags as Tag[] | null) ?? [],
        pricing: (sRow.pricing as UsagePricing | null) ?? defaultPricing(),
      }
    : defaultSettings(username);

  const uiRow = uiRows[0];
  const rawWindows = (uiRow?.windows as UserUiState["windows"]) ?? [];
  // Migrate legacy window kinds (the separate "conversations"/"workspaces"
  // windows merged into one "library" window) and keep a single window per
  // kind, since the UI assumes one instance of each manager.
  const seenKinds = new Set<string>();
  const windows: UserUiState["windows"] = [];
  for (const w of rawWindows) {
    const kind = normalizeWindowKind(w.kind as string);
    if (!kind || seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    windows.push({ ...w, kind });
  }
  const ui: UserUiState = uiRow
    ? {
        tabs: (uiRow.tabs as UserUiState["tabs"]) ?? [],
        activeTabId: uiRow.activeTabId ?? null,
        windows,
        zTop: uiRow.zTop ?? 10,
      }
    : { tabs: [], activeTabId: null, windows: [], zTop: 10 };

  return {
    conversations,
    workspaces,
    imageStudios,
    memories,
    skills,
    systemPrompts,
    settings,
    ui,
  };
}

/* ------------------------------ write path ------------------------------ */

/**
 * Upserts a whole conversation and replaces its message set in one transaction.
 * Client-generated ids make this a clean "replace the set" operation: messages
 * are deleted and re-inserted with fresh seq values matching array order.
 */
export async function upsertConversation(
  userId: string,
  conv: Conversation
): Promise<void> {
  await db.transaction(async (tx) => {
    // Guard ownership: the conversation row, if it exists, must belong to user.
    await tx
      .insert(convT)
      .values({
        id: conv.id,
        userId,
        title: conv.title,
        model: conv.model ?? null,
        webToolsEnabled:
          conv.webToolsEnabled === undefined ? null : conv.webToolsEnabled,
        folderId: conv.folderId ?? null,
        tagIds: conv.tagIds ?? [],
        pinned: conv.pinned ?? false,
        createdAt: toDate(conv.createdAt),
        updatedAt: toDate(conv.updatedAt),
      })
      .onConflictDoUpdate({
        target: convT.id,
        set: {
          title: conv.title,
          model: conv.model ?? null,
          webToolsEnabled:
            conv.webToolsEnabled === undefined ? null : conv.webToolsEnabled,
          folderId: conv.folderId ?? null,
          tagIds: conv.tagIds ?? [],
          pinned: conv.pinned ?? false,
          updatedAt: toDate(conv.updatedAt),
        },
        // Only update rows owned by this user.
        setWhere: eq(convT.userId, userId),
      });

    await tx.delete(msgT).where(eq(msgT.conversationId, conv.id));

    if (conv.messages.length > 0) {
      await tx.insert(msgT).values(
        conv.messages.map((m, i) => ({
          id: m.id,
          conversationId: conv.id,
          seq: i,
          role: m.role,
          content: m.content,
          model: m.model ?? null,
          interrupted: m.interrupted ?? null,
          meta: m.meta ?? null,
          toolEvents: m.toolEvents ?? null,
          attachments: m.attachments ?? null,
          createdAt: toDate(m.createdAt),
        }))
      );
    }
  });
  await invalidateUserState(userId);
}

export async function deleteConversations(
  userId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  // FK cascade removes messages. Scope delete to the user's own rows.
  await db
    .delete(convT)
    .where(and(eq(convT.userId, userId), inArray(convT.id, ids)));
  await invalidateUserState(userId);
}

export async function upsertWorkspace(
  userId: string,
  ws: Workspace
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(wsT)
      .values({
        id: ws.id,
        userId,
        name: ws.name,
        model: ws.model ?? null,
        agent: ws.agent ?? null,
        folderId: ws.folderId ?? null,
        tagIds: ws.tagIds ?? [],
        pinned: ws.pinned ?? false,
        createdAt: toDate(ws.createdAt),
      })
      .onConflictDoUpdate({
        target: wsT.id,
        set: {
          name: ws.name,
          model: ws.model ?? null,
          agent: ws.agent ?? null,
          folderId: ws.folderId ?? null,
          tagIds: ws.tagIds ?? [],
          pinned: ws.pinned ?? false,
        },
        // Only update rows owned by this user.
        setWhere: eq(wsT.userId, userId),
      });

    // Confirm ownership before touching child rows. If this id already belonged
    // to another user, the guarded upsert above changed nothing and this read
    // sees their id — abort so we never delete/replace someone else's files.
    const owner = await tx
      .select({ userId: wsT.userId })
      .from(wsT)
      .where(eq(wsT.id, ws.id))
      .limit(1);
    if (!owner[0] || owner[0].userId !== userId) {
      throw new Error("Workspace not found or not owned by user.");
    }

    // Replace the filesystem set (client paths are the source of truth).
    await tx.delete(wfT).where(eq(wfT.workspaceId, ws.id));
    if (ws.files.length > 0) {
      await tx.insert(wfT).values(
        ws.files.map((f) => ({
          id: `${ws.id}::${f.path}`,
          workspaceId: ws.id,
          path: f.path,
          type: f.type,
          content: f.content,
          encoding: f.encoding ?? null,
          createdAt: toDate(f.createdAt),
          updatedAt: toDate(f.updatedAt),
        }))
      );
    }

    // Replace the run set, re-seqing to array order.
    await tx.delete(wrT).where(eq(wrT.workspaceId, ws.id));
    if (ws.runs.length > 0) {
      await tx.insert(wrT).values(
        ws.runs.map((r, i) => ({
          id: r.id,
          workspaceId: ws.id,
          seq: i,
          goal: r.goal,
          status: r.status,
          model: r.model ?? null,
          summary: r.summary ?? null,
          error: r.error ?? null,
          totalTokens: r.totalTokens ?? 0,
          steps: r.steps ?? [],
          // Persist the resumable-agent extensions together in jsonb so the
          // plan, prompt history, and turn outcomes round-trip (see schema).
          meta: {
            prompts: r.prompts,
            plan: r.plan,
            title: r.title,
            turns: r.turns,
          },
          createdAt: toDate(r.createdAt),
          finishedAt: r.finishedAt ? toDate(r.finishedAt) : null,
        }))
      );
    }
  });
  await invalidateUserState(userId);
}

export async function deleteWorkspace(
  userId: string,
  id: string
): Promise<void> {
  await db.delete(wsT).where(and(eq(wsT.userId, userId), eq(wsT.id, id)));
  await invalidateUserState(userId);
}

/**
 * Upserts a whole image studio and replaces its image set in one transaction,
 * the same guarded "replace the set" pattern as workspaces. Client-generated
 * ids let images be deleted and re-inserted with fresh seq values matching
 * gallery order; the per-image settings ride in `meta` jsonb.
 */
export async function upsertImageStudio(
  userId: string,
  studio: ImageStudio
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(isT)
      .values({
        id: studio.id,
        userId,
        title: studio.title,
        model: studio.model ?? null,
        params: studio.params ?? null,
        folderId: studio.folderId ?? null,
        tagIds: studio.tagIds ?? [],
        pinned: studio.pinned ?? false,
        createdAt: toDate(studio.createdAt),
        updatedAt: toDate(studio.updatedAt),
      })
      .onConflictDoUpdate({
        target: isT.id,
        set: {
          title: studio.title,
          model: studio.model ?? null,
          params: studio.params ?? null,
          folderId: studio.folderId ?? null,
          tagIds: studio.tagIds ?? [],
          pinned: studio.pinned ?? false,
          updatedAt: toDate(studio.updatedAt),
        },
        // Only update rows owned by this user.
        setWhere: eq(isT.userId, userId),
      });

    // Confirm ownership before touching child rows (mirrors upsertWorkspace):
    // if this id already belonged to someone else, the guarded upsert changed
    // nothing and this read sees their id — abort so we never replace it.
    const owner = await tx
      .select({ userId: isT.userId })
      .from(isT)
      .where(eq(isT.id, studio.id))
      .limit(1);
    if (!owner[0] || owner[0].userId !== userId) {
      throw new Error("Image studio not found or not owned by user.");
    }

    // Replace the gallery, re-seqing to array order.
    await tx.delete(giT).where(eq(giT.studioId, studio.id));
    if (studio.images.length > 0) {
      await tx.insert(giT).values(
        studio.images.map((img, i) => ({
          id: img.id,
          studioId: studio.id,
          seq: i,
          src: img.src,
          favorite: img.favorite ?? false,
          meta: {
            prompt: img.prompt,
            negativePrompt: img.negativePrompt,
            width: img.width,
            height: img.height,
            steps: img.steps,
            cfgScale: img.cfgScale,
            sampler: img.sampler,
            seed: img.seed,
            model: img.model,
            mimeType: img.mimeType,
            source: img.source,
            original: img.original,
          },
          createdAt: toDate(img.createdAt),
        }))
      );
    }
  });
  await invalidateUserState(userId);
}

export async function deleteImageStudios(
  userId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  // FK cascade removes the studio's images. Scope to the user's own rows.
  await db
    .delete(isT)
    .where(and(eq(isT.userId, userId), inArray(isT.id, ids)));
  await invalidateUserState(userId);
}

/** Whether a workspace exists and belongs to the given user. */
export async function userOwnsWorkspace(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: wsT.id })
    .from(wsT)
    .where(and(eq(wsT.id, workspaceId), eq(wsT.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * The per-workspace sandbox override (network mode only), read straight from
 * the stored agent config. Resolved server-side so the exec/pty routes apply it
 * for both the terminal and the agent without trusting the client. The
 * toolchain image is never overridable per-workspace — it is always the
 * server-configured `SANDBOX_IMAGE` (the default Mimir sandbox).
 */
export async function getWorkspaceSandboxOverride(
  userId: string,
  workspaceId: string
): Promise<{ network?: "none" | "bridge" }> {
  const rows = await db
    .select({ agent: wsT.agent })
    .from(wsT)
    .where(and(eq(wsT.id, workspaceId), eq(wsT.userId, userId)))
    .limit(1);
  const agent = rows[0]?.agent as WorkspaceAgentConfig | null | undefined;
  if (!agent) return {};
  const network =
    agent.sandboxNetwork === "bridge" || agent.sandboxNetwork === "none"
      ? agent.sandboxNetwork
      : undefined;
  return { network };
}

export async function upsertMemory(userId: string, mem: Memory): Promise<void> {
  await db
    .insert(memT)
    .values({
      id: mem.id,
      userId,
      content: mem.content,
      category: mem.category ?? null,
      source: mem.source,
      enabled: mem.enabled,
      createdAt: toDate(mem.createdAt),
      updatedAt: toDate(mem.updatedAt),
    })
    .onConflictDoUpdate({
      target: memT.id,
      set: {
        content: mem.content,
        category: mem.category ?? null,
        source: mem.source,
        enabled: mem.enabled,
        updatedAt: toDate(mem.updatedAt),
      },
      setWhere: eq(memT.userId, userId),
    });
  await invalidateUserState(userId);
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  await db.delete(memT).where(and(eq(memT.userId, userId), eq(memT.id, id)));
  await invalidateUserState(userId);
}

export async function upsertSkill(userId: string, skill: Skill): Promise<void> {
  await db
    .insert(skillT)
    .values({
      id: skill.id,
      userId,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      scripts: skill.scripts ?? [],
      enabled: skill.enabled,
      createdAt: toDate(skill.createdAt),
      updatedAt: toDate(skill.updatedAt),
    })
    .onConflictDoUpdate({
      target: skillT.id,
      set: {
        name: skill.name,
        description: skill.description,
        body: skill.body,
        scripts: skill.scripts ?? [],
        enabled: skill.enabled,
        updatedAt: toDate(skill.updatedAt),
      },
      setWhere: eq(skillT.userId, userId),
    });
  await invalidateUserState(userId);
}

export async function deleteSkill(userId: string, id: string): Promise<void> {
  await db.delete(skillT).where(and(eq(skillT.userId, userId), eq(skillT.id, id)));
  await invalidateUserState(userId);
}

export async function upsertSystemPrompt(
  userId: string,
  p: SystemPrompt
): Promise<void> {
  await db
    .insert(spT)
    .values({
      id: p.id,
      userId,
      name: p.name,
      description: p.description ?? null,
      presetKey: p.presetKey ?? null,
      body: p.body,
      enabled: p.enabled,
      source: p.source,
      createdAt: toDate(p.createdAt),
      updatedAt: toDate(p.updatedAt),
    })
    .onConflictDoUpdate({
      target: spT.id,
      set: {
        name: p.name,
        description: p.description ?? null,
        body: p.body,
        enabled: p.enabled,
        updatedAt: toDate(p.updatedAt),
      },
      setWhere: eq(spT.userId, userId),
    });
  await invalidateUserState(userId);
}

export async function deleteSystemPrompt(
  userId: string,
  id: string
): Promise<void> {
  // Presets are not deletable from the UI; this only removes user prompts.
  await db
    .delete(spT)
    .where(
      and(eq(spT.userId, userId), eq(spT.id, id), eq(spT.source, "user"))
    );
  await invalidateUserState(userId);
}

export async function saveSettings(
  userId: string,
  settings: Settings
): Promise<void> {
  await db
    .insert(settingsT)
    .values({
      userId,
      endpoints: settings.endpoints,
      disabledModels: settings.disabledModels,
      defaultConversationModel: settings.defaultConversationModel ?? null,
      defaultWorkspaceModel: settings.defaultWorkspaceModel ?? null,
      defaultImageModel: settings.defaultImageModel ?? null,
      username: settings.username,
      tools: settings.tools,
      contextManagement: settings.contextManagement,
      folders: settings.folders,
      tags: settings.tags,
      pricing: settings.pricing,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settingsT.userId,
      set: {
        endpoints: settings.endpoints,
        disabledModels: settings.disabledModels,
        defaultConversationModel: settings.defaultConversationModel ?? null,
        defaultWorkspaceModel: settings.defaultWorkspaceModel ?? null,
        defaultImageModel: settings.defaultImageModel ?? null,
        username: settings.username,
        tools: settings.tools,
        contextManagement: settings.contextManagement,
        folders: settings.folders,
        tags: settings.tags,
        pricing: settings.pricing,
        updatedAt: new Date(),
      },
    });
  await invalidateUserState(userId);
}

export async function saveUiState(
  userId: string,
  ui: UserUiState
): Promise<void> {
  await db
    .insert(uiT)
    .values({
      userId,
      tabs: ui.tabs,
      activeTabId: ui.activeTabId ?? null,
      windows: ui.windows,
      zTop: ui.zTop,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: uiT.userId,
      set: {
        tabs: ui.tabs,
        activeTabId: ui.activeTabId ?? null,
        windows: ui.windows,
        zTop: ui.zTop,
        updatedAt: new Date(),
      },
    });
  await invalidateUserState(userId);
}
