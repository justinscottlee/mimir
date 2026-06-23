import {
  Conversation,
  GeneratedImage,
  ImageStudio,
  Memory,
  Message,
  Skill,
  SystemPrompt,
  Settings,
  Workspace,
  AgentRun,
} from "./types";
import { parseTranscript } from "./transcript";

/**
 * Export / import of Mimir data: conversations (Markdown + JSON), a full account
 * backup, and bulk collections of memories / skills / system prompts. This
 * module is pure and isomorphic — it only serializes to and parses from strings.
 * The browser glue (triggering a download, opening a file picker) lives in
 * lib/clientFiles.ts, and the store actions that apply an import live in the
 * store; this file is the single source of truth for the on-disk shapes.
 *
 * Design notes:
 *  - JSON is the lossless format. Every export carries a small typed envelope
 *    ({ type, version, exportedAt, … }) so an importer can tell what it's
 *    looking at and refuse mismatched files.
 *  - Markdown is the human-readable conversation format (good for sharing or
 *    archiving). Import of our own Markdown is best-effort; JSON round-trips
 *    exactly.
 *  - Imports never trust ids from the file. The caller re-ids everything (see
 *    reidConversation / reidWorkspace / reidImageStudio) because message, run,
 *    and image ids are global primary keys — reusing them would collide with
 *    existing rows, especially when re-importing the same backup.
 */

export const TRANSFER_VERSION = 1;

export type TransferType =
  | "mimir.conversation"
  | "mimir.backup"
  | "mimir.memories"
  | "mimir.skills"
  | "mimir.systemPrompts";

interface BaseEnvelope {
  type: TransferType;
  version: number;
  exportedAt: number;
  /** Informational; the app name/version that produced the file. */
  app?: string;
}

export interface ConversationEnvelope extends BaseEnvelope {
  type: "mimir.conversation";
  conversation: Conversation;
}

export interface BackupEnvelope extends BaseEnvelope {
  type: "mimir.backup";
  conversations: Conversation[];
  workspaces: Workspace[];
  imageStudios: ImageStudio[];
  memories: Memory[];
  skills: Skill[];
  /** User-authored prompts only — presets are seeded, not backed up. */
  systemPrompts: SystemPrompt[];
  settings: Settings;
}

export interface CollectionEnvelope<T> extends BaseEnvelope {
  items: T[];
}

/* ----------------------------- serialization ---------------------------- */

function envelopeMeta(): Pick<BaseEnvelope, "version" | "exportedAt" | "app"> {
  return { version: TRANSFER_VERSION, exportedAt: Date.now(), app: "Mimir" };
}

export function serializeConversationJSON(conv: Conversation): string {
  const env: ConversationEnvelope = {
    type: "mimir.conversation",
    ...envelopeMeta(),
    conversation: conv,
  };
  return JSON.stringify(env, null, 2);
}

export function serializeBackup(data: {
  conversations: Conversation[];
  workspaces: Workspace[];
  imageStudios: ImageStudio[];
  memories: Memory[];
  skills: Skill[];
  systemPrompts: SystemPrompt[];
  settings: Settings;
}): string {
  const env: BackupEnvelope = {
    type: "mimir.backup",
    ...envelopeMeta(),
    ...data,
    // Only user-authored prompts travel in a backup; presets are re-seeded.
    systemPrompts: data.systemPrompts.filter((p) => p.source === "user"),
  };
  return JSON.stringify(env, null, 2);
}

export function serializeMemories(items: Memory[]): string {
  const env: CollectionEnvelope<Memory> = {
    type: "mimir.memories",
    ...envelopeMeta(),
    items,
  };
  return JSON.stringify(env, null, 2);
}

export function serializeSkills(items: Skill[]): string {
  const env: CollectionEnvelope<Skill> = {
    type: "mimir.skills",
    ...envelopeMeta(),
    items,
  };
  return JSON.stringify(env, null, 2);
}

export function serializeSystemPrompts(items: SystemPrompt[]): string {
  const env: CollectionEnvelope<SystemPrompt> = {
    type: "mimir.systemPrompts",
    ...envelopeMeta(),
    // Presets are generated, not portable — export only custom prompts.
    items: items.filter((p) => p.source === "user"),
  };
  return JSON.stringify(env, null, 2);
}

/* ------------------------- Markdown (conversations) --------------------- */

const ROLE_HEADINGS: Record<Message["role"], string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
};

/**
 * Renders a conversation as readable Markdown. Tool-call markers become inline
 * notes and <think> blocks become labeled blockquotes, so the export reads
 * cleanly while still recording what happened. A machine-readable comment after
 * the title lets the Markdown importer recover the title and model.
 */
