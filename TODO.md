## Todo
- LATER scheduled/recurring agent tasks (e.g. a periodic memory-consolidation run).

- make it so generation doesn't halt when the browser tab closes (needs server-side run execution; the run loop currently lives in the client).
- adjust lower/upper bounds for things like agent steps, max token usage
- get rid of searxng customizable url
- uploading zips to workspaces needs to be possible (so you can send it a pre-existing project)
- add somewhat extensive set of workspace toolchains. For example, we need gcc, python, rust, go, all of the popular languages and whatnot.


<!-- ===========================================================================
  Ideas below were added during a planning/documentation pass. Nothing here has
  been implemented yet. They're grouped by type; refactor items each spell out
  what they're meant to address.
============================================================================ -->

## Major features

- **Server-side run execution (durable runs).** Promote the chat/agent run loop
  off the client and onto the server, with the browser subscribing to a live
  stream. This is the enabler for the existing "generation shouldn't halt when
  the tab closes" item, and it also unblocks scheduled/recurring agents.

- **Per-conversation system prompt.** System prompts are global-only today
  (they apply to every chat and agent). Add a per-conversation prompt/override —
  a small per-chat drawer or composer field — layered on top of the global set.

- **Per-chat / per-agent generation parameters.** `lib/llama.ts` currently sends
  only `model` / `messages` / `tools` / `stream` — nothing sets temperature,
  top_p, top_k, max_tokens, repeat_penalty, seed, or stop sequences, so output
  is completely untunable. Add a sampling-params control (per conversation and
  per workspace agent, with sane defaults) and thread it through `streamChat`.

- **Web access for workspace agents.** The agent's tool registry
  (`useWorkspaceRunner`) is filesystem + `run_command` + planning only — an agent
  can't look anything up mid-run. Wire `web_search` / `web_fetch` into the agent
  registry (gated by the same Tools-window switches), so a coding agent can read
  docs while it works.

- **Multimodal / vision input.** Let users attach images (and maybe PDFs) to chat
  messages for models that accept image input — requires content-array messages
  in `lib/llama.ts`. Gate on model capability.

- **Attach files/documents to a conversation as context.** Drop a file into a
  chat and have the model read it (direct context injection now; lightweight
  retrieval later for big files).

- **Binary-file support in the workspace filesystem.** The store FS is text-only,
  so images / PDFs / archives a command produces are skipped on sync and previews
  can't render real binary images. Store binary nodes (e.g. base64) so generated
  artifacts survive, downloads are faithful, and the editor can preview them.
  Pairs with the "upload zips to workspaces" item.

- **True interactive terminal (PTY / streaming).** Replace the run-to-completion
  command runner with a streaming PTY so REPLs, interactive prompts, and
  long-lived dev servers work, plus a preview proxy for servers an agent starts.

- **Per-workspace sandbox image & network in the UI.** Surface `SANDBOX_IMAGE` /
  `SANDBOX_NETWORK` (and maybe the resource limits) as per-workspace settings
  rather than one global env, so different workspaces can use different
  toolchains. Pairs with the "extensive workspace toolchains" item.

- **Memory retrieval that scales.** `buildMemoryPrompt` injects *every* enabled
  memory on *every* request, which stops scaling past a few dozen. Add
  relevance-based retrieval (embeddings or keyword) so only pertinent memories
  are injected — the `source: "user" | "auto"` split already anticipates this.
  Related: auto-memory dedup/merge, and an editable confirmation step before an
  auto-saved memory is committed.

- **Skill script execution in chat.** Wire chat `load_skill` scripts to a sandbox
  runner so the chat tool loop can run them (today only workspaces can). Removes
  a currently-documented stub.

- **Conversation organization.** Folders / tags / pinning and richer
  search-and-filter in the Conversations window.

- **OAuth / social sign-in.** Better Auth makes additional providers a small
  addition — useful for shared instances.

- **Export / import.** Export a conversation (Markdown/JSON) and a full-account
  backup; bulk-import skills, system prompts, and memories from files.

- **Edit-in-place + branching.** Allow editing a prior user message (not just
  resend-and-truncate) and branching a conversation from any message.

- **Usage & cost view.** Aggregate tokens — and, for hosted endpoints, estimated
  cost — per endpoint / conversation / agent run. The per-message stats already
  capture the raw numbers.

- **Decision: default web tools on?** Now that `SEARXNG_URL` ships configured,
  `web_search` / `web_fetch` still default OFF in `DEFAULT_TOOL_SETTINGS`. Decide
  whether to flip them on by default (vs. keeping the explicit privacy opt-in).

