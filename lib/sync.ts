"use client";

import { api } from "./api";
import {
  Conversation,
  Memory,
  Settings,
  Skill,
  SystemPrompt,
  UserUiState,
  Workspace,
} from "./types";

/**
 * Persistence is optimistic: the store mutates in-memory immediately, and these
 * helpers push the change to Postgres in the background. Writes are debounced
 * and coalesced per key so high-frequency mutations (streaming tokens into a
 * message, dragging a window) collapse into a single save once things settle.
 *
 * Deletes are immediate and also cancel any pending save for that key so a
 * queued upsert can't resurrect a just-deleted row.
 */

const DEBOUNCE = {
  conversation: 700, // coalesce streaming patches
  ui: 600, // coalesce drags/resizes
  settings: 500,
  entity: 350, // memories / skills / system prompts / workspaces
};

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  run: () => Promise<unknown>;
}

const pending = new Map<string, Pending>();

function schedule(key: string, delay: number, run: () => Promise<unknown>) {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const fire = () => {
    pending.delete(key);
    return run().catch((err) => {
      // Best-effort: log and move on. The next mutation will retry, and a full
      // reload re-reads the durable server state.
      console.warn("[sync] save failed:", err);
    });
  };
  pending.set(key, { timer: setTimeout(fire, delay), run: fire });
}

/** Cancels a pending save for a key (used right before a delete). */
function cancel(key: string) {
  const existing = pending.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(key);
  }
}

/**
 * Flushes all pending saves immediately (e.g. on sign-out / page hide) and
 * resolves once they've all been attempted. Callers about to tear down the
 * session or reload can await this to avoid dropping the last write.
 */
export function flushAll(): Promise<unknown> {
  const runs: Promise<unknown>[] = [];
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    runs.push(p.run());
  }
  return Promise.all(runs);
}

/* ------------------------------ conversations --------------------------- */

export function syncConversation(c: Conversation) {
  schedule(`conv:${c.id}`, DEBOUNCE.conversation, () => api.putConversation(c));
}
export function deleteConversation(id: string) {
  cancel(`conv:${id}`);
  return api.deleteConversation(id);
}
export function deleteConversationsBatch(ids: string[]) {
  for (const id of ids) cancel(`conv:${id}`);
  return api.deleteConversationsBatch(ids);
}

/* ------------------------------- workspaces ----------------------------- */

export function syncWorkspace(w: Workspace) {
  schedule(`ws:${w.id}`, DEBOUNCE.entity, () => api.putWorkspace(w));
}
export function deleteWorkspace(id: string) {
  cancel(`ws:${id}`);
  return api.deleteWorkspace(id);
}

/* -------------------------------- memories ------------------------------ */

export function syncMemory(m: Memory) {
  schedule(`mem:${m.id}`, DEBOUNCE.entity, () => api.putMemory(m));
}
export function deleteMemory(id: string) {
  cancel(`mem:${id}`);
  return api.deleteMemory(id);
}

/* --------------------------------- skills ------------------------------- */

export function syncSkill(s: Skill) {
  schedule(`skill:${s.id}`, DEBOUNCE.entity, () => api.putSkill(s));
}
export function deleteSkill(id: string) {
  cancel(`skill:${id}`);
  return api.deleteSkill(id);
}

/* ----------------------------- system prompts --------------------------- */

export function syncSystemPrompt(p: SystemPrompt) {
  schedule(`sysp:${p.id}`, DEBOUNCE.entity, () => api.putSystemPrompt(p));
}
export function deleteSystemPrompt(id: string) {
  cancel(`sysp:${id}`);
  return api.deleteSystemPrompt(id);
}

/* ----------------------------- settings / ui ---------------------------- */

export function syncSettings(s: Settings) {
  schedule("settings", DEBOUNCE.settings, () => api.putSettings(s));
}
export function syncUiState(ui: UserUiState) {
  schedule("ui", DEBOUNCE.ui, () => api.putUiState(ui));
}
