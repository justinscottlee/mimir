"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { uid, useTalos } from "@/lib/store";
import { fetchContextSize, listModels } from "@/lib/llama";
import { LlamaModel, Message, ToolEventRecord } from "@/lib/types";
import { buildMemoryPrompt, rememberTool } from "@/lib/memory";
import { buildSkillsPrompt, loadSkillTool } from "@/lib/skills";
import { runToolLoop, ToolEvent, ToolRegistry } from "@/lib/tools";
import { parseTranscript } from "@/lib/transcript";
import {
  IconCheck,
  IconChevron,
  IconCopy,
  IconResend,
  IconSend,
  IconSpark,
  IconStop,
  IconTrash,
} from "../icons";
import Markdown from "../Markdown";

export default function ChatView({ conversationId }: { conversationId: string }) {
  const conversation = useTalos((s) => s.conversations[conversationId]);
  const endpoint = useTalos((s) => s.settings.endpoint);
  const appendMessage = useTalos((s) => s.appendMessage);
  const patchMessage = useTalos((s) => s.patchMessage);
  const deleteMessage = useTalos((s) => s.deleteMessage);
  const truncateAfterMessage = useTalos((s) => s.truncateAfterMessage);
  const setConversationModel = useTalos((s) => s.setConversationModel);
  const setConversationTitle = useTalos((s) => s.setConversationTitle);
  const openWindow = useTalos((s) => s.openWindow);
  const memories = useTalos((s) => s.memories);
  const addMemory = useTalos((s) => s.addMemory);
  const skills = useTalos((s) => s.skills);

  const [models, setModels] = useState<LlamaModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [contextSize, setContextSize] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch available models and the server context size.
  useEffect(() => {
    let cancelled = false;
    setModelsError(null);
    listModels(endpoint)
      .then((m) => {
        if (cancelled) return;
        setModels(m);
        const current = useTalos.getState().conversations[conversationId];
        if (m.length > 0 && !current?.model) {
          setConversationModel(conversationId, m[0].id);
        }
      })
      .catch((e) => !cancelled && setModelsError(e.message));
    fetchContextSize(endpoint).then((n) => !cancelled && setContextSize(n));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, conversationId]);

  // Keep the latest message in view.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages, scrollToBottom]);

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-parchment-600">
        This conversation no longer exists.
      </div>
    );
  }

  /** Streams a completion for the given history into a new assistant message. */
  async function runCompletion(history: Message[]) {
    const current = useTalos.getState().conversations[conversationId];
    if (!current?.model) {
      setStreamError("Pick a model first — none is selected.");
      return;
    }

    setStreamError(null);

    const assistantMessage: Message = {
      id: uid("msg_"),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    appendMessage(conversationId, assistantMessage);

    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const memoryPrompt = buildMemoryPrompt(Object.values(memories));
      const skillsPrompt = buildSkillsPrompt(Object.values(skills));
      const system =
        [memoryPrompt, skillsPrompt].filter(Boolean).join("\n\n") || undefined;

      // Build the tool registry. The remember handler is wired to the store so
      // Talos owns the write; the model only expresses intent. load_skill
      // returns a skill's full instructions on demand. New tools (web_search,
      // file ops, …) register here and the loop handles them unchanged.
      const registry: ToolRegistry = {
        remember: rememberTool((content, category) => {
          addMemory(content, { category, source: "auto" });
        }),
        load_skill: loadSkillTool((name) => {
          const match = Object.values(useTalos.getState().skills).find(
            (s) => s.name === name
          );
          return match ?? null;
        }),
      };

      // Track time spent inside <think> blocks by watching the stream for the
      // open/close transitions. Handles the common single-block case exactly.
      let thinkStartedAt: number | null = null;
      let thinkingMs = 0;
      let sawThinkOpen = false;
      let sawThinkClose = false;

      const result = await runToolLoop(
        {
          endpoint,
          model: current.model,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          system,
          registry,
          signal: controller.signal,
        },
        // Streams the combined transcript (text + tool markers) into the bubble.
        (accumulated) => {
          if (!sawThinkOpen && accumulated.includes("<think>")) {
            sawThinkOpen = true;
            thinkStartedAt = performance.now();
          }
          if (
            sawThinkOpen &&
            !sawThinkClose &&
            accumulated.includes("</think>")
          ) {
            sawThinkClose = true;
            if (thinkStartedAt != null) {
              thinkingMs = performance.now() - thinkStartedAt;
            }
          }
          patchMessage(conversationId, assistantMessage.id, {
            content: accumulated,
          });
        },
        // Persist each tool event as it completes so chips render inline and
        // survive reload.
        (event: ToolEvent) => {
          const existing =
            useTalos.getState().conversations[conversationId]?.messages.find(
              (m) => m.id === assistantMessage.id
            )?.toolEvents ?? [];
          patchMessage(conversationId, assistantMessage.id, {
            toolEvents: [...existing, event],
          });
        }
      );

      // If thinking never closed (e.g. aborted mid-thought), still record what
      // elapsed so the panel shows a duration.
      if (sawThinkOpen && !sawThinkClose && thinkStartedAt != null) {
        thinkingMs = performance.now() - thinkStartedAt;
      }

      // If the model ended without any closing prose but did run tools, the
      // transcript already shows the chips — no placeholder needed.
      patchMessage(conversationId, assistantMessage.id, {
        content: result.content,
        meta: {
          ...result.meta,
          contextSize: contextSize ?? undefined,
          thinkingMs: thinkingMs || undefined,
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setStreamError((e as Error).message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;


    const userMessage: Message = {
      id: uid("msg_"),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    const before = useTalos.getState().conversations[conversationId];
    appendMessage(conversationId, userMessage);

    // First user message names the conversation.
    if (before && before.messages.length === 0) {
      setConversationTitle(
        conversationId,
        trimmed.length > 42 ? trimmed.slice(0, 42) + "…" : trimmed
      );
    }

    await runCompletion([...(before?.messages ?? []), userMessage]);
  }

  /** Drops everything after a user message and regenerates from it. */
  async function resend(messageId: string) {
    if (streaming) return;
    truncateAfterMessage(conversationId, messageId);
    const current = useTalos.getState().conversations[conversationId];
    if (!current) return;
    await runCompletion(current.messages);
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Conversation header */}
      <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
          Model
        </span>
        {models.length > 0 ? (
          <select
            value={conversation.model ?? ""}
            onChange={(e) => setConversationModel(conversationId, e.target.value)}
            className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-parchment-100"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-xs text-parchment-600">
            {modelsError ? "endpoint unreachable" : "loading…"}
          </span>
        )}
        {modelsError && (
          <button
            onClick={() => openWindow("settings")}
            className="ml-auto text-xs text-bronze-300 hover:underline"
          >
            Check endpoint in Settings →
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-6">
          {conversation.messages.length === 0 && (
            <p className="pt-16 text-center text-sm text-parchment-600">
              Send a message to begin. The full conversation is kept on this
              machine.
            </p>
          )}
          {conversation.messages.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              isStreaming={
                streaming && i === conversation.messages.length - 1
              }
              onDelete={() => deleteMessage(conversationId, m.id)}
              onResend={m.role === "user" ? () => resend(m.id) : undefined}
            />
          ))}
          {streamError && (
            <div className="rounded-md border border-signal-err/40 bg-signal-err/10 px-3 py-2 text-sm text-signal-err">
              {streamError}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <ChatInput
        streaming={streaming}
        onSend={send}
        onStop={stop}
        onResize={scrollToBottom}
      />
    </div>
  );
}

const MessageRow = memo(
  function MessageRow({
    message,
    isStreaming,
    onDelete,
    onResend,
  }: {
    message: Message;
    isStreaming: boolean;
    onDelete: () => void;
    onResend?: () => void;
  }) {
    const isUser = message.role === "user";
    const [copied, setCopied] = useState(false);

    function copy() {
      navigator.clipboard.writeText(message.content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }

  return (
    <div
      className={[
        "group flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      ].join(" ")}
    >
      <div
        className={[
          "max-w-[88%] min-w-0 rounded-lg px-4 py-2.5",
          isUser
            ? "whitespace-pre-wrap bg-bronze-600/20 text-sm leading-relaxed text-parchment-100"
            : "w-full border border-ink-700 bg-ink-900 text-parchment-100",
        ].join(" ")}
      >
        {isUser ? (
          message.content
        ) : message.content ? (
          <AssistantBody
            content={message.content}
            isStreaming={isStreaming}
            toolEvents={message.toolEvents ?? []}
            thinkingMs={message.meta?.thinkingMs}
          />
        ) : (
          <span className="text-sm text-parchment-600">
            {isStreaming ? "▍" : "(empty response)"}
          </span>
        )}
      </div>

      {/* Meta + actions row */}
      <div
        className={[
          "flex items-center gap-1.5 px-1 font-mono text-[11px] text-parchment-600",
          isUser ? "flex-row-reverse" : "",
        ].join(" ")}
      >
        {!isUser && message.meta && <MetaLine meta={message.meta} />}
        <div
          className={[
            "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
            isUser ? "flex-row-reverse" : "",
          ].join(" ")}
        >
          <ActionButton
            label={copied ? "Copied" : "Copy message"}
            onClick={copy}
          >
            {copied ? (
              <IconCheck className="h-3.5 w-3.5 text-signal-ok" />
            ) : (
              <IconCopy className="h-3.5 w-3.5" />
            )}
          </ActionButton>
          {onResend && (
            <ActionButton
              label="Resend (regenerates everything after this message)"
              onClick={onResend}
              disabled={isStreaming}
            >
              <IconResend className="h-3.5 w-3.5" />
            </ActionButton>
          )}
          <ActionButton label="Delete message" onClick={onDelete} danger>
            <IconTrash className="h-3.5 w-3.5" />
          </ActionButton>
        </div>
      </div>
    </div>
  );
  },
  // Re-render only when the message content/meta, streaming state, or whether
  // it can resend actually change — ignore the always-fresh callback props.
  // This keeps unchanged messages from re-rendering (and re-parsing markdown)
  // while another message streams.
  (prev, next) =>
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    !prev.onResend === !next.onResend
);

function MetaLine({ meta }: { meta: NonNullable<Message["meta"]> }) {
  const parts: string[] = [];
  if (meta.tokensPerSecond) {
    parts.push(`${meta.tokensPerSecond.toFixed(1)} tok/s`);
  }
  if (meta.completionTokens) {
    parts.push(`${formatTokens(meta.completionTokens)} out`);
  }
  if (meta.promptTokens != null && meta.completionTokens != null) {
    const used = meta.promptTokens + meta.completionTokens;
    parts.push(
      meta.contextSize
        ? `ctx ${formatTokens(used)}/${formatTokens(meta.contextSize)}`
        : `ctx ${formatTokens(used)}`
    );
  }
  if (meta.durationMs) {
    parts.push(`${(meta.durationMs / 1000).toFixed(1)}s`);
  }
  if (parts.length === 0) return null;
  return <span>{parts.join(" · ")}</span>;
}

function ActionButton({
  label,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={[
        "rounded p-1 transition-colors disabled:opacity-30",
        danger
          ? "text-parchment-600 hover:bg-ink-800 hover:text-signal-err"
          : "text-parchment-600 hover:bg-ink-800 hover:text-parchment-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function formatTokens(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Isolated input. Owns its own text state so keystrokes re-render only this
 * component, never the message list (which is expensive to re-parse). Auto-
 * grows to fit content and reports height changes via onResize so the parent
 * can keep the latest message visible as the box grows.
 */
function ChatInput({
  streaming,
  onSend,
  onStop,
  onResize,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onResize: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastHeight = useRef(0);

  // Grow to fit content (capped by max-height in CSS). When the rendered
  // height actually changes, nudge the parent to re-pin the scroll position.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = el.scrollHeight;
    el.style.height = `${next}px`;
    if (next !== lastHeight.current) {
      lastHeight.current = next;
      onResize();
    }
  }, [value, onResize]);

  function submit() {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
  }

  return (
    <div className="px-5 pb-5 pt-1">
      <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2 focus-within:border-bronze-600">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Message the model… (Enter to send, Shift+Enter for a new line)"
          className="max-h-72 min-h-[2.5rem] flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-parchment-100 placeholder:text-parchment-600 focus:outline-none"
        />
        {streaming ? (
          <button
            onClick={onStop}
            className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-ink-700 text-parchment-100 transition-colors hover:bg-ink-800"
            title="Stop generating"
            aria-label="Stop generating"
          >
            <IconStop />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-bronze-500 text-ink-950 transition-colors hover:bg-bronze-400 disabled:opacity-30"
            title="Send"
            aria-label="Send"
          >
            <IconSend />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Renders an assistant message as ordered segments: thinking panels, inline
 * tool chips, and markdown prose, exactly where they appear in the stream.
 */
function AssistantBody({
  content,
  isStreaming,
  toolEvents,
  thinkingMs,
}: {
  content: string;
  isStreaming: boolean;
  toolEvents: ToolEventRecord[];
  thinkingMs?: number;
}) {
  const segments = parseTranscript(content);

  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) => {
        if (seg.type === "think") {
          return (
            <ThinkingPanel
              key={`think-${i}`}
              text={seg.text}
              live={seg.open && isStreaming}
              thinkingMs={thinkingMs}
            />
          );
        }
        if (seg.type === "tool") {
          const event = toolEvents.find((e) => e.index === seg.index);
          return <ToolChip key={`tool-${seg.index}`} event={event} />;
        }
        return (
          <Markdown key={`text-${i}`} content={seg.text} isStreaming={isStreaming} />
        );
      })}
    </div>
  );
}

/**
 * Collapsible reasoning panel in the brand accent. Expanded and ticking while
 * the model thinks; collapses to a summary with the elapsed duration after.
 */
function ThinkingPanel({
  text,
  live,
  thinkingMs,
}: {
  text: string;
  live: boolean;
  thinkingMs?: number;
}) {
  // Open while thinking; default collapsed once done.
  const [open, setOpen] = useState(live);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  // Tick the duration up while live.
  useEffect(() => {
    if (!live) return;
    setOpen(true);
    if (startRef.current == null) startRef.current = performance.now();
    const t = setInterval(() => {
      if (startRef.current != null) {
        setElapsed(performance.now() - startRef.current);
      }
    }, 100);
    return () => clearInterval(t);
  }, [live]);

  // Collapse automatically when thinking finishes.
  useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);

  const duration = live ? elapsed : thinkingMs;
  const durationLabel =
    duration != null ? `${(duration / 1000).toFixed(1)}s` : null;

  return (
    <div className="overflow-hidden rounded-md border border-bronze-600/40 bg-bronze-600/10">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-bronze-600/15 px-3 py-1.5 text-left text-xs text-bronze-300 transition-colors hover:bg-bronze-600/25"
      >
        {live ? (
          <IconSpark className="h-3.5 w-3.5 talos-spin text-bronze-400" />
        ) : (
          <IconSpark className="h-3.5 w-3.5 text-bronze-400" />
        )}
        <span className="font-medium">
          {live ? "Thinking" : "Thought"}
          {durationLabel ? ` · ${durationLabel}` : ""}
        </span>
        <div className="flex-1" />
        <IconChevron
          className={[
            "h-3.5 w-3.5 transition-transform",
            open ? "" : "-rotate-90",
          ].join(" ")}
        />
      </button>
      {open && (
        <div className="border-t border-bronze-600/30 px-3 py-2">
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-parchment-400">
            {text.trim() || (live ? "…" : "")}
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline chip showing a tool call that ran, expandable for its result. */
function ToolChip({ event }: { event?: ToolEventRecord }) {
  const [open, setOpen] = useState(false);
  if (!event) {
    // Marker present but event not yet persisted (mid-stream) — show pending.
    return (
      <div className="inline-flex items-center gap-2 self-start rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs text-parchment-400">
        <IconSpark className="h-3.5 w-3.5 talos-spin text-bronze-400" />
        running tool…
      </div>
    );
  }

  const label = describeTool(event);

  return (
    <div className="self-start overflow-hidden rounded-md border border-ink-700 bg-ink-850">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2.5 py-1 text-left text-xs text-parchment-400 transition-colors hover:bg-ink-800"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-bronze-400" />
        <span className="font-mono text-bronze-300">{event.name}</span>
        <span className="text-parchment-600">{label}</span>
        <IconChevron
          className={[
            "h-3 w-3 transition-transform",
            open ? "" : "-rotate-90",
          ].join(" ")}
        />
      </button>
      {open && (
        <div className="border-t border-ink-700 px-2.5 py-1.5">
          <div className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-parchment-400">
            {event.result}
          </div>
        </div>
      )}
    </div>
  );
}

/** A short human label for a tool event, by tool name. */
function describeTool(event: ToolEventRecord): string {
  if (event.name === "remember") {
    const c = event.args.content;
    return typeof c === "string"
      ? `saved “${c.length > 40 ? c.slice(0, 40) + "…" : c}”`
      : "saved a memory";
  }
  if (event.name === "load_skill") {
    const n = event.args.name;
    return typeof n === "string" ? `loaded ${n}` : "loaded a skill";
  }
  return "";
}