## Bug fixes & correctness

- **Stale privacy copy.** Settings → System → Privacy still says data is "stored
  locally in your browser." Data now lives in PostgreSQL, scoped to the account
  (Valkey-cached). Rewrite the copy to match reality and clarify hosted-endpoint
  egress.

- **`.env` secret-leak footgun.** `.gitignore` ignores `.env*.local` but NOT
  `.env`, and docker compose requires `.env`. A real-looking `BETTER_AUTH_SECRET`
  is currently committed in `.env`. Add `.env` to `.gitignore`, remove the
  tracked `.env`, and rotate any committed secret. Optional hardening: have
  `docker-entrypoint.sh` generate and persist a random secret when none is set,
  so an instance never runs with a shared/empty one.

- **Stale doc path in `types.ts`.** The `Memory` doc comment references a
  non-existent `lib/memoryTool.ts` (twice) — the file is `lib/memory.ts`. Fix it
  so the data model documents itself correctly.

- **Dead "sub-agent" references.** Multi-agent delegation was removed, but
  comments/docstrings still mention it in `lib/workspace/agent.ts`,
  `useWorkspaceRunner.ts`, and `WorkspaceView.tsx` — and `AgentSettings.tsx`'s
  docstring still claims it tunes "whether it may spawn sub-agents," which no
  longer exists. Purge these so docs match the single-agent reality.

- **Unused `engine` field.** `/api/websearch` parses and returns a per-result
  `engine`, but `webtools.ts` never uses it when formatting results for the
  model. Surface it or drop the plumbing.

- **Stray `.dockerignore` entry.** It lists a leftover personal `mmm.zip`;
  remove it (it's redundant with the `*.zip` line anyway).

- **Placeholder drift.** The manual-models textareas in `SettingsView` disagree
  on the example model id (`claude-opus-4-8` vs `claude-opus-4-6`); pick one.

## Refactors (readability / maintainability / modularity / extensibility)

- **Split `lib/store.ts` into per-domain slices.** It's ~36 KB with every action
  in one file. Break it into conversations, workspaces/runs, memories, skills,
  system prompts, settings/endpoints, and UI (tabs/windows) slices composed into
  one Zustand store. *Addresses:* the readability, maintainability, and
  merge-conflict surface of a single oversized file mixing many concerns; makes
  each domain independently testable and extensible.

- **Unify the chat and agent tool loops.** `runToolLoop` (`lib/tools.ts`) and
  `runAgentTurn` (`lib/workspace/agent.ts`) independently re-implement nearly
  identical logic: pending-chip emission, `⟦tool:N⟧` marker injection, running a
  call, prune-info tagging, and compaction chips. Extract a shared
  "stream-a-completion + run-its-tool-calls + emit-chips" primitive both build
  on. *Addresses:* duplicated, drift-prone logic that must currently be kept in
  sync by hand; lets new tool-loop behavior land in one place.

- **One source for the `context_compaction` tool name.** It's hard-coded as a
  separate constant in three files (`tools.ts`, `contextManager.ts` exports one,
  `agent.ts` redefines it). Import the exported one everywhere. *Addresses:*
  magic-string duplication that can silently drift and break the UI chip mapping.

- **Rename `budgetLeft()` in `agent.ts`.** It returns `true` when the budget is
  *exhausted* — the opposite of what the name reads as (`if (budgetLeft()) {
  status = "max_tokens"; break; }`). Rename to `budgetExhausted()` or invert it.
  *Addresses:* a genuinely misleading name in the loop's stop logic.

- **Remove the no-op filter in `sandbox.ts`.** `synced.filter((f) => f.type !==
  "dir" || true)` is always true (dead code). Drop it. *Addresses:* confusing
  dead code in the file-sync path.

- **Dedupe shared route helpers.** `clampInt` (and the HTML-entity / text
  extraction helpers) are copy-pasted across `app/api/websearch/route.ts` and
  `app/api/webfetch/route.ts`. Lift them into a small shared `lib/server/http.ts`.
  *Addresses:* duplicated utility code.

- **Centralize tool-output character caps.** `READ_CHAR_CAP` (filesystemTool),
  `MODEL_OUTPUT_CAP` (execTool), web-fetch `maxChars`, and the sandbox output cap
  are independent magic numbers. Gather them into one config surface (ideally
  user-tunable alongside context management). *Addresses:* scattered limits that
  should be discoverable and adjustable together.

- **Give `streamChat` a single options object.** So sampling parameters (see the
  generation-parameters feature) can be threaded through without touching every
  call site. *Addresses:* turns that feature into a localized change instead of a
  wide one.
