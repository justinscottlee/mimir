"use client";

import {
  Conversation,
  Memory,
  SandboxStatus,
  Settings,
  Skill,
  SystemPrompt,
  UserStateSnapshot,
  UserUiState,
  Workspace,
  WorkspaceExecResult,
  WorkspaceFile,
} from "./types";

/**
 * Thin typed wrappers over the /api/* state routes. Every call is same-origin
 * so the Better Auth session cookie rides along automatically. Mutations are
 * fire-and-forget from the store's perspective (optimistic UI); these reject on
 * non-2xx so the sync layer can log/retry.
 */

async function req(
  method: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(`${method} ${url} -> ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** Fetch the full snapshot. Returns null on 401 (not signed in). */
export async function fetchState(): Promise<UserStateSnapshot | null> {
  const res = await fetch("/api/state");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /api/state -> ${res.status}`);
  return (await res.json()) as UserStateSnapshot;
}

export const api = {
  putConversation: (c: Conversation) =>
    req("PUT", `/api/conversations/${encodeURIComponent(c.id)}`, c),
  deleteConversation: (id: string) =>
    req("DELETE", `/api/conversations/${encodeURIComponent(id)}`),
  deleteConversationsBatch: (ids: string[]) =>
    req("POST", `/api/conversations/delete-batch`, { ids }),

  putWorkspace: (w: Workspace) =>
    req("PUT", `/api/workspaces/${encodeURIComponent(w.id)}`, w),
  deleteWorkspace: (id: string) =>
    req("DELETE", `/api/workspaces/${encodeURIComponent(id)}`),
  execWorkspaceCommand: (
    id: string,
    command: string,
    files: WorkspaceFile[],
    signal?: AbortSignal
  ): Promise<{
    result: WorkspaceExecResult;
    files: WorkspaceFile[];
  }> =>
    req(
      "POST",
      `/api/workspaces/${encodeURIComponent(id)}/exec`,
      { command, files },
      signal
    ) as Promise<{ result: WorkspaceExecResult; files: WorkspaceFile[] }>,
  sandboxStatus: (id: string): Promise<SandboxStatus> =>
    req("GET", `/api/workspaces/${encodeURIComponent(id)}/exec`) as Promise<SandboxStatus>,
  resetWorkspaceSandbox: (id: string) =>
    req("DELETE", `/api/workspaces/${encodeURIComponent(id)}/exec`),

  // Interactive terminal (PTY). The output stream itself is consumed via
  // EventSource against the same path with ?ptyId=… (see Terminal.tsx).
  openPty: (
    id: string,
    files: WorkspaceFile[],
    cols: number,
    rows: number
  ): Promise<{ ptyId: string }> =>
    req("POST", `/api/workspaces/${encodeURIComponent(id)}/pty`, {
      action: "open",
      files,
      cols,
      rows,
    }) as Promise<{ ptyId: string }>,
  ptyInput: (id: string, ptyId: string, data: string) =>
    req("POST", `/api/workspaces/${encodeURIComponent(id)}/pty`, {
      action: "input",
      ptyId,
      data,
    }),
  ptyResize: (id: string, ptyId: string, cols: number, rows: number) =>
    req("POST", `/api/workspaces/${encodeURIComponent(id)}/pty`, {
      action: "resize",
      ptyId,
      cols,
      rows,
    }),
  closePty: (
    id: string,
    ptyId: string,
    files: WorkspaceFile[]
  ): Promise<{ files: WorkspaceFile[]; skipped?: string[] }> =>
    req("POST", `/api/workspaces/${encodeURIComponent(id)}/pty`, {
      action: "close",
      ptyId,
      files,
    }) as Promise<{ files: WorkspaceFile[]; skipped?: string[] }>,

  putMemory: (m: Memory) =>
    req("PUT", `/api/memories/${encodeURIComponent(m.id)}`, m),
  deleteMemory: (id: string) =>
    req("DELETE", `/api/memories/${encodeURIComponent(id)}`),

  putSkill: (s: Skill) => req("PUT", `/api/skills/${encodeURIComponent(s.id)}`, s),
  deleteSkill: (id: string) =>
    req("DELETE", `/api/skills/${encodeURIComponent(id)}`),

  putSystemPrompt: (p: SystemPrompt) =>
    req("PUT", `/api/system-prompts/${encodeURIComponent(p.id)}`, p),
  deleteSystemPrompt: (id: string) =>
    req("DELETE", `/api/system-prompts/${encodeURIComponent(id)}`),

  putSettings: (s: Settings) => req("PUT", `/api/settings`, s),
  putUiState: (ui: UserUiState) => req("PUT", `/api/ui-state`, ui),
};