export function serializeConversationMarkdown(conv: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${conv.title || "Untitled conversation"}`);
  lines.push("");
  lines.push(
    `<!-- mimir:conversation v=${TRANSFER_VERSION}${
      conv.model ? ` model=${conv.model}` : ""
    } exported=${new Date().toISOString()} -->`
  );
  lines.push("");

  for (const m of conv.messages) {
    if (m.role === "system") continue; // system text isn't part of a chat turn
    lines.push(`## ${ROLE_HEADINGS[m.role]}`);
    lines.push("");

    if (m.attachments && m.attachments.length > 0) {
      lines.push("**Attached files:**");
      for (const a of m.attachments) {
        lines.push(
          `- \`${a.name}\` (${a.kind === "pdf" ? "PDF" : "text"}${
            a.truncated ? ", truncated" : ""
          })`
        );
      }
      lines.push("");
    }

    lines.push(renderMessageBodyMarkdown(m).trim() || "_(empty)_");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function renderMessageBodyMarkdown(m: Message): string {
  if (m.role !== "assistant") return m.content;
  // Walk the transcript so <think> blocks and tool markers render as notes
  // rather than leaking raw sentinels into the Markdown.
  const segments = parseTranscript(m.content);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      out.push(seg.text.trim());
    } else if (seg.type === "think") {
      const thought = seg.text.trim();
      if (thought) {
        out.push(
          thought
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")
        );
        out.push("> \n> _(model thinking)_");
      }
    } else if (seg.type === "tool") {
      const ev = m.toolEvents?.find((e) => e.index === seg.index);
      out.push(`*— used tool: \`${ev?.name ?? "tool"}\` —*`);
    }
  }
  return out.filter(Boolean).join("\n\n");
}

/* -------------------------------- parsing ------------------------------- */

/** The normalized result of inspecting an arbitrary import file. */
export type ParsedTransfer =
  | { kind: "conversation"; conversation: Conversation }
  | {
      kind: "backup";
      conversations: Conversation[];
      workspaces: Workspace[];
      imageStudios: ImageStudio[];
      memories: Memory[];
      skills: Skill[];
      systemPrompts: SystemPrompt[];
      settings?: Settings;
    }
  | { kind: "memories"; items: Memory[] }
  | { kind: "skills"; items: Skill[] }
  | { kind: "systemPrompts"; items: SystemPrompt[] }
  | { kind: "error"; error: string };

/**
 * Inspects a file's text (and optional name) and returns what it is. Accepts
 * our typed envelopes, bare arrays (type inferred from item shape), a bare
 * conversation object, and our Markdown conversation format. Never throws —
 * returns a `kind: "error"` instead so the UI can show a message.
 */
export function parseTransferFile(
  text: string,
  filename?: string
): ParsedTransfer {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "error", error: "The file is empty." };

  // Try JSON first.
  let json: unknown = undefined;
  try {
    json = JSON.parse(trimmed);
  } catch {
    json = undefined;
  }

  if (json !== undefined) return parseJsonTransfer(json);

  // Not JSON — try Markdown conversation if it looks like one.
  if (
    /\.md$|\.markdown$/i.test(filename ?? "") ||
    /^#\s+/m.test(trimmed) ||
    /^##\s+(User|Assistant)\b/m.test(trimmed)
  ) {
    const conv = parseConversationMarkdown(trimmed);
    if (conv) return { kind: "conversation", conversation: conv };
    return {
      kind: "error",
      error: "Couldn't parse this Markdown as a Mimir conversation.",
    };
  }

  return {
    kind: "error",
    error: "Unrecognized file. Expected Mimir JSON or a conversation Markdown file.",
  };
}

function parseJsonTransfer(json: unknown): ParsedTransfer {
  // Typed envelopes.
  if (isObject(json) && typeof json.type === "string") {
    const t = json.type;
    if (t === "mimir.conversation" && isObject(json.conversation)) {
      return {
        kind: "conversation",
        conversation: json.conversation as unknown as Conversation,
      };
    }
    if (t === "mimir.backup") {
      const b = json as unknown as Partial<BackupEnvelope>;
      return {
        kind: "backup",
        conversations: asArray(b.conversations),
        workspaces: asArray(b.workspaces),
        imageStudios: asArray(b.imageStudios),
        memories: asArray(b.memories),
        skills: asArray(b.skills),
        systemPrompts: asArray(b.systemPrompts),
        settings: isObject(b.settings) ? (b.settings as unknown as Settings) : undefined,
      };
    }
    if (t === "mimir.memories") {
      return { kind: "memories", items: asArray(json.items) };
    }
    if (t === "mimir.skills") {
      return { kind: "skills", items: asArray(json.items) };
    }
    if (t === "mimir.systemPrompts") {
      return { kind: "systemPrompts", items: asArray(json.items) };
    }
  }

  // A bare conversation object.
  if (isObject(json) && Array.isArray((json as { messages?: unknown }).messages)) {
    return { kind: "conversation", conversation: json as unknown as Conversation };
  }

  // A bare array — infer the item type from the first element's shape.
  if (Array.isArray(json)) {
    const inferred = inferArrayKind(json);
    if (inferred) return inferred;
    return {
      kind: "error",
      error: "Couldn't tell what this array of items is (memories, skills, or system prompts).",
    };
  }

  return { kind: "error", error: "Unrecognized JSON structure." };
}

