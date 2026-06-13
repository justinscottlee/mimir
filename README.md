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

- Add any number of llama.cpp endpoints, each with a friendly name and URL.
- Enable or disable individual models per endpoint — disabled ones disappear
  from every picker but stay one toggle away.
- Pick a default model for new conversations and a separate default for new
  workspaces (or leave either on "first available").

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
  Workspaces, Memories, Skills, Tools, and a profile footer with settings.
- Main area: tab bar on top. Tabs are reserved for chats and workspaces —
  drag to reorder, click the title of the active tab to rename it (renames
  the underlying conversation/workspace too).
- Manager pages (Conversations, Workspaces, Memories, Skills, Tools,
  Settings) open as draggable floating windows: title top-left, close button
  top-right, one window per kind. Positions persist across refreshes. Each
  window is resizable from the bottom-right corner, with a per-kind default,
  minimum, and maximum size; the chosen size persists too.
- The Conversations window has a search bar (matching titles and message
  content, same as the global ⌘K search) and a Select mode for multi-select —
  tick several conversations and delete them all behind a single confirmation.

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
as the result. Adding a capability — web search, file read/write — means
adding one registry entry; the loop is tool-agnostic and unchanged. `remember`
is the first entry (`rememberTool` in `lib/memory.ts`), wired to the store so
the write stays owned by Mimir.

Manage them in the Memories window: add, edit (click the text), toggle
on/off (checkbox), delete. `lib/memory.ts` is the single source for both the
tool schema and the injection prompt.

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

## Stubs (intentionally unbuilt)

- **Workspaces** — agentic container concept; also the home of the future
  script-execution sandbox skills will use.
- **Tools** — manager window with planned-feature notes.

## Ideas for next steps

1. System prompt per conversation
2. SQLite persistence (Drizzle or better-sqlite3) once data outgrows localStorage
3. Generation params (temperature, top_p, max_tokens) in a per-chat drawer
4. Grouping/folders for conversations in the Conversations window
5. The workspace agent loop
