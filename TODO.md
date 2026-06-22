## Major features

- **Server-side run execution (durable runs).** Promote the chat/agent run loop
  off the client and onto the server, with the browser subscribing to a live
  stream. This will enable tasks.
  
- **Scheduled agentic tasks** e.g. a periodic memory-consolidation run.

- **Custom parameters.** Make it so that the user can on a per-model basis adjust temperature, top_p, top_k, repeat_penalty, presence_penalty, min_p. Along with a clean user interface/experience for this customization.

- **Multimodal input.** Allow users to attach images (and PDF's? or is that different?) to chat messages for models that accept such inputs. Fail gracefully if that capability is unsupported.

- **Attach files/documents to a conversation as context.** Drop a file into the chat, with a user interface almost looking like attaching a file. For now, direct context injection.

- **Memory retrieval that scales.** `buildMemoryPrompt` injects *every* enabled
  memory on *every* request, which stops scaling past a few dozen. Add
  relevance-based retrieval (embeddings or keyword) so only pertinent memories
  are injected — the `source: "user" | "auto"` split already anticipates this.

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

- **Terminal niceties.** Copy-on-select and right-click paste; a clear-screen
  affordance; remember scrollback across a `restart`.