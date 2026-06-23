<p align="center">
  <img src="public/mimir-brand.png" alt="Mimir" width="420" />
</p>

<p align="center">
  <strong>A self-hosted AI workbench for your own models.</strong><br/>
  Chat, long-term memory, skills, web search, transparent prompt assembly, and
  autonomous coding agents with a real execution sandbox — all behind your own
  login, all talking only to endpoints <em>you</em> control.
</p>

<p align="center">
  <em>Next.js 14 · TypeScript · Tailwind · Zustand · PostgreSQL + Drizzle · Valkey · Better Auth · Docker · SearXNG</em>
</p>

---

Mimir turns any OpenAI-compatible endpoint — a local **llama.cpp** server, or a
hosted API like Groq, OpenAI, OpenRouter, Together, or Anthropic — into a
full-featured workbench. It is **local-first** (your conversations, memories,
skills, and settings live in your own Postgres, not someone else's cloud),
**transparent** (you can see the exact system prompt, every tool call, and every
byte that leaves the machine), and **agentic** (workspaces give a model a real
Linux sandbox to write code, run it, read the errors, and fix them).

> **The name.** Mímir is the wisest being in Norse myth — keeper of the well of
> knowledge beneath the world-tree, whose counsel Odin valued above all others.
> When Mímir was beheaded, Odin preserved the head and kept it close to consult
> for secret knowledge. A head you keep nearby and ask for wisdom felt like the
> right namesake for a private AI you actually own.

---

## Table of contents

- [Highlights](#highlights)
- [What Mimir is](#what-mimir-is)
- [The interface](#the-interface)
- [Feature tour](#feature-tour)
  - [Endpoints & models](#endpoints--models)
  - [Chat](#chat)
  - [Memories](#memories)
  - [Skills](#skills)
  - [System prompts](#system-prompts)
  - [Tools & the tool loop](#tools--the-tool-loop)
  - [Web tools (search & fetch)](#web-tools-search--fetch)
  - [Context management](#context-management)
  - [Workspaces (agentic sandboxes)](#workspaces-agentic-sandboxes)
  - [Export, import & backup](#export-import--backup)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration reference](#configuration-reference)
- [In-app configuration](#in-app-configuration)
- [Database & developer commands](#database--developer-commands)
- [Security model & caveats](#security-model--caveats)
- [Project layout](#project-layout)
- [Intentional limitations](#intentional-limitations)
- [Roadmap](#roadmap)
- [License](#license)

---

## Highlights

- **Bring your own model.** Point Mimir at one or many endpoints — local
  llama.cpp servers and hosted OpenAI-compatible APIs side by side. The model
  picker groups by endpoint; hosted keys are forwarded server-side so they never
  touch the browser.
- **A real chat client.** Streamed Markdown with syntax-highlighted, copyable,
  collapsible code blocks; a collapsible reasoning panel with a live "thinking"
  timer; per-message generation stats (tok/s, context usage, wall time); resend,
  copy, and delete actions; clean stop-mid-stream handling. Attach text files or
  PDFs (drag-and-drop or the paperclip) and their contents are injected straight
  into the model's context.
- **Long-term memory.** The model remembers durable facts about you across
  every conversation — and you can see, edit, disable, or delete every memory it
  saves, because *you* own the write, not the model.
- **Skills.** Reusable `SKILL.md` instruction packs the model loads on demand
  via progressive disclosure — a cheap one-line menu in the prompt, the full
  procedure pulled in only when a task matches.
- **Transparent system prompts.** Toggleable presets (including a dynamic
  "today's date" prompt), your own custom prompts, and a full-prompt view that
  shows every active segment *and* every tool advertised to the model. What you
  preview is exactly what is sent.
- **Private web access.** Optional `web_search` and `web_fetch` tools backed by
  your own self-hosted SearXNG. The only thing that leaves the machine is the
  search query and the URL the model chooses to read — both visible in the inline
  tool chip.
- **Active context management.** Verbose tool outputs are distilled and long
  histories are summarized by brief, one-shot calls to the same model, so long
  sessions and agent runs stay within a bounded context window.
- **Agentic workspaces.** Give a model a sandboxed virtual filesystem and a
  real Docker container, and it will plan → write → **run** → observe → fix
  across many steps, keeping a live checklist you can edit mid-run. Includes a
  genuinely interactive terminal (a real TTY); a file tree with drag-and-drop
  file/zip upload *and* drag-to-move (drop a node onto a folder to file it); a
  file editor with live HTML/Markdown/SVG preview (and image preview for binary
  files); a per-workspace sandbox network toggle; and one-click "download as
  zip." Agents can optionally search and fetch the web mid-run.
- **Export, import & backup.** Export any conversation as readable Markdown or
  lossless JSON, or take a full account backup (chats, workspaces, image
  studios, memories, skills, prompts, endpoints) as a single JSON file. Import
  it back into any instance, and bulk-import collections of memories, skills, or
  system prompts. Imports are additive — they never overwrite what you have.
- **Multi-user & self-hosted.** Email + password accounts plus optional Google
  sign-in (Better Auth), every row scoped to its owner, a one-flag switch to
  lock down sign-ups. Everything persists to PostgreSQL, cached in Valkey.
- **One command to run it all.** `docker compose up --build` brings up the app,
  Postgres, Valkey, and SearXNG together, with the host Docker socket wired in so
  workspaces can execute code out of the box.

---

## What Mimir is

Most "chat with your local LLM" front-ends stop at a message box. Mimir is built
around the idea that a model is more useful when it has **durable context**
(memory, skills, standing instructions), **reach** (web search and fetch),
**transparency** (you can audit exactly what it sees and does), and **agency**
(a place to actually run the code it writes). It packages all of that behind a
single login so a household, a team, or just you-on-three-devices can share one
instance.

Three principles shape it:

1. **Local-first and yours.** Your data lives in your Postgres and is cached in
   your Valkey. Prompts go only to the endpoints you configure. The only
   outbound calls are the ones you can see — a web search to your SearXNG, a URL
   the model fetches, or a request to a hosted endpoint you added yourself.
2. **Transparent by construction.** The system prompt is assembled from labeled
   segments and previewable verbatim. Every tool call renders as an inline chip
   at the moment it happened, expandable to its result. Context-management passes
   announce themselves. Nothing the model does to your data is hidden or
   irreversible.
3. **The model emits intent; Mimir owns the mutation.** Saving a memory, writing
   a file, running a command — the model only *asks*. A handler performs the
   action through a small, audited API, and the store stays the single owner of
   the data. That capability boundary is what makes the "sandbox" a sandbox.

---

## The interface

Mimir is a single, client-rendered page (`components/AppShell.tsx`) that sits
behind a sign-in gate (`components/AuthGate.tsx`).

- **Left sidebar.** New conversation, New workspace, Search (⌘K), then your
  **Library** (one window listing chats *and* workspaces together) and **Tools**
  (Memories, Skills, Tools, System Prompt, Usage & cost), with a profile footer
  that opens Settings.
- **Tabs.** The top strip is reserved for the things you actively work in — chats
  and workspaces. Drag to reorder, click the active tab's title to rename it (it
  renames the underlying conversation/workspace too), and right-click for a
  context menu (rename, close, close others, close to the right, delete). A `+`
  at the end opens a small menu to start a new conversation or workspace. Closing
  a tab whose conversation or workspace was never touched (no messages, no
  files/runs) discards it, so a quick "new tab" you didn't use doesn't pile up in
  the Library.
- **The Library.** Chats and workspaces live in one window, each row badged by
  type. Organize them into **folders** and label them with **color-coded tags**
  (both fully user-defined), pin the important ones to the top, and filter by
  folder, tag, type, or a text search across titles *and* contents. A per-item
  menu handles open, rename, pin, tagging, moving between folders, and delete.
- **Floating windows.** Manager pages (Library, Memories, Skills, Tools, System
  Prompt, Usage & cost, Settings) open as draggable, resizable windows — one per
  kind, clamped to the viewport so they can't be lost off-screen, with positions
  and sizes that persist across refreshes (and across devices, since the layout
  is saved server-side).
- **Usage & cost.** A dedicated window totals token usage across every chat and
  agent run, grouped by model, and — for models you give a price (input/output
  per million tokens, in US dollars) — estimates spend.

### Responsive / mobile

Below the `md` breakpoint (768px) the sidebar collapses into an off-canvas drawer
(open via the hamburger, dismiss by tapping the backdrop or swiping left); manager
pages open as full-screen sheets instead of draggable windows; Settings stacks
into a single column; touch targets grow; keyboard-shortcut hints are hidden;
inputs render at 16px to avoid iOS focus-zoom; and the layout uses the dynamic
viewport height (`dvh`) with safe-area padding so the composer is never hidden
behind mobile browser chrome or a notch.

---

## Feature tour

### Endpoints & models

Configured under **Settings → Models & Endpoints**.

- **Any number of endpoints**, each with a friendly name and a base URL. They can
  be local llama.cpp servers (`http://192.168.1.50:8080`) or hosted
  OpenAI-compatible APIs. One-tap **presets** prefill the name and URL for
  llama.cpp, Groq, OpenAI, OpenRouter, Together, and Anthropic.
- **API keys for hosted providers** are sent as a bearer token, forwarded
  server-side through Mimir's proxy in a separate header, so a key never lands in
  a URL, the browser console, or a log. Local servers need no key.
- **Manual model lists.** Providers that don't expose `/v1/models` (e.g.
  Anthropic) can be given an explicit model list — one model ID per line — which
  Mimir uses instead of probing the endpoint.
- **Per-model visibility.** Toggle individual models on or off per endpoint;
  disabled ones vanish from every picker but stay one click away.
- **Defaults.** Pick a default model for new conversations and a separate default
  for new workspaces (or leave either on "first available").

Hosted APIs work because they and llama.cpp both speak the OpenAI `/v1/models`
and `/v1/chat/completions` shapes; the only difference is the `Authorization`
header, which Mimir adds when a key is set. llama.cpp-only extras (the `/props`
context size) degrade gracefully on providers that don't report them.

**Running llama.cpp with multiple models:**

```bash
llama-server --models-dir /path/to/ggufs --port 8080   # hot-swappable list
# or, a single model:
llama-server -m model.gguf --port 8080
```

Mimir reads `/v1/models` to populate the picker and streams completions from
`/v1/chat/completions`.

### Chat

- **Markdown (GFM)** rendering for assistant messages: bold, tables, lists,
  blockquotes, and syntax-highlighted code blocks with per-block copy buttons.
- **Smart autoscroll** that sticks to the bottom only while you're already there
  — scroll up during generation and it stops fighting you, with a "jump to
  latest" pill (which flags when a response is still streaming).
- **Collapsible long code blocks** (~320px with a fade and an Expand button) once
  generation finishes; they stay expanded while streaming so the control doesn't
  flicker as the code grows.
- **Per-message generation stats:** which model produced it (with its endpoint
  when more than one is configured), tok/s, output tokens, context usage vs. the
  server's `n_ctx` (from `/props`), and wall time. Server-reported numbers are
  preferred, with client-side estimates as a fallback.
- **Thinking.** Reasoning renders in a collapsible accent panel with a live
  timer while generating, then auto-collapses to a "Thought · 4.2s" summary you
  can reopen. Mimir understands both inline `<think>` tags and llama.cpp's
  separate `reasoning_content` field (the default `auto`/`deepseek` format),
  re-wrapping the latter as `<think>` so one parser handles both — no special
  server flags required.
- **Inline tool events.** Tool calls (memory saves, skill loads, web searches,
  context-compaction passes) render as chips at the exact point they occurred,
  expandable to the tool's result, so the timeline reflects the real order of
  thinking, tools, and prose. Expanding a `remember` chip offers a Delete-memory
  button so you can undo a save in place.
- **File attachments (context injection).** Attach text-like files (code,
  Markdown, CSV, JSON, plain text) or PDFs to a message — click the paperclip or
  drag-and-drop onto the composer. Text files are decoded in the browser; PDFs
  are sent to a small server route that extracts their text with `pdfjs`. The
  extracted content is wrapped in a labeled fence and prepended to your message
  on **every** request that includes it, so the file stays in context across
  turns and survives a reload (it's persisted on the message, not pasted once).
  Attachments show as compact chips on the composer and on the sent message;
  binary files that aren't text or PDF are rejected up front with a clear note.
  Per-file and per-message size caps keep one big file from flooding the window.
- **Message actions** on hover: copy and delete on every message; resend on user
  messages (truncates everything after and regenerates). Deletes ask for inline
  confirmation rather than nuking on a single misclick.
- **Clean interrupts.** Stopping a generation mid-stream keeps whatever streamed
  so far and tags the message with a "Generation interrupted" marker.

### Memories

Durable facts the model recalls across every conversation. Two paths reach the
model:

- **Read (injection).** Before each completion, enabled memories are grouped by
  category and prepended as a background-knowledge system message. The model just
  "knows" them.
- **Write (tool call).** Each request advertises a `remember` function tool with
  detailed guidance on *what* is worth keeping (durable, personal, reusable) and
  *how* to phrase it (a self-contained third-person statement, not a transcript).
  When the model judges a fact worth saving it calls the tool; Mimir stores the
  memory (tagged `auto`), feeds back a confirmation, and the save appears as an
  inline chip. The model never writes storage directly — every write is visible
  and reversible. Models without function-calling simply never call it, and only
  the injection path runs.

Memories are grouped into categories (`preference`, `fact`, `project`, `person`,
`environment`, `instruction`). Manage them in the **Memories** window: add, edit
(click the text), toggle on/off, delete.

### Skills

Reusable instruction packs (the `SKILL.md` format) the model loads on demand, via
**progressive disclosure** — the same pattern real skill systems use, because you
can't fit every skill's full text in context:

- **Discovery.** Each enabled skill's name + description is injected into the
  system prompt as a one-line menu. Cheap.
- **Activation.** When a task matches, the model calls `load_skill(name)` and
  receives that skill's full body back through the tool loop.
- **Execution boundary.** If a skill references scripts, `load_skill` notes them
  but the **chat** tool loop will not run them (it has no executor). A
  **workspace**, however, does — an agent (or you) can run those scripts for real
  in its Docker sandbox. Both the manager and the tool result mark the
  load-vs-run boundary clearly.

Manage them in the **Skills** window: paste a `SKILL.md` to import (YAML
frontmatter is parsed, or a heading/first-paragraph fallback; script references
are detected live), then edit name/description/body, toggle on/off, or delete.

### System prompts

The text sent ahead of every conversation is assembled in
`lib/systemPrompts.ts` from three sources, in order:

1. **Enabled system prompts** — presets first (in catalog order), then your
   custom prompts (in creation order).
2. **The memory prompt** — enabled memories as background knowledge.
3. **The skills prompt** — the enabled-skills discovery menu.

`buildSystemSegments` returns labeled segments, so the chat and the manager share
one source of truth — **what you preview is exactly what's sent.**

- **Presets** are a small catalog of toggleable prompts, and they can be
  *dynamic*. The **Current date & knowledge cutoff** preset regenerates on every
  send with today's real date and reminds the model its training cutoff is in the
  past — which stops it from treating its training-time "now" as the present. It
  ships enabled. The rest (concise responses, Markdown formatting, direct &
  honest, cite web sources, explain before big changes) are opt-in. Presets can
  be enabled/disabled but not edited or deleted.
- **Custom prompts** are your own standing instructions (name, description, body)
  — toggle, edit, delete, same flow as Skills.
- **Full prompt view.** "View full system prompt" shows every active segment with
  its source label — including the text generated from memories and skills — plus
  the list of tools advertised to the model as function schemas, with a copy
  button. Full transparency about what reaches the model.

Presets are seeded server-side per account and reconciled on load, so your
enable/disable choices and custom prompts survive upgrades, and new presets appear
over time.

> Enabled prompts apply **everywhere** — both chats and workspace agents. A few
> presets are worded for agent/coding work (e.g. "explain before big changes");
> leave those off unless you want them in chats too.

### Tools & the tool loop

A **tool** is a callable function the model can invoke during a response —
distinct from a skill, which teaches it *how* to approach a job.

`lib/tools.ts` drives the full OpenAI tool-use protocol within a single logical
response. `runToolLoop` streams a completion; if the model emitted tool calls, it
runs each handler, appends the assistant tool-call message and a `tool`-role
result message (with proper `tool_call_id` linkage), and loops — until the model
replies with prose and no calls, or a round cap (default 5) is hit. Per-message
stats (duration, output tokens, tok/s) are aggregated across **every** round, so
a response that makes several tool calls reports its total generation time, not
just the final request's.

Tools live in a registry: `{ name → { def, run } }`. `def` is the schema
advertised to the model; `run(args)` executes and returns a string fed back as
the result. **Adding a capability is one registry entry** — the loop is
tool-agnostic and never changes. The registry is assembled per response, so a
tool is simply omitted when its switch is off.

The **Tools** window is the master control. Each tool has an on/off switch that
decides whether it's advertised to the model at all:

- **`web_search`** and **`web_fetch`** — the two that can reach the network (see
  below). Each exposes its own parameters.
- **Built-ins (always local):** `remember` (saves to long-term Memory) and
  `load_skill` (pulls in a skill's full instructions). Toggleable, but they never
  leave the machine.
- **Context management** (tool-output pruning + recursive summarization) is
  configured here too — see [Context management](#context-management).

### Web tools (search & fetch)

Two tools give the model reach beyond its training data (`lib/webtools.ts`):

- **`web_search`** — the model emits a query; Mimir forwards it to a self-hosted
  [SearXNG](https://github.com/searxng/searxng) instance and hands back the ranked
  results (title, URL, snippet, and an optional published date). Supports an
  optional `time_range` (`day`/`week`/`month`/`year`) for fast-moving topics.
  Discovery only — snippets, not full pages.
- **`web_fetch`** — downloads a single URL and returns its readable text (a
  dependency-free extraction: scripts/styles stripped, entities decoded,
  whitespace collapsed, length capped), so the model can read a result — or a
  link you pasted — in full.

Both calls go out **server-side** through `/api/websearch` and `/api/webfetch`, so
the browser keeps talking only to Mimir (same shape as the llama proxy). The only
things that leave the machine are the search query (to your SearXNG) and any URL
the model chooses to fetch — and both are visible in the inline tool chip, so
every outbound call is auditable.

**Configuration (Tools window).** Web search exposes the SearXNG URL, result
count (1–10), safe-search level (off/moderate/strict), and a **throttle** —
a minimum interval between searches, enforced globally across all conversations
and agents, so a search engine is less likely to rate-limit or captcha-block you.
Web fetch exposes the maximum characters returned (500–50,000).

**Per-conversation switch.** A "Web search" toggle sits above the chat input.
Once web tools are enabled globally it controls whether they're offered in *this*
conversation (defaults on; flip it off to keep one chat fully local). The state
lives on the conversation (`webToolsEnabled`); when web tools are disabled
globally the button is muted and opens the Tools window.

> **Defaults.** For privacy, the web tools ship **disabled** in-app — enabling
> them in the Tools window is the one explicit choice that lets a query leave the
> machine. The shipped configuration already points `SEARXNG_URL` at the bundled
> SearXNG, so turning them on is a single toggle with nothing else to set up.

### Context management

`lib/contextManager.ts` keeps a long-running model loop from drowning in its own
history. Two independent strategies, both built on a **transient instance** — a
brief, single-shot call to the same model that does one job and disappears. Both
conversations and workspace agents honor these.

1. **Tool-output pruning.** Verbose tool results (a fetched web page, a long
   command log) are handed to a transient instance that distills them down to
   what's relevant — steered by the call itself (the query, the URL, the command)
   — before the result ever enters the main context. Concrete, load-bearing
   detail (figures, errors, **URLs and file paths**) is preserved; boilerplate is
   dropped. The chip is labeled so it's obvious the raw output was condensed, and
   shows the character count saved. *Defaults on*, for `web_search`, `web_fetch`,
   and `run_command`, above a 4,000-character threshold. `read_file` is
   deliberately excluded — an agent needs a file's exact contents to edit it.
2. **Recursive summarization.** When the working history grows past a token
   threshold (estimated, ~4 chars/token; ~24,000 by default), the oldest messages
   are compressed into a single "memory" message and the most recent ones kept
   verbatim. The cut never strands a `tool` message whose assistant tool-call was
   summarized away. A chip announces the pass and the token count it saved.
   *Defaults on*, with a generous threshold so it only fires on genuinely long
   sessions. Persisted history is untouched — this only shapes what the model
   sees on a given call.

All thresholds are tunable in the Tools window, and either strategy can be turned
off entirely (in which case the machinery is skipped).

### Workspaces (agentic sandboxes)

A workspace gives a model a place to operate as an autonomous **agent**: a private
virtual filesystem it reads and writes through tools, a real Linux container it
can run code in, a loop that runs **plan → act → observe** across many turns, and
a run log so every action is auditable. The "sandbox" is **capability-based** —
the agent's only actuators are the tools it's handed, and the filesystem tool is
scoped to one workspace's tree, so the agent can never touch the host through it.

**Virtual filesystem.** `lib/workspace/fs.ts` is a pure, backend-agnostic module
of immutable operations over a flat `WorkspaceFile[]` (normalize paths,
read/write/edit/move/delete, render a tree). Keeping it pure means the same logic
powers the agent's tools, the file explorer, and the system-prompt manifest — and
could later sit on a different backend by reimplementing only the tool handlers.

**Filesystem tools** (`lib/workspace/filesystemTool.ts`) — seven of them:
`list_files`, `read_file` (with optional line ranges and a character cap),
`write_file`, `edit_file` (unique-string replace, str-replace style), `make_dir`,
`delete_path`, and `move_path`. Built the same way as the chat's `remember`: the
model emits intent, a handler mutates state through a small injected API, and the
store stays the owner of the data.

**The agent loop** (`lib/workspace/agent.ts`) drives a multi-step run. Each model
completion is one **step** (the system prompt is rebuilt every step with a live
filesystem manifest and the current plan); the loop runs any tool calls, feeds the
results back, and continues until the model calls `task_complete`, or it hits the
step cap, the output-token budget, an abort, a stall (talking without acting), or
an error. When a shell is available the agent is told to *verify* its work — write
a script, run it, read the error, fix, re-run — rather than declaring success
blind.

**Resumable agents.** A run is not one-shot: when it stops (or finishes) you can
**re-prompt** it, and a fresh turn replays the prior turns as history and
continues the *same* agent in the *same* context. The history is reconstructed
from the run's persisted steps, so resume survives a page reload. Each finished
turn's summary stays pinned inline where it ended.

**Personas.** Every run uses an agentic persona that sets its posture (chosen per
workspace): **Methodical** (the careful-engineer default), **Deliberate planner**
(leads with structure, best for big jobs), **Lean & fast** (terse, momentum-first,
still verifies), and **Investigate first** (front-loads reading and mapping
existing files). The final system prompt is composed from the persona, capability
blocks for whatever tools are active, the workspace's standing instructions, any
enabled global system prompts, and the live filesystem block.

**The visible plan.** The agent builds and maintains a checklist through planning
tools (`set_plan`, `add_plan_item`, `update_plan_item`, `set_plan_item_status`),
keeping exactly one item active at a time. The plan renders live in the right
sidebar — and **you can edit it while the agent runs** (tick, reword, add,
reorder, delete); the agent is told to re-read the plan when it changes, so you can
steer a run by editing its plan underneath it.

**Code execution (real).** `run_command` runs shell commands and scripts inside a
per-workspace **Docker container** (working directory `/workspace`). It works like
the web tools: the browser POSTs the command plus the current virtual filesystem to
`/api/workspaces/:id/exec`; the server-side `SandboxManager`
(`lib/server/sandbox.ts`) writes the changed files into the container, runs the
command under strict limits, and returns its stdout/stderr plus the post-run
filesystem — so anything the command creates appears straight back in the editor.
The virtual filesystem stays the source of truth; only changed files are pushed in,
heavy/generated directories (`node_modules`, `.git`, `__pycache__`, `dist`, …) are
never synced back, and oversized files (beyond the sync caps) are skipped. **Binary
files round-trip** — images, archives, and compiled output are kept as base64, so a
command that produces a PNG or a zip shows up in the explorer and downloads
byte-for-byte. **One container is kept alive per workspace** so state persists across
commands within a session (installed packages, build artifacts), with an idle reaper
stopping unused ones. Because each `exec` is a fresh process, the working directory is
tracked and re-applied around every command, so `cd` actually persists. Web access is
**opt-in per agent**: when the web tools are enabled (Tools window), an agent can
`web_search` and `web_fetch` mid-run to look things up while it works.

**The workbench.** A file explorer (create, edit, download, delete, zip a
subtree, **upload files/folders or drag-and-drop a `.zip`** that's expanded into
the tree, and **drag a node onto a folder — or onto empty space — to move it**);
a center pane that switches between the **Agent** transcript, an
interactive **Terminal**, and a **file editor**; an **Agents** view; and a goal
composer. The transcript renders thinking, prose, and tool chips per step just
like the chat (a **Log** view shows the same run as a compact action list). The
**terminal** is a genuinely interactive shell into the same container the agent
uses — it's a real TTY, so prompts, REPLs (`python`, `node`), colored output,
progress bars, and Ctrl-C all work; type `ls`, `python main.py`, `pip install …`,
and watch new files appear in the explorer. Output streams over Server-Sent
Events and keystrokes are sent as you type; a small built-in ANSI model renders
it (no xterm dependency). The **file editor** includes a live preview for HTML,
Markdown, and SVG files (for HTML it inlines local stylesheets, scripts, and
image assets so a multi-file page renders with no server) and shows an image
preview or a size summary for binary files. Runs stream live into the store, so
the explorer, editor, and transcript all update as the agent works; files and
runs persist to Postgres (`workspace_files`, `workspace_runs`).

**Download.** Export the whole workspace — or any subtree from the explorer's
context menu — as a `.zip`, built entirely in the browser (no dependency; uses the
platform `CompressionStream` when available).

**Hardening.** Containers run with all Linux capabilities dropped,
`no-new-privileges`, and CPU / memory / pid / wall-clock limits, plus caps on what
gets synced back into the editor. The bundled compose gives executed code internet
access by default (`SANDBOX_NETWORK=bridge`, so `pip`/`npm`/`cargo` work); set
`SANDBOX_NETWORK=none` to cut it off for stricter isolation. Each workspace can
also **toggle its sandbox network** in its agent settings. The toolchain image is
always the server-configured one (`SANDBOX_IMAGE`) — it is **not** selectable
per workspace, since an arbitrary user-chosen image is both a footgun and a
larger attack surface. This runs **model-written code on your host**, so the
isolation is best-effort, not a guarantee — see the
[security model](#security-model--caveats) and the `SANDBOX_*` knobs in the
[configuration reference](#configuration-reference).

> **Requirements.** Code execution needs a reachable Docker daemon on the machine
> running Mimir. The easiest path is **Option A** below (run Mimir itself in
> Docker), where the app container is handed the host's socket automatically. With
> no daemon the workspace still works as a virtual filesystem — the terminal and
> `run_command` just report the sandbox as unavailable, and the agent is told to
> fall back to writing files and explaining how to run them.

### Export, import & backup

Your data is yours, and it moves. All of this is client-side serialization to a
downloaded file (and parsing on the way back); there are no new endpoints.

- **Per-conversation export** lives in the **Library** (right-click a row, or the
  ⋯ menu). Conversations export as **Markdown** (a clean, readable transcript —
  thinking becomes labeled blockquotes, tool calls become inline notes) or
  **JSON** (a lossless envelope that round-trips exactly, attachments included).
  Workspaces and image studios export as JSON.
- **Conversation import** is the Library's **Import** button: pick one or more
  `.json` / `.md` files. It accepts our conversation JSON, our Markdown format, a
  bare workspace/studio export, or a full backup (whose library items are all
  pulled in). Imported chats open immediately.
- **Full account backup** lives in **Settings → Data**: one JSON file containing
  every conversation, workspace, image studio, memory, skill, custom prompt, plus
  your endpoints and settings. Restore it into any instance from the same screen.
- **Bulk collection import** (also Settings → Data) brings in arrays of
  **memories**, **skills**, or **system prompts** — from a collection exported
  there, a slice of a backup, or a plain JSON array.
- **Additive by design.** Every import adds *new* items with fresh ids, so
  re-importing duplicates rather than clobbers and an import can never overwrite
  or delete what you already have. Endpoints are merged in by URL (existing ones
  win); folder/tag organization is intentionally not carried across accounts (see
  *Intentional limitations*). A backup file contains your endpoint API keys in
  plain text — the UI says so — so store it somewhere safe.

---

## Architecture

- **Next.js App Router + TypeScript + Tailwind.** One client-rendered shell
  (`components/AppShell.tsx`) behind `AuthGate`.
- **State** lives in a Zustand store (`lib/store.ts`) acting as an in-memory
  optimistic cache. On sign-in the store hydrates from the server
  (`GET /api/state`); every mutation updates local state immediately, then is
  debounced and coalesced per key and pushed to **PostgreSQL** through **Drizzle**
  in the background (`lib/sync.ts` → `/api/*` route handlers →
  `lib/server/state.ts`). Streaming patches (tokens into a message, agent steps,
  window drags) collapse into a single save once things settle. Deletes are
  immediate and cancel any pending save so a queued upsert can't resurrect a
  just-deleted row.
- **Valkey** (Redis protocol) caches each user's full snapshot so repeat loads
  skip the database, and serves as Better Auth's secondary storage for hot session
  lookups. Cache failures degrade to a miss and fall back to Postgres.
- **Accounts & auth** use **Better Auth** (`lib/auth.ts`) with email + password
  and optional OAuth (Google, registered only when its env vars are set), the
  Drizzle Postgres adapter for the user/session/account/verification tables, and
  Valkey for session storage. The whole workbench sits behind `AuthGate`; all app
  data is scoped to the signed-in user via a `user_id` foreign key. Sessions last
  30 days (refreshed daily) with a short cookie cache; set `ALLOW_SIGNUP=false` to
  run a closed instance.
- **Schema** is defined once in `lib/db/schema.ts`: the four Better Auth tables
  plus `conversations`, `messages` (relational, ordered by `seq`), `workspaces`,
  `workspace_files`, `workspace_runs`, `memories`, `skills`, `system_prompts`,
  `settings`, and `ui_state`. Flexible sub-structures (message meta, tool events,
  message attachments, endpoint lists, tool settings, run steps, the resumable
  agent-run extras in `workspace_runs.meta`, UI layout) are stored as `jsonb` so
  the TypeScript types in `lib/types.ts` stay the source of truth. Migrations live
  in `drizzle/` and are managed with Drizzle Kit.
- **Model access** goes through a catch-all proxy (`app/api/llama/[...path]/route.ts`).
  The browser only ever talks to Mimir; the Next server forwards to whatever
  endpoint you set (stripping a duplicate `/v1` for hosted providers and adding the
  bearer token), so CORS never comes up and the endpoint URL can be a LAN address.
- **Streaming** is plain SSE parsing in `lib/llama.ts` with abort support (the stop
  button actually cancels the request), unified handling of inline `<think>` tags
  and the separate `reasoning_content` field, and incremental assembly of streamed
  tool-call fragments.
- **Server boundary.** Route handlers authenticate via `lib/server/session.ts`
  (`requireUser`), enforce ownership (e.g. a user can only `exec` against their own
  workspace), and read/write through `lib/server/state.ts`. The execution sandbox
  (`lib/server/sandbox.ts`) is a process-wide singleton talking to Docker via
  `dockerode`.

---

## Getting started

Mimir persists everything to **PostgreSQL** (with **Valkey** caching) and puts the
workbench behind **user accounts**. There are two ways to run it; the first is the
simplest and is the one to use if you want Workspaces to **execute code**.

### Prerequisites

- **Docker** (with Compose) — required for Option A, and for the data stores in
  Option B.
- **Node.js 20+** — only for Option B (running the app directly).
- An OpenAI-compatible model endpoint — a local `llama.cpp` server, or a hosted API
  key — which you add from inside the app after first launch.

### Option A — everything in Docker (recommended)

This runs the app, Postgres, Valkey, and SearXNG together. The app container is
handed the host's Docker socket, so Workspaces can run shell commands and scripts
with no extra setup.

```bash
# 1. Configure environment. docker compose reads ".env".
cp .env.example .env
#   then set BETTER_AUTH_SECRET to a long random string:
#   openssl rand -base64 32

# 2. Build and start the whole stack. Database migrations run automatically.
docker compose up --build
```

Open <http://localhost:3000>, create an account, and add a model endpoint under
**Settings → Models & Endpoints**. To confirm execution works, open a workspace,
switch to the **Terminal** tab, and run `python -c "print(6*7)"` — it should print
`42`.

Notes for this mode:

- **Docker socket.** On Linux and most Docker Desktop setups the default
  `/var/run/docker.sock` is mounted automatically. If your socket lives elsewhere
  (some macOS / Colima / rootless installs), set `DOCKER_SOCK` to its path
  (`docker context ls` shows the active context's endpoint). On Docker Desktop you
  can instead enable *Settings → Advanced → "Allow the default Docker socket to be
  used."*
- **SearXNG (web search)** works out of the box — compose sets `SEARXNG_URL` to the
  internal service, so there's nothing to configure. (Flip the web-search toggle on
  in the Tools window to actually offer it to the model.)
- **Sandbox toolchain image.** Compose builds a `sandbox-image` service into
  `mimir-sandbox:latest` (gcc/g++, Python, Node, Go, Rust, git, jq, ripgrep, …)
  and waits for it before starting the app, so workspaces have a rich toolchain
  by default. The first build is a larger pull; rebuild it with
  `docker compose build sandbox-image`. Every workspace uses this image; a
  workspace can toggle its sandbox network in its agent settings.
- **A llama.cpp server on the host** is reachable as
  `http://host.docker.internal:<port>` from Settings (compose maps that name to your
  host). A LAN address like `http://192.168.1.50:8080` works as-is.
- **Hot reload.** Source is bind-mounted, so code changes reload automatically.
  After changing dependencies, rebuild with `docker compose up --build`; if a new
  package still isn't picked up, drop the cached modules volume with
  `docker compose down -v` first.

### Option B — app on your host, data stores in Docker

Run the Node app directly (handy for development) and only containerize the data
stores.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (Next.js reads ".env.local" / ".env")
cp .env.example .env.local
#   set BETTER_AUTH_SECRET (openssl rand -base64 32)

# 3. Start Postgres + Valkey (and SearXNG if you want web search)
docker compose up -d postgres valkey searxng

# 4. Create the database schema
npm run db:migrate

# 5. Run the app
npm run dev
```

In this mode the app reaches the data stores on `localhost` (compose publishes
their ports). For Workspaces to execute code, your user must be able to reach the
Docker daemon: `docker ps` should work without sudo (on Linux, add your user to the
`docker` group), and if the socket isn't at `/var/run/docker.sock`, set `DOCKER_HOST`
to its path. With no daemon, the workspace still works as a virtual filesystem.

---

## Configuration reference

All variables are optional except `BETTER_AUTH_SECRET`. The bundled
`.env.example` ships with sensible, fully-enabled defaults; copy it and adjust.

### Core

| Variable             | Purpose                                            | Default                                          |
| -------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `DATABASE_URL`       | PostgreSQL connection string (Drizzle + Better Auth) | `postgres://mimir:mimir@localhost:5432/mimir`  |
| `VALKEY_URL`         | Valkey (Redis-protocol) connection string          | `redis://localhost:6379`                         |

### Authentication

| Variable             | Purpose                                                                    | Default                 |
| -------------------- | -------------------------------------------------------------------------- | ----------------------- |
| `BETTER_AUTH_SECRET` | Signing secret for sessions. If unset, the entrypoint generates a strong random one and persists it to `.auth-secret` so sessions stay stable; set it explicitly (`openssl rand -base64 32`) to control it yourself. | _auto-generated_        |
| `BETTER_AUTH_URL`    | Public base URL of the app (cookies, callbacks)                            | `http://localhost:3000` |
| `ALLOW_SIGNUP`       | `false` disables new registrations (existing accounts can still sign in)   | `true`                  |
| `GOOGLE_CLIENT_ID`     | OAuth 2.0 client ID for Google sign-in. Both Google vars must be set to enable the "Continue with Google" button. | _unset (disabled)_ |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret for Google sign-in.                              | _unset (disabled)_ |

> **Google sign-in (optional).** Create an OAuth 2.0 Client ID of type *Web
> application* in the Google Cloud console (APIs & Services → Credentials), add
> the redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google` (e.g.
> `http://localhost:3000/api/auth/callback/google`), and set the two variables
> above. The sign-in screen probes `/api/auth-config` and only shows the Google
> button when both are present, so a default install stays email/password-only.
> Note that `ALLOW_SIGNUP` governs email/password registration only — a
> configured OAuth provider can still create an account on first sign-in, so on a
> locked-down instance also restrict access at the provider (the consent screen's
> allowed users).

### Web search (SearXNG)

| Variable      | Purpose                                                                                                              | Default                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `SEARXNG_URL` | Server-side SearXNG base URL. Takes precedence over the Tools-window URL, so search works with no per-user config. | `http://localhost:8888`|

> In compose this is **overridden** to the internal service (`http://searxng:8080`),
> so it works in both Docker and host modes. Point it at an external SearXNG to use
> one. The SearXNG instance must have the `json` format enabled — the bundled
> `searxng/config/settings.yml` already does.

### Workspace execution sandbox (Docker)

Workspaces run shell commands inside a per-workspace Docker container. **This
executes model-written code on your host** — see the [security model](#security-model--caveats).
Requires a reachable Docker daemon.

| Variable                | Purpose                                                                                  | Default            |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `SANDBOX_ENABLED`       | Master switch for code execution (`false` turns it off; the feature is on otherwise)     | `true`             |
| `SANDBOX_IMAGE`         | Image commands run in. The bundled compose builds and uses `mimir-sandbox:latest` (gcc/g++, Python, Node, Go, Rust, git, …); the code default below is the minimal fallback. Used by every workspace (not per-workspace). | `python:3.12-slim` |
| `SANDBOX_NETWORK`       | `bridge` = internet for code (so `pip`/`npm`/`cargo` work). `none` = no network, for stricter isolation. Overridable per workspace. | `bridge`           |
| `SANDBOX_MEMORY_MB`     | Memory cap per container                                                                 | `512`              |
| `SANDBOX_CPUS`          | CPU cap (cores; fractional allowed)                                                      | `1`                |
| `SANDBOX_PIDS`          | Max processes                                                                            | `256`              |
| `SANDBOX_TIMEOUT_MS`    | Per-command wall-clock limit (one-shot `run_command`; the interactive terminal isn't time-limited) | `30000`            |
| `SANDBOX_IDLE_MS`       | Stop a container (and idle terminals) after this much idle time                          | `600000`           |
| `SANDBOX_READONLY_ROOT` | `true` hardens further but breaks system `pip`                                           | `false`            |
| `SANDBOX_USER`          | Run as a specific `uid:gid` (default: the image's user)                                  | _image default_    |
| `SANDBOX_MAX_FILE_KB`   | Skip syncing files larger than this back into the editor                                 | `256`              |
| `SANDBOX_MAX_FILES`     | Cap on files synced back                                                                 | `2000`             |
| `SANDBOX_MAX_TOTAL_MB`  | Cap on total bytes synced back                                                           | `12`               |
| `SANDBOX_MAX_OUTPUT_KB` | Cap on captured stdout/stderr per command                                                | `256`              |

### Docker socket / daemon

| Variable      | Purpose                                                                                          | Default                 |
| ------------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `DOCKER_SOCK` | **Compose only.** Host socket handed to the Mimir container. Set for macOS/Colima/rootless.      | `/var/run/docker.sock`  |
| `DOCKER_HOST` | **Host mode only.** Read by `dockerode` if your daemon socket isn't at the default path.         | _default socket_        |

---

## In-app configuration

Beyond environment variables, most behavior is configured in the UI and saved to
your account:

- **Settings → Models & Endpoints** — endpoints, API keys, manual model lists,
  per-model visibility, and default models (covered [above](#endpoints--models)).
- **Settings → System** — notes on reasoning (how thinking is surfaced; try
  `--reasoning-budget -1` on llama.cpp if you never see it) and privacy.
- **Settings → Account** — your sign-in identity, display name, and sign-out.
- **Tools window** — master on/off for every tool, web-search/fetch parameters, and
  context management (pruning + summarization). See
  [Tools](#tools--the-tool-loop) and [Context management](#context-management).
- **Agent settings (per workspace)** — persona, max steps, output-token budget,
  sandbox network, and standing instructions, set from the popover in the
  workspace header.

---

## Database & developer commands

```bash
npm run dev          # run the Next.js dev server
npm run build        # production build
npm run start        # run the production build
npm run lint         # Next.js lint

npm run db:generate  # regenerate SQL migrations after editing lib/db/schema.ts
npm run db:migrate   # apply pending migrations
npm run db:push      # push schema directly (dev shortcut, skips migration files)
npm run db:studio    # browse data in Drizzle Studio

npm run auth:generate # regenerate Better Auth schema from lib/auth.ts
```

In Option A, migrations run automatically on container start
(`docker-entrypoint.sh`).

---

## Security model & caveats

- **The sandbox runs untrusted, model-written code on your host.** Isolation is
  hardened (no network by default, all capabilities dropped, `no-new-privileges`,
  CPU/memory/pid/wall-clock limits, optional read-only root and non-root user) but
  **best-effort, not a guarantee.** Treat a workspace container as a place where
  arbitrary code may run. Enabling `SANDBOX_NETWORK=bridge` (needed for
  `pip`/`npm`) gives that code outbound network access — convenient, but a larger
  attack surface. Run Mimir on a machine where that trade-off is acceptable, and
  prefer `none` if you don't need package installs.
- **`BETTER_AUTH_SECRET` is the key to every session.** Generate a unique random
  value (`openssl rand -base64 32`) and never reuse the example. **Do not commit a
  real `.env`:** the example file uses an obvious placeholder on purpose. Note that
  `.gitignore` currently ignores `.env*.local` but **not** `.env`, so keep secrets
  in `.env.local` for host mode, and be careful with the `.env` that compose
  requires (see the roadmap for tightening this).
- **Hosted API keys** are stored in your Postgres settings row (scoped to your
  account) and forwarded server-side; they never reach the browser. They are still
  plaintext at rest in your database — protect your database accordingly.
- **Single- vs multi-tenant.** Sign-ups are open by default so you can create the
  first account; set `ALLOW_SIGNUP=false` afterward to lock the instance down.
  Every row is scoped by `user_id`, but all users on one instance share the same
  Docker daemon and SearXNG.
- **Where your data lives.** Conversations, memories, skills, system prompts,
  settings, workspaces, and UI layout are in **your PostgreSQL**, cached in **your
  Valkey**. Prompts go only to the endpoints you configure; the only other
  outbound traffic is web search/fetch (to your SearXNG and URLs you can see in the
  tool chips).

---

## Project layout

```
app/
  api/                 Route handlers (llama proxy, state, auth, auth-config,
                       websearch, webfetch, extract (PDF text), workspaces/exec,
                       settings, conversations, …)
  layout.tsx,page.tsx  Root layout and the single app page
components/
  AppShell.tsx         The client-rendered workbench shell
  AuthGate.tsx         Sign-in gate wrapping the app (email/password + Google)
  TabBar, Sidebar,     Chrome: tabs, sidebar, floating windows, search overlay
  FloatingWindow, …
  Markdown.tsx         GFM rendering + syntax highlighting
  views/               Manager pages (Chat, Library, Usage, Memories, Skills,
                       Settings, SystemPrompt, Tools) …
  views/workspace/     …and the workspace workbench (FileExplorer, FileEditor,
                       Terminal, AgentPanel, PlanView, AgentSettings, …)
lib/
  store.ts             Zustand optimistic store (the client's source of truth)
  store-slices/        Per-domain store slices composed into store.ts:
                       organizationSlice (folders, tags, membership, pricing),
                       imageStudioSlice, transferSlice (import/restore), and
                       workspaceRunSlice (agent-run streaming mutations)
  sync.ts              Debounced background persistence to /api/*
  types.ts             The data model (source of truth for the jsonb shapes)
  defaults.ts          Pure defaults + seed helpers (shared client/server)
  llama.ts             Streaming chat client + SSE/reasoning parsing
  models.ts            Endpoint/model resolution and pickers
  tools.ts             The tool registry + chat tool loop (+ shared tool helpers)
  attachments.ts       File→text extraction + chat context injection (text + PDF)
  transfer.ts          Export/import serialization (Markdown + JSON, backups)
  clientFiles.ts       Browser download + file-picker helpers
  memory.ts            remember tool + memory injection prompt
  skills.ts            SKILL.md parser + load_skill tool + discovery prompt
  systemPrompts.ts     System-prompt presets + segment assembly
  contextManager.ts    Tool-output pruning + recursive summarization
  webtools.ts          web_search / web_fetch tools (+ global search throttle)
  auth.ts, cache.ts    Better Auth config (+ social providers); Valkey client
  db/                  Drizzle schema + client
  server/              Server-only: session/auth, state read/write, sandbox
  workspace/           Pure FS, fs/exec/plan tools, the agent loop, the runner
                       hook, zip download, and HTML preview assembly
drizzle/               SQL migrations + meta (managed by Drizzle Kit)
searxng/config/        Bundled SearXNG settings (json format enabled)
Dockerfile, docker-compose.yml, docker-entrypoint.sh
```

---

## Intentional limitations

These are known boundaries, not bugs. Several are tracked as roadmap items in
`TODO.md`.

- **Generation runs in the browser.** Closing the tab stops an in-flight chat
  response or agent run — there's no server-side run executor yet.
- **The interactive terminal is a pragmatic emulator, not full xterm.** It's a
  real TTY (prompts, REPLs, colors, Ctrl-C, streaming all work), rendered by a
  lightweight built-in ANSI model. Elaborate full-screen TUIs (vim, htop) that
  lean on the alternate screen and complex cursor addressing degrade gracefully
  rather than render perfectly.
- **Skill scripts don't auto-run in chat.** `load_skill` surfaces a skill's
  scripts but the chat tool loop won't execute them — you can run them yourself in
  a workspace, which has a real execution sandbox.
- **Chat attachments are text-only context.** Text-like files and PDFs are
  injected as extracted text; there's no image/multimodal input yet, and binary
  formats that aren't text or PDF (images, archives, office docs) are rejected at
  attach time. Scanned/image-only PDFs yield no text (no OCR).
- **Imports are additive, not a faithful clone.** Importing a backup adds all
  items as new rows but does **not** recreate folders, tags, or item membership
  across accounts (those references are stripped), and it merges rather than
  replaces settings. A true "mirror this account onto a fresh instance" restore
  (preserving organization and remapping ids) is tracked in `TODO.md`.

---

## Roadmap

Planned features, fixes, and refactors are tracked in **[`TODO.md`](TODO.md)** —
including server-side run execution (so generation survives a tab close),
per-conversation and per-request generation parameters, image/multimodal
attachment input, and a faithful account clone on import. (Several earlier
limitations — a real interactive terminal, binary files in the workspace, web
access for agents, richer sandbox toolchains, uploading existing projects, Google
sign-in, file attachments, and export/import — are now implemented.)

---

## License

No license file is currently included in this repository. Until one is added, all
rights are reserved by the author; add a `LICENSE` before distributing or
accepting outside contributions.
