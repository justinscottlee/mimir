# Mimir

A self-hosted AI workbench for local llama.cpp endpoints. Named for the bronze
automaton Hephaestus forged to guard Crete — the first machine in Greek myth
that ran on its own.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000, hit the gear in the sidebar footer, and add a
llama.cpp endpoint under **Settings → Models & Endpoints** (e.g.
`http://192.168.1.50:8080`). Each endpoint card shows how many models it sees,
so you get immediate confirmation Mimir can reach it.

### Multiple endpoints and model visibility

Settings is split into sections (Models & Endpoints, System, Account). Under
Models & Endpoints you can:

- Add any number of endpoints, each with a friendly name and URL. Endpoints can
  be local llama.cpp servers or hosted OpenAI-compatible APIs (Groq, OpenAI,
  OpenRouter, Together, …). One-tap presets prefill the name and URL.
- Give hosted endpoints an API key — sent as a bearer token, forwarded
  server-side through Mimir's proxy so it never sits in a URL or the browser
  console. Local llama.cpp servers need no key. Keys persist in localStorage
  with the rest of settings.
- Enable or disable individual models per endpoint — disabled ones disappear
  from every picker but stay one toggle away.
- Pick a default model for new conversations and a separate default for new
  workspaces (or leave either on "first available").

Hosted APIs work because both they and llama.cpp speak the OpenAI `/v1/models`
and `/v1/chat/completions` shapes; the only difference is the `Authorization`
header, which Mimir adds when a key is set. llama.cpp-only extras (the `/props`
context size) degrade gracefully to "no context size" on providers that lack
them.

### Running llama.cpp with multiple models

llama-server can hot-swap models when launched with a model list:

```bash
llama-server --models-dir /path/to/ggufs --port 8080
# or, single model:
llama-server -m model.gguf --port 8080
```

Mimir reads `/v1/models` to populate the model picker and streams completions
from `/v1/chat/completions`.

## How it's wired

- **Next.js App Router + TypeScript + Tailwind.** One page, client-rendered
  shell (`components/AppShell.tsx`).
- **State** lives in a Zustand store (`lib/store.ts`) persisted to
  localStorage — conversations, workspaces, open tabs, and settings all
  survive a refresh without a database. Swap the persistence layer for SQLite
  later without touching components.
- **llama.cpp access** goes through a catch-all proxy route
  (`app/api/llama/[...path]/route.ts`). The browser only ever talks to Mimir;
  the Next server forwards to whatever endpoint you set, so CORS never comes
  up and the endpoint URL can be a LAN address.
- **Streaming** is plain SSE parsing in `lib/llama.ts` with abort support
  (the stop button actually cancels the request).

## Layout

- Left sidebar: New conversation, New workspace, Search (⌘K), Conversations,
  Workspaces, Memories, Skills, Tools, System Prompt, and a profile footer with settings.
- Main area: tab bar on top. Tabs are reserved for chats and workspaces —
  drag to reorder, click the title of the active tab to rename it (renames
  the underlying conversation/workspace too). A "+" button at the right end of
  the strip opens a small menu to start a New conversation or New workspace,
  each of which opens as a new tab.
- Manager pages (Conversations, Workspaces, Memories, Skills, Tools, System Prompt,
  Settings) open as draggable floating windows: title top-left, close button
  top-right, one window per kind. Positions persist across refreshes. Each
  window is resizable from the bottom-right corner, with a per-kind default,
  minimum, and maximum size; the chosen size persists too.
- The Conversations window has a search bar (matching titles and message
  content, same as the global ⌘K search) and a Select mode for multi-select —
  tick several conversations and delete them all behind a single confirmation.

### Responsive / mobile

The interface adapts below the `md` breakpoint (768px):

- The left sidebar collapses into an off-canvas drawer, opened by a hamburger
  button at the left of the tab bar and dismissed by tapping the backdrop, the
  close button, or any action inside it.
- Manager pages (Conversations, Settings, …) open as full-screen sheets
  instead of draggable/resizable windows — only the focused one shows, and it's
  closed with the header's ✕. Dragging and resizing are desktop-only.
