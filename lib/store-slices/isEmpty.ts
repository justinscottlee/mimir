import { Conversation, ImageStudio, TabKind, Workspace } from "../types";

/**
 * Shared "is this an untouched shell?" predicates. The tab-close cleanup
 * (`discardIfEmpty`) and any future call site (e.g. a Library "clean up empty
 * items" action) agree on one definition here instead of deciding inline.
 */

/**
 * A conversation counts as empty when it carries no real content yet: no
 * message has visible text and none ran a tool. This is a superset of the old
 * "zero messages" check — `[].every` is true — and additionally covers the
 * stop-before-first-token path, where a send can leave behind an empty
 * assistant bubble with nothing in it. A conversation where the user actually
 * typed and sent a prompt is *not* empty (that user message has content), so
 * their prompt is never silently discarded.
 */
export function isEmptyConversation(c: Conversation | undefined): boolean {
  if (!c) return false;
  return c.messages.every(
    (m) => m.content.trim() === "" && (m.toolEvents?.length ?? 0) === 0
  );
}

/** A workspace is empty when it has no files and no agent runs. */
export function isEmptyWorkspace(w: Workspace | undefined): boolean {
  if (!w) return false;
  return w.files.length === 0 && w.runs.length === 0;
}

/** An image studio is empty when its gallery has no images. */
export function isEmptyStudio(s: ImageStudio | undefined): boolean {
  if (!s) return false;
  return s.images.length === 0;
}

/** Dispatch the right emptiness predicate for a tab kind. */
export function isEmptyRef(
  kind: TabKind,
  refId: string,
  state: {
    conversations: Record<string, Conversation>;
    workspaces: Record<string, Workspace>;
    imageStudios: Record<string, ImageStudio>;
  }
): boolean {
  if (kind === "chat") return isEmptyConversation(state.conversations[refId]);
  if (kind === "image") return isEmptyStudio(state.imageStudios[refId]);
  return isEmptyWorkspace(state.workspaces[refId]);
}
