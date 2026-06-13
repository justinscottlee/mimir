# Talos

A self-hosted AI workbench for local llama.cpp endpoints. Named for the bronze
automaton Hephaestus forged to guard Crete — the first machine in Greek myth
that ran on its own.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000, hit the gear in the sidebar footer, and point the
endpoint at your llama.cpp server (e.g. `http://192.168.1.50:8080`). Use
"Test connection" to confirm Talos can see your models.

### Running llama.cpp with multiple models

llama-server can hot-swap models when launched with a model list:

```bash
llama-server --models-dir /path/to/ggufs --port 8080
# or, single model:
llama-server -m model.gguf --port 8080
```

Talos reads `/v1/models` to populate the model picker and streams completions
from `/v1/chat/completions`.

## How it's wired

- **Next.js App Router + TypeScript + Tailwind.** One page, client-rendered
  shell (`components/AppShell.tsx`).
- **State** lives in a Zustand store (`lib/store.ts`) persisted to
  localStorage — conversations, workspaces, open tabs, and settings all
  survive a refresh without a database. Swap the persistence layer for SQLite
  later without touching components.
- **llama.cpp access** goes through a catch-all proxy route
  (`app/api/llama/[...path]/route.ts`). The browser only ever talks to Talos;
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
  top-right, one window per kind. Positions persist across refreshes.

## Chat features

- Assistant messages render markdown (GFM): bold, tables, lists, blockquotes,
  syntax-highlighted code blocks with per-block copy buttons.
- Code blocks tagged `html`, `svg`, or `xml` get a Code/Preview toggle that
  renders the artifact live in a sandboxed iframe (`sandbox="allow-scripts"`,
  no same-origin access, so artifacts can't touch app state).
- Generation stats under each assistant message: tok/s, output tokens,
  context usage (vs. the server's n_ctx from `/props`), and wall time.
  Server-reported usage/timings are preferred; falls back to client-side
  estimates when the server doesn't report them.
- Message actions on hover: copy and delete on every message; resend on user
  messages (truncates everything after and regenerates).

## Stubs (intentionally unbuilt)

- **Workspaces** — agentic container concept; the view documents the plan.
- **Memories / Skills / Tools** — manager pages exist with planned-feature
  notes. Skills are aimed at the skills.sh folder format (SKILL.md + assets).

## Ideas for next steps

1. System prompt per conversation
2. SQLite persistence (Drizzle or better-sqlite3) once data outgrows localStorage
3. Generation params (temperature, top_p, max_tokens) in a per-chat drawer
4. Window resizing + minimize-to-sidebar
5. The workspace agent loop
