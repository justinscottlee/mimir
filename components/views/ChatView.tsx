"use client";

import { useEffect, useRef, useState } from "react";
import { uid, useTalos } from "@/lib/store";
import { fetchContextSize, listModels, streamChat } from "@/lib/llama";
import { LlamaModel, Message } from "@/lib/types";
import { buildMemoryPrompt, MEMORY_TOOLS, parseRememberArgs } from "@/lib/memory";
import { IconCheck, IconCopy, IconResend, IconSend, IconStop, IconTrash } from "../icons";
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

  const [models, setModels] = useState<LlamaModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [contextSize, setContextSize] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string[]>([]);
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
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversation?.messages]);

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
      const result = await streamChat(
        {
          endpoint,
          model: current.model,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          system: memoryPrompt ?? undefined,
          tools: MEMORY_TOOLS,
          signal: controller.signal,
        },
        (accumulated) =>
          patchMessage(conversationId, assistantMessage.id, {
            content: accumulated,
          })
      );

      // Handle any `remember` tool calls the model emitted. Talos owns the
      // write — the model only expressed intent. Each save is visible and
      // reversible in the Memories window.
      const saved: string[] = [];
      for (const call of result.toolCalls) {
        if (call.name !== "remember") continue;
        const args = parseRememberArgs(call.arguments);
        if (args) {
          addMemory(args.content, { category: args.category, source: "auto" });
          saved.push(args.content);
        }
      }
      if (saved.length > 0) setSavedNotice(saved);

      // If the model produced no prose (pure tool call), leave a short note so
      // the turn isn't an empty bubble.
      const finalContent =
        useTalos.getState().conversations[conversationId]?.messages.find(
          (m) => m.id === assistantMessage.id
        )?.content ?? "";
      if (!finalContent.trim() && saved.length > 0) {
        patchMessage(conversationId, assistantMessage.id, {
          content: `_Saved ${saved.length} ${
            saved.length === 1 ? "memory" : "memories"
          }._`,
        });
      }

      const { toolCalls, ...meta } = result;
      void toolCalls;
      patchMessage(conversationId, assistantMessage.id, {
        meta: { ...meta, contextSize: contextSize ?? undefined },
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

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setSavedNotice([]);

    const userMessage: Message = {
      id: uid("msg_"),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    const before = useTalos.getState().conversations[conversationId];
    appendMessage(conversationId, userMessage);

    // First user message names the conversation.
    if (before && before.messages.length === 0) {
      setConversationTitle(
        conversationId,
        text.length > 42 ? text.slice(0, 42) + "…" : text
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
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
          {conversation.messages.length === 0 && (
            <p className="pt-16 text-center text-sm text-parchment-600">
              Send a message to begin. The full conversation is kept on this
              machine.
            </p>
          )}
          {conversation.messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              streaming={streaming}
              onDelete={() => deleteMessage(conversationId, m.id)}
              onResend={m.role === "user" ? () => resend(m.id) : undefined}
            />
          ))}
          {streamError && (
            <div className="rounded-md border border-signal-err/40 bg-signal-err/10 px-3 py-2 text-sm text-signal-err">
              {streamError}
            </div>
          )}
          {savedNotice.length > 0 && (
            <button
              onClick={() => openWindow("memories")}
              className="flex items-start gap-2 rounded-md border border-bronze-600/40 bg-bronze-600/10 px-3 py-2 text-left text-xs text-bronze-300 transition-colors hover:bg-bronze-600/20"
            >
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-bronze-400" />
              <span>
                Saved {savedNotice.length}{" "}
                {savedNotice.length === 1 ? "memory" : "memories"} this turn.
                Click to review in the Memories window.
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-ink-700 px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-ink-700 bg-ink-850 p-2 focus-within:border-bronze-600">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={Math.min(6, Math.max(1, input.split("\n").length))}
            placeholder="Message the model… (Enter to send, Shift+Enter for a new line)"
            className="max-h-48 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-parchment-100 placeholder:text-parchment-600 focus:outline-none"
          />
          {streaming ? (
            <button
              onClick={stop}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-700 text-parchment-100 transition-colors hover:bg-ink-800"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <IconStop />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-bronze-500 text-ink-950 transition-colors hover:bg-bronze-400 disabled:opacity-30"
              title="Send"
              aria-label="Send"
            >
              <IconSend />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  streaming,
  onDelete,
  onResend,
}: {
  message: Message;
  streaming: boolean;
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
          <Markdown content={message.content} />
        ) : (
          <span className="text-sm text-parchment-600">
            {streaming ? "▍" : "(empty response)"}
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
              disabled={streaming}
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
}

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