- Settings switches from a two-column layout to a stacked one with a horizontal
  section selector.
- The chat header, message column, and composer use tighter gutters; tab close
  buttons are always visible (no hover on touch); inputs render at 16px to
  avoid iOS focus-zoom; and the app uses the dynamic viewport height (`dvh`)
  with safe-area padding so the composer isn't hidden behind mobile browser
  chrome or a notch.

## Chat features

- Assistant messages render markdown (GFM): bold, tables, lists, blockquotes,
  syntax-highlighted code blocks with per-block copy buttons.
- Autoscroll sticks to the bottom only while you're already there; scroll up
  during generation and it stops fighting you. A "jump to latest" pill (which
  flags when a response is still generating) returns you to the bottom.
- Long code blocks collapse (~320px) with a fade and an Expand button once
  generation finishes; while streaming they stay fully expanded so the
  control doesn't flicker as the code grows.
- Generation stats under each assistant message: which model produced it
  (with its endpoint, when more than one is configured), tok/s, output tokens,
  context usage (vs. the server's n_ctx from `/props`), and wall time.
  Server-reported usage/timings are preferred; falls back to client-side
  estimates when the server doesn't report them.
- The model picker groups models by endpoint (via labelled option groups when
  you have more than one) and shows the active model's endpoint and context
  length alongside the dropdown.
- Stopping a generation mid-stream keeps whatever streamed so far and tags the
  message with a clear "Generation interrupted" marker at the end.
- Message actions on hover: copy and delete on every message; resend on user
  messages (truncates everything after and regenerates). Delete actions ask
  for confirmation inline — a "Delete? Can't be undone" prompt appears beside
  the button rather than nuking on a single misclick.
- **Thinking.** Reasoning renders in a collapsible accent panel showing how
  long the model thought. While generating it stays expanded with a spinner
  and a live-ticking timer, then auto-collapses to a "Thought · 4.2s" summary
  you can reopen. Mimir reads both inline `<think>` tags and llama.cpp's
  separate `reasoning_content` field (the default `auto`/`deepseek` reasoning
  format), re-wrapping the latter as `<think>` so one parser handles both —
  thinking shows up without special server flags.
- **Inline tool events.** Tool calls (memory saves, skill loads) render as
  chips in the chat at the point they occurred — expandable for the tool's
  result — so the timeline reflects the real order of thinking, tools, and
  prose. When a chip is a `remember` save, expanding it offers a Delete-memory
  button so you can undo the save in place without opening the Memories window.

## Memories

Durable facts the model recalls across conversations. Two paths reach the
model:

- **Read (injection).** Before each completion, enabled memories are grouped
  by category and prepended as a system message. The model just "knows" them.
- **Write (tool call).** Each request advertises a `remember` function tool.
  When the model judges a fact worth keeping, it calls the tool; the tool
  loop (see below) runs it, stores the memory (marked `auto`), feeds the
  result back to the model, and lets it continue its reply. The save appears
  as an inline chip in the chat at the point it happened. The model never
  writes storage
  directly — it emits intent, Mimir owns the mutation, every write is visible
  and reversible. Models without function-calling simply never call it and
  only the injection path runs (graceful degradation).

## Tool loop

`lib/tools.ts` drives the full OpenAI tool-use protocol within a single
response. `runToolLoop` streams a completion; if the model emitted tool
calls, it runs each handler, appends the assistant tool-call message and a
`tool`-role result message (with proper `tool_call_id` linkage), and loops —
until the model replies with prose and no calls, or a round cap (default 5)
is hit. `onText` streams the current round's tokens; `onToolEvent` fires
after each tool runs.

Tools live in a registry: `{ name -> { def, run } }`. `def` is the schema
advertised to the model; `run(args)` executes and returns a string fed back
as the result. Adding a capability means adding one registry entry; the loop
is tool-agnostic and unchanged. The registry is assembled per response in
`ChatView`, so a tool can be omitted when its switch is off. `remember`
(`rememberTool` in `lib/memory.ts`) is wired to the store so the write stays
owned by Mimir.

Manage memories in the Memories window: add, edit (click the text), toggle
on/off (checkbox), delete. `lib/memory.ts` is the single source for both the
tool schema and the injection prompt.

## Web tools

Two tools give the model reach beyond its training data (`lib/webtools.ts`):

- **`web_search`** — the model emits a query; Mimir forwards it to a
  self-hosted [SearXNG](https://github.com/searxng/searxng) instance and hands
  back the ranked results (title, URL, snippet). Discovery only.
- **`web_fetch`** — downloads a single URL and returns its readable text, so
  the model can read a result (or a link you pasted) in full.

Both calls go out server-side through `/api/websearch` and `/api/webfetch`, so
the browser keeps talking only to Mimir (same shape as the llama proxy). The
only things that leave the machine are the search query (to your SearXNG) and
any URL the model chooses to fetch — and both are visible in the inline tool
chip, so every outbound call is auditable.

Run SearXNG with the bundled compose file (`docker compose up -d searxng`,
exposed on `:8888`). Its `settings.yml` enables the `json` format that
`web_search` needs.

**Configuration (Tools window).** Each tool has a master on/off switch.
Web search exposes the SearXNG URL, result count, and safe-search level; web
fetch exposes the max characters returned. The built-ins (`remember`,
`load_skill`) can be toggled too, but stay fully local. Web tools ship
**disabled** — enabling them is the one explicit, visible choice that lets a
query leave the machine.

**Per-conversation switch.** A "Web search" toggle sits above the chat input.
Once web tools are enabled globally it controls whether they're offered in
*this* conversation (defaults on; flip it off to keep one chat fully local).
The per-conversation state lives on the conversation (`webToolsEnabled`); when
web tools are disabled globally the button is muted and opens the Tools window.

## Skills

Reusable instruction packs (SKILL.md format) the model loads on demand, via
progressive disclosure:

- **Discovery.** Enabled skills' name + description are injected into the
  system prompt as a menu — one line each, cheap.
- **Activation.** When a task matches, the model calls the `load_skill` tool
  and gets that skill's full body back through the tool loop.
- **Execution (not built).** If a skill references scripts, `load_skill` notes
  them but cannot run them — that needs the workspace sandbox. The manager and
  the tool result both mark this boundary clearly.

Manage them in the Skills window: paste a SKILL.md to import (frontmatter or
heading/paragraph fallback is parsed live, script references are detected),
edit name/description/body, toggle on/off, delete. `lib/skills.ts` holds the
parser, discovery prompt, and tool.

## System prompts

The text sent ahead of every conversation is assembled in `lib/systemPrompts.ts`
from three sources, in order: enabled **system prompts** (presets first, then
custom), the **memory** prompt, and the **skills** discovery menu.
`buildSystemSegments` returns labeled segments, so the chat and the manager
share one source of truth — what you preview is exactly what's sent.

- **Presets.** A small catalog of toggleable prompts. They can be *dynamic*:
  the **Current date & knowledge cutoff** preset regenerates each send with
  today's real date and reminds the model its training cutoff is in the past —
  which stops it from assuming its training-time "now" is the present. It ships
  enabled; the rest (concise, Markdown, direct & honest, cite sources) are
  opt-in. Presets can be enabled/disabled but not edited or deleted.
- **Custom prompts.** Create your own standing instructions (name, description,
  body), toggle them on/off, edit, and delete — the same flow as Skills.
- **Full prompt view.** "View full system prompt" shows every active segment
  with its source label — including the text generated from memories and skills
  — plus the list of tools advertised as function schemas, with a copy button.
  Full transparency about what reaches the model.

Presets are seeded into the store and reconciled on migration, so a user's
enable/disable choices and custom prompts survive upgrades.

## Stubs (intentionally unbuilt)

- **Workspaces** — agentic container concept; also the home of the future
  script-execution sandbox skills will use.

## Ideas for next steps

1. System prompt per conversation
2. SQLite persistence (Drizzle or better-sqlite3) once data outgrows localStorage
3. Generation params (temperature, top_p, max_tokens) in a per-chat drawer
4. Grouping/folders for conversations in the Conversations window
5. The workspace agent loop
