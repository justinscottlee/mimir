## Major features

- **Server-side run execution (durable runs).** Promote the chat/agent run loop
  off the client and onto the server, with the browser subscribing to a live
  stream. This will enable tasks.

- **Scheduled agentic tasks** e.g. a periodic memory-consolidation run.

- **Custom parameters.** Make it so that the user can on a per-model basis adjust temperature, top_p, top_k, repeat_penalty, presence_penalty, min_p. Along with a clean user interface/experience for this customization.

- **Multimodal (image) input.** Text files and PDFs can now be attached to chat
  messages as injected text context (see below). The remaining piece is true
  multimodal input: attaching *images* (and passing PDFs as native documents)
  for models that accept them, rather than as extracted text. Detect capability
  and fail gracefully when unsupported. The attachment plumbing
  (`lib/attachments.ts`, the `Message.attachments` field + jsonb column, the
  composer UI) is in place to build on; today non-text/non-PDF binaries are
  rejected at attach time, and scanned/image-only PDFs yield no text (no OCR).

- **Memory retrieval that scales.** `buildMemoryPrompt` injects *every* enabled
  memory on *every* request, which stops scaling past a few dozen. Add
  relevance-based retrieval (embeddings or keyword) so only pertinent memories
  are injected — the `source: "user" | "auto"` split already anticipates this.

- **Skill script execution in chat.** Wire chat `load_skill` scripts to a sandbox
  runner so the chat tool loop can run them (today only workspaces can). Removes
  a currently-documented stub.

- **Full-screen TUI support in the terminal.** The built-in ANSI model degrades
  gracefully on the alternate screen, so `vim`/`htop`/`less` don't render
  perfectly. Either grow the model to handle the alternate screen + scroll
  regions, or adopt xterm.js behind the same SSE transport.

- **Inline run cost.** Tie the Usage pricing table into the workspace transcript
  and chat so a run shows its estimated spend as it goes, not just in aggregate.

## Refactoring / tech debt

- **Continue slicing `store.ts`.** The per-domain slice pattern in
  `lib/store-slices/` now covers organization, the image studio, transfer
  (import/restore), and workspace agent-runs — `store.ts` dropped from ~1390 to
  ~1180 lines. The remaining inline blocks are good next extractions: the
  conversation/message actions (new/append/edit/delete/title, the streaming
  flags) and the workspace *filesystem* actions (`setWorkspaceFiles`, file CRUD,
  agent config). Each is fairly self-contained and would shrink the core store
  further.

- **Split the largest view components.** A few view files are large enough to be
  awkward to navigate and should be broken into subcomponents/hooks:
  `components/views/ImageStudioView.tsx` (~1650 lines),
  `components/views/LibraryView.tsx` (~1480), and
  `components/views/ChatView.tsx` (~1420). Natural seams: the Library's
  context-menu + row + folder-rail; Chat's composer (`ChatInput` + attachment
  handling) vs. message list vs. message row; the Image Studio's composer vs.
  gallery vs. detail.

## Minor tweaks / UX

- **Terminal niceties.** Copy-on-select and right-click paste; a clear-screen
  affordance; remember scrollback across a `restart`.

- **Bulk-import discoverability.** Bulk import for memories/skills/system prompts
  currently lives in Settings → Data. Consider also surfacing an "Import" action
  directly in each manager view (Memories / Skills / System Prompts) for
  discoverability.
