import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  conversations as convT,
  messages as msgT,
  workspaces as wsT,
  memories as memT,
  skills as skillT,
  systemPrompts as spT,
  settings as settingsT,
  uiState as uiT,
} from "@/lib/db/schema";
import {
  Conversation,
  Memory,
  Message,
  MessageMeta,
  Settings,
  Skill,
  SystemPrompt,
  ToolEventRecord,
  ToolSettings,
  Endpoint,
  UserStateSnapshot,
  UserUiState,
  Workspace,
} from "@/lib/types";
import {
  defaultSettings,
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
        username: s.username,
        tools: s.tools,
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
    };
  }

  const workspaces: Record<string, Workspace> = {};
  for (const w of wsRows) {
    workspaces[w.id] = {
      id: w.id,
      name: w.name,
      model: w.model ?? undefined,
      createdAt: ms(w.createdAt),
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
        username: sRow.username,
        tools: sRow.tools as ToolSettings,
      }
    : defaultSettings(username);

  const uiRow = uiRows[0];
  const ui: UserUiState = uiRow
    ? {
        tabs: (uiRow.tabs as UserUiState["tabs"]) ?? [],
        activeTabId: uiRow.activeTabId ?? null,
        windows: (uiRow.windows as UserUiState["windows"]) ?? [],
        zTop: uiRow.zTop ?? 10,
      }
    : { tabs: [], activeTabId: null, windows: [], zTop: 10 };

  return {
    conversations,
    workspaces,
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
  await db
    .insert(wsT)
    .values({
      id: ws.id,
      userId,
      name: ws.name,
      model: ws.model ?? null,
      createdAt: toDate(ws.createdAt),
    })
    .onConflictDoUpdate({
      target: wsT.id,
      set: { name: ws.name, model: ws.model ?? null },
      setWhere: eq(wsT.userId, userId),
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
      username: settings.username,
      tools: settings.tools,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settingsT.userId,
      set: {
        endpoints: settings.endpoints,
        disabledModels: settings.disabledModels,
        defaultConversationModel: settings.defaultConversationModel ?? null,
        defaultWorkspaceModel: settings.defaultWorkspaceModel ?? null,
        username: settings.username,
        tools: settings.tools,
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
