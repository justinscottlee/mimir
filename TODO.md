## Todo (near-term)

- LATER scheduled/recurring agent tasks (e.g. a periodic memory-consolidation run).
- Make it so generation doesn't halt when the browser tab closes (needs
  server-side run execution; the run loop currently lives in the client).

## Major features

- **Server-side run execution (durable runs).** Promote the chat/agent run loop
  off the client and onto the server, with the browser subscribing to a live
  stream. This is the enabler for the existing "generation shouldn't halt when
  the tab closes" item, and it also unblocks scheduled/recurring agents.

- **Per-chat / per-agent generation parameters.** `lib/llama.ts` currently sends
  only `model` / `messages` / `tools` / `stream` — nothing sets temperature,
  top_p, top_k, max_tokens, repeat_penalty, seed, or stop sequences, so output
  is completely untunable. Add a sampling-params control (per conversation and
  per workspace agent, with sane defaults) and thread it through `streamChat`.

- **Multimodal / vision input.** Let users attach images (and maybe PDFs) to chat
  messages for models that accept image input — requires content-array messages
  in `lib/llama.ts`. Gate on model capability.

- **Attach files/documents to a conversation as context.** Drop a file into a
  chat and have the model read it (direct context injection now; lightweight
  retrieval later for big files).

- **Memory retrieval that scales.** `buildMemoryPrompt` injects *every* enabled
  memory on *every* request, which stops scaling past a few dozen. Add
  relevance-based retrieval (embeddings or keyword) so only pertinent memories
  are injected — the `source: "user" | "auto"` split already anticipates this.
  Related: auto-memory dedup/merge, and an editable confirmation step before an
  auto-saved memory is committed.

- **Skill script execution in chat.** Wire chat `load_skill` scripts to a sandbox
  runner so the chat tool loop can run them (today only workspaces can). Removes
  a currently-documented stub.

- **OAuth / social sign-in.** Better Auth makes additional providers a small
  addition — useful for shared instances.

- **Export / import.** Export a conversation (Markdown/JSON) and a full-account
  backup; bulk-import skills, system prompts, and memories from files.

- **Full-screen TUI support in the terminal.** The built-in ANSI model degrades
  gracefully on the alternate screen, so `vim`/`htop`/`less` don't render
  perfectly. Either grow the model to handle the alternate screen + scroll
  regions, or adopt xterm.js behind the same SSE transport.

- **Inline run cost.** Tie the Usage pricing table into the workspace transcript
  and chat so a run shows its estimated spend as it goes, not just in aggregate.

## Minor tweaks / UX

- **Library bulk actions.** Multi-select rows to tag / move / delete several at
  once, and add explicit sort options (name, created, updated) beyond the current
  pinned-then-recent ordering.
- **Persist the active workspace center tab.** Which of Agent / Terminal / editor
  is showing resets to Agent on reload; remember it per workspace.
- **Keyboard nav in the file explorer.** Arrow-key movement, F2 to rename, Delete
  to remove, so the tree is usable without the mouse alongside the new
  drag-to-move.
- **Confirm-on-close for tabs with an in-flight run.** Closing a tab mid-generation
  silently stops the run; warn first (and once durable runs land, just detach).
- **Terminal niceties.** Copy-on-select and right-click paste; a clear-screen
  affordance; remember scrollback across a `restart`.

## Bug fixes / hardening

- **Empty-tab discard edge cases.** Closing an untouched chat/workspace now
  discards it (keyed on `messages.length` / `files`+`runs`). Double-check the
  stop-before-first-token path so a conversation that started streaming but
  produced nothing is handled the way the user expects.
- **File drag-to-move onto a file row.** Dropping a node directly onto another
  *file* currently bubbles to the container and lands at the root; consider
  making a file row target its parent directory for a more intuitive drop.
- **Terminal initial sizing.** `measure()` runs once on open and the
  ResizeObserver corrects shortly after; on very fast tab switches the first
  cols/rows can be momentarily off — an immediate post-`live` remeasure would
  tighten it.
- **Drop the deprecated `tool_output` column.** read_file / run_command caps are
  now a fixed constant; the `settings.tool_output` jsonb column is unused and
  flagged `@deprecated`. Remove it in a future migration once rows are reconciled.
- **Prune the legacy `pricing.currency` field.** The usage view is now
  dollars-only and the type dropped `currency`; stored `pricing` jsonb may still
  carry an old `currency` key. Harmless (ignored), but a migration could prune it.

## Refactoring

- **Keep extracting store slices.** `lib/store.ts` is large (~1.2k lines).
  `organizationSlice` was the first lift; follow with `tabsSlice`,
  `conversationsSlice`, and `workspacesSlice` along the same boundary.
- **One context-menu primitive.** `TabBar`, `FileExplorer`, and `LibraryView`
  each hand-roll a portal + viewport-clamp + outside-click + Escape context menu.
  Extract a single `<ContextMenu>` and reuse it.
- **One inline-rename primitive.** The tab title, file rows, and Library rows all
  reimplement an input with Enter/Escape/blur-to-commit. Fold it into a small
  hook or component.
- **Shared `isEmptyRef` predicate.** The new tab-close cleanup decides "empty"
  inline; lift it to a shared helper so the Library and any future call sites
  agree on the definition.