/** Guess whether a bare array holds memories, skills, or system prompts. */
function inferArrayKind(arr: unknown[]): ParsedTransfer | null {
  const first = arr.find(isObject) as Record<string, unknown> | undefined;
  if (!first) return { kind: "memories", items: [] };
  // Skills: have name + body + (scripts or description) but no `source: user/auto` memory shape.
  if ("body" in first && "name" in first && !("messages" in first)) {
    // System prompts also have name + body; distinguish by `source` values.
    if (first.source === "preset" || ("presetKey" in first)) {
      return { kind: "systemPrompts", items: arr as SystemPrompt[] };
    }
    if ("scripts" in first || "description" in first) {
      // Could be a skill or a system prompt; skills carry `scripts`.
      if ("scripts" in first) return { kind: "skills", items: arr as Skill[] };
      return { kind: "systemPrompts", items: arr as SystemPrompt[] };
    }
    return { kind: "systemPrompts", items: arr as SystemPrompt[] };
  }
  // Memories: have content + (source/category) and no name/body.
  if ("content" in first && !("messages" in first)) {
    return { kind: "memories", items: arr as Memory[] };
  }
  return null;
}

/**
 * Parses our Markdown conversation format back into a Conversation. Splits on
 * `## User` / `## Assistant` headings; everything else (the title comment,
 * thinking blockquotes, tool notes) is captured as content. Lossy by design —
 * JSON is the exact format.
 */
export function parseConversationMarkdown(md: string): Conversation | null {
  const text = md.replace(/\r\n/g, "\n");
  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "Imported conversation";
  const modelMatch = text.match(/<!--\s*mimir:conversation[^>]*\bmodel=([^\s]+)/);
  const model = modelMatch ? modelMatch[1] : undefined;

  // Find role headings and slice the content between consecutive headings.
  const headingRe = /^##\s+(User|Assistant|System)\s*$/gim;
  const heads: { role: Message["role"]; contentStart: number; lineStart: number }[] =
    [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text))) {
    heads.push({
      role: m[1].toLowerCase() as Message["role"],
      contentStart: m.index + m[0].length,
      lineStart: m.index,
    });
  }
  if (heads.length === 0) return null;

  const now = Date.now();
  const messages: Message[] = [];
  heads.forEach((seg, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].lineStart : text.length;
    let body = text.slice(seg.contentStart, end).trim();
    // Strip an "Attached files:" preamble we may have written (it's metadata,
    // not message prose), leaving the actual content.
    body = body.replace(/^\*\*Attached files:\*\*[\s\S]*?(?:\n\n|$)/, "").trim();
    if (body === "_(empty)_") body = "";
    messages.push({
      id: `mmsg_${now}_${i}`,
      role: seg.role,
      content: body,
      createdAt: now + i,
    });
  });

  return {
    id: `mconv_${now}`,
    title,
    model,
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------- re-id-ing ------------------------------ */

/**
 * Produces an import-ready copy of a conversation with fresh ids throughout and
 * organization metadata stripped (folder/tag references belong to the exporting
 * account). Message ids are regenerated because they are global primary keys.
 */
export function reidConversation(
  conv: Conversation,
  uid: (p?: string) => string
): Conversation {
  const now = Date.now();
  return {
    ...conv,
    id: uid("conv_"),
    folderId: undefined,
    tagIds: [],
    pinned: false,
    createdAt: conv.createdAt ?? now,
    updatedAt: now,
    messages: (conv.messages ?? []).map((msg) => ({
      ...msg,
      id: uid("msg_"),
    })),
  };
}

export function reidWorkspace(
  ws: Workspace,
  uid: (p?: string) => string
): Workspace {
  const now = Date.now();
  return {
    ...ws,
    id: uid("ws_"),
    folderId: undefined,
    tagIds: [],
    pinned: false,
    createdAt: ws.createdAt ?? now,
    runs: (ws.runs ?? []).map(
      (r): AgentRun => ({ ...r, id: uid("run_") })
    ),
  };
}

export function reidImageStudio(
  studio: ImageStudio,
  uid: (p?: string) => string
): ImageStudio {
  const now = Date.now();
  return {
    ...studio,
    id: uid("img_"),
    folderId: undefined,
    tagIds: [],
    pinned: false,
    createdAt: studio.createdAt ?? now,
    updatedAt: now,
    images: (studio.images ?? []).map(
      (img): GeneratedImage => ({ ...img, id: uid("gi_") })
    ),
  };
}

/* ------------------------------ small utils ----------------------------- */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** A filesystem-safe slug for export filenames. */
export function slugify(s: string, fallback = "export"): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

/** A short date stamp (YYYY-MM-DD) for export filenames. */
export function dateStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
