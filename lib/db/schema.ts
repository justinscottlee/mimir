import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ============================================================================
 * Better Auth core tables
 *
 * These four tables (user, session, account, verification) are the schema
 * Better Auth expects. Column names match the canonical Better Auth Drizzle
 * schema so the drizzle adapter maps its logical fields straight onto them.
 * Don't rename columns here without mirroring the change in lib/auth.ts.
 * ==========================================================================*/

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => ({
    userIdx: index("session_user_id_idx").on(t.userId),
  })
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("account_user_id_idx").on(t.userId),
  })
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index("verification_identifier_idx").on(t.identifier),
  })
);

/* ============================================================================
 * Mimir application tables
 *
 * The data shapes mirror lib/types.ts; flexible sub-structures
 * (message meta, tool events, endpoint lists, tool settings, UI mlayout)
 * are stored as jsonb so the existing TypeScript types stay the source
 * of truth without a column-per-field explosion.
 * ==========================================================================*/

/** One conversation. Messages live in `messages`, linked by conversationId. */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    model: text("model"),
    webToolsEnabled: boolean("web_tools_enabled"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("conversations_user_id_idx").on(t.userId),
    userUpdatedIdx: index("conversations_user_updated_idx").on(
      t.userId,
      t.updatedAt
    ),
  })
);

/** Chat messages. `seq` preserves order within a conversation. */
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    interrupted: boolean("interrupted"),
    /** MessageMeta — token counts, tok/s, durations. */
    meta: jsonb("meta"),
    /** ToolEventRecord[] — inline tool chips captured during generation. */
    toolEvents: jsonb("tool_events"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    convSeqIdx: uniqueIndex("messages_conversation_seq_idx").on(
      t.conversationId,
      t.seq
    ),
  })
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    model: text("model"),
    /** WorkspaceAgentConfig — max steps/tokens + standing instructions. */
    agent: jsonb("agent"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("workspaces_user_id_idx").on(t.userId),
  })
);

/**
 * One row per node in a workspace's virtual filesystem. The full set is
 * replaced wholesale on each workspace upsert (same "replace the set" pattern
 * as conversation messages), so a synthetic id and the (workspace, path)
 * uniqueness are all that's needed.
 */
export const workspaceFiles = pgTable(
  "workspace_files",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    /** "file" | "dir" */
    type: text("type").notNull(),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    wsIdx: index("workspace_files_workspace_id_idx").on(t.workspaceId),
    wsPathIdx: uniqueIndex("workspace_files_ws_path_idx").on(
      t.workspaceId,
      t.path
    ),
  })
);

/**
 * One row per agent run. `steps` holds the run transcript (AgentStep[]) as
 * jsonb so the flexible per-step shape (content, tool events, stats) tracks
 * lib/types.ts directly. `seq` preserves run order within a workspace.
 */
export const workspaceRuns = pgTable(
  "workspace_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    goal: text("goal").notNull(),
    /** AgentRunStatus */
    status: text("status").notNull(),
    model: text("model"),
    summary: text("summary"),
    error: text("error"),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** AgentStep[] */
    steps: jsonb("steps").notNull().default([]),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "date" }),
  },
  (t) => ({
    wsIdx: index("workspace_runs_workspace_id_idx").on(t.workspaceId),
    wsSeqIdx: uniqueIndex("workspace_runs_ws_seq_idx").on(t.workspaceId, t.seq),
  })
);

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    category: text("category"),
    /** "user" | "auto" */
    source: text("source").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("memories_user_id_idx").on(t.userId),
  })
);

export const skills = pgTable(
  "skills",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    /** string[] of script paths referenced by the skill. */
    scripts: jsonb("scripts").notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("skills_user_id_idx").on(t.userId),
  })
);

export const systemPrompts = pgTable(
  "system_prompts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    presetKey: text("preset_key"),
    body: text("body").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    /** "preset" | "user" */
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("system_prompts_user_id_idx").on(t.userId),
  })
);

/**
 * One settings row per user. The flexible parts (endpoints, disabled model
 * keys, tool config) are jsonb so they track lib/types.ts directly.
 */
export const settings = pgTable("settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Endpoint[] */
  endpoints: jsonb("endpoints").notNull().default([]),
  /** string[] of disabled model keys (endpointId::modelId). */
  disabledModels: jsonb("disabled_models").notNull().default([]),
  defaultConversationModel: text("default_conversation_model"),
  defaultWorkspaceModel: text("default_workspace_model"),
  username: text("username").notNull().default("admin"),
  /** ToolSettings */
  tools: jsonb("tools").notNull(),
  /** ContextManagementSettings (tool pruning + summarization). */
  contextManagement: jsonb("context_management"),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Per-user UI layout: open tabs, the active tab, floating windows and their
 * positions/sizes, and the z-stack counter. Persisting this keeps the
 * workbench exactly as the user left it across devices and refreshes.
 */
export const uiState = pgTable("ui_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Tab[] */
  tabs: jsonb("tabs").notNull().default([]),
  activeTabId: text("active_tab_id"),
  /** FloatingWindow[] */
  windows: jsonb("windows").notNull().default([]),
  zTop: integer("z_top").notNull().default(10),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
