"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uid, useMimir } from "@/lib/store";
import { fetchContextSize } from "@/lib/llama";
import {
  EndpointLoad,
  loadAllModels,
  resolveEnabledModels,
  resolveModelKey,
  describeModelKey,
} from "@/lib/models";
import { Message, ResolvedModel, ToolEventRecord } from "@/lib/types";
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
import ConfirmDelete from "../ConfirmDelete";
import Markdown from "../Markdown";

export default function ChatView({ conversationId }: { conversationId: string }) {
  const conversation = useMimir((s) => s.conversations[conversationId]);
  const settings = useMimir((s) => s.settings);
  const appendMessage = useMimir((s) => s.appendMessage);
  const patchMessage = useMimir((s) => s.patchMessage);
  const deleteMessage = useMimir((s) => s.deleteMessage);
  const truncateAfterMessage = useMimir((s) => s.truncateAfterMessage);
  const setConversationModel = useMimir((s) => s.setConversationModel);
  const setConversationTitle = useMimir((s) => s.setConversationTitle);
  const openWindow = useMimir((s) => s.openWindow);
  const addMemory = useMimir((s) => s.addMemory);

  const [loads, setLoads] = useState<EndpointLoad[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [contextSize, setContextSize] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const streamingRef = useRef(false);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const models = useMemo(
    () => resolveEnabledModels(loads, settings.disabledModels),
    [loads, settings.disabledModels]
  );

  const endpointsKey = settings.endpoints.map((e) => e.id + e.url).join("|");
  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    loadAllModels(settings.endpoints).then((res) => {
      if (cancelled) return;
      setLoads(res);
      setLoadingModels(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointsKey]);

  useEffect(() => {
    if (models.length === 0) return;
    const current = useMimir.getState().conversations[conversationId];
    if (!current) return;
    const stillValid =
      current.model && models.some((m) => m.key === current.model);
    if (!stillValid) {
      const fallback =
        settings.defaultConversationModel &&
        models.some((m) => m.key === settings.defaultConversationModel)
          ? settings.defaultConversationModel
          : models[0].key;
      setConversationModel(conversationId, fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, conversationId]);

  useEffect(() => {
    const resolved = resolveModelKey(conversation?.model, settings);
    if (!resolved) return;
    let cancelled = false;
    fetchContextSize(resolved.url).then((n) => !cancelled && setContextSize(n));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.model, endpointsKey]);

  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (force || atBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages, scrollToBottom]);

  const runCompletion = useCallback(
    async (history: Message[]) => {
      const state = useMimir.getState();
      const current = state.conversations[conversationId];
      const resolved = resolveModelKey(current?.model, state.settings);
      if (!resolved) {
        setStreamError("Pick a model first — none is selected.");
        return;
      }

      setStreamError(null);

      const assistantMessage: Message = {
        id: uid("msg_"),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: current?.model,
      };
      appendMessage(conversationId, assistantMessage);

      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const registry: ToolRegistry = {
        remember: rememberTool((content, category) => {
          addMemory(content, { category, source: "auto" });
        }),
        load_skill: loadSkillTool((name) => {
          const match = Object.values(useMimir.getState().skills).find(
            (s) => s.name === name
          );
          return match ?? null;
        }),
      };

      const memoryPrompt = buildMemoryPrompt(
        Object.values(useMimir.getState().memories)
      );
      const skillsPrompt = buildSkillsPrompt(
        Object.values(useMimir.getState().skills)
      );
      const system =
        [memoryPrompt, skillsPrompt].filter(Boolean).join("\n\n") || undefined;

      let thinkStartedAt: number | null = null;
      let thinkingMs = 0;
      let sawThinkOpen = false;
      let sawThinkClose = false;
      let interrupted = false;

      try {
        const result = await runToolLoop(
          {
            endpoint: resolved.url,
            model: resolved.modelId,
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            system,
            registry,
            signal: controller.signal,
          },
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
          (event: ToolEvent) => {
            const existing =
              useMimir.getState().conversations[conversationId]?.messages.find(
                (m) => m.id === assistantMessage.id
              )?.toolEvents ?? [];
            patchMessage(conversationId, assistantMessage.id, {
              toolEvents: [...existing, event],
            });
          }
        );

        if (sawThinkOpen && !sawThinkClose && thinkStartedAt != null) {
          thinkingMs = performance.now() - thinkStartedAt;
        }

        patchMessage(conversationId, assistantMessage.id, {
          content: result.content,
          meta: {
            ...result.meta,
            contextSize: contextSize ?? undefined,
            thinkingMs: thinkingMs || undefined,
          },
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          interrupted = true;
        } else {
          setStreamError((e as Error).message);
        }
      } finally {
        if (interrupted) {
          patchMessage(conversationId, assistantMessage.id, {
            interrupted: true,
            meta: {
              contextSize: contextSize ?? undefined,
              thinkingMs: thinkingMs || undefined,
            },
          });
        }
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [conversationId, appendMessage, patchMessage, addMemory, contextSize]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streamingRef.current) return;

      const userMessage: Message = {
        id: uid("msg_"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };

      const before = useMimir.getState().conversations[conversationId];
      appendMessage(conversationId, userMessage);

      if (before && before.messages.length === 0) {
        setConversationTitle(
          conversationId,
          trimmed.length > 42 ? trimmed.slice(0, 42) + "…" : trimmed
        );
      }

      await runCompletion([...(before?.messages ?? []), userMessage]);
    },
    [conversationId, appendMessage, setConversationTitle, runCompletion]
  );

  const resend = useCallback(
    async (messageId: string) => {
      if (streamingRef.current) return;
      truncateAfterMessage(conversationId, messageId);
      const current = useMimir.getState().conversations[conversationId];
      if (!current) return;
      await runCompletion(current.messages);
    },
    [conversationId, truncateAfterMessage, runCompletion]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDeleteMessage = useCallback(
    (id: string) => deleteMessage(conversationId, id),
    [conversationId, deleteMessage]
  );

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-parchment-600">
        This conversation no longer exists.
      </div>
    );
  }

  const noEndpoints = settings.endpoints.length === 0;
  const noModels = !loadingModels && models.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
          Model
        </span>
        {loadingModels ? (
          <span className="font-mono text-xs text-parchment-600">loading…</span>
        ) : models.length > 0 ? (
          <ModelSelect
            models={models}
            value={conversation.model}
            onChange={(key) => setConversationModel(conversationId, key)}
          />
        ) : (
          <span className="font-mono text-xs text-parchment-600">
            {noEndpoints ? "no endpoints configured" : "no models available"}
          </span>
        )}
        {(noModels || noEndpoints) && (
          <button
            onClick={() => openWindow("settings")}
            className="ml-auto text-xs text-bronze-300 hover:underline"
          >
            Open Settings →
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
          <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-6">
            {conversation.messages.length === 0 && (
              <p className="pt-16 text-center text-sm text-parchment-600">
                Send a message to begin. No data will leave Mimir unless you use
                an externally hosted model, or web search.
              </p>
            )}
            {conversation.messages.map((m, i) => (
              <MessageRow
                key={m.id}
                message={m}
                isStreaming={streaming && i === conversation.messages.length - 1}
                onDelete={handleDeleteMessage}
                onResend={m.role === "user" ? resend : undefined}
              />
            ))}
            {streamError && (
              <div className="rounded-md border border-signal-err/40 bg-signal-err/10 px-3 py-2 text-sm text-signal-err">
                {streamError}
              </div>
            )}
          </div>
        </div>

        {!atBottom && (
          <button
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-parchment-100 shadow-lg transition-colors hover:bg-ink-800"
          >
            {streaming && <span className="h-1.5 w-1.5 rounded-full bg-bronze-400" />}
            {streaming ? "Generating — jump to latest" : "Jump to latest"}
            <IconChevron className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <ChatInput
        streaming={streaming}
        onSend={send}
        onStop={stop}
        onResize={() => scrollToBottom()}
      />
    </div>
  );
}

function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: ResolvedModel[];
  value?: string;
  onChange: (key: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: ResolvedModel[] }>();
    for (const m of models) {
      if (!map.has(m.endpointId)) {
        map.set(m.endpointId, { name: m.endpointName, items: [] });
      }
      map.get(m.endpointId)!.items.push(m);
    }
    return [...map.values()];
  }, [models]);

  const active = models.find((m) => m.key === value);

  return (
    <div className="flex items-center gap-2">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[20rem] rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-parchment-100"
      >
        {groups.length === 1
          ? groups[0].items.map((m) => (
              <option key={m.key} value={m.key}>
                {m.modelId}
              </option>
            ))
          : groups.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.items.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.modelId}
                  </option>
                ))}
              </optgroup>
            ))}
      </select>
      {active && (
        <span className="hidden font-mono text-[10px] text-parchment-600 sm:inline">
          {groups.length > 1 ? active.endpointName : ""}
          {active.contextLength
            ? `${groups.length > 1 ? " · " : ""}${formatTokens(active.contextLength)} ctx`
            : ""}
        </span>
      )}
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
    onDelete: (id: string) => void;
    onResend?: (id: string) => void;
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
            <>
              <AssistantBody
                content={message.content}
                isStreaming={isStreaming}
                toolEvents={message.toolEvents ?? []}
                thinkingMs={message.meta?.thinkingMs}
              />
              {message.interrupted && <InterruptedTag />}
            </>
          ) : message.interrupted ? (
            <InterruptedTag standalone />
          ) : (
            <span className="text-sm text-parchment-600">
              {isStreaming ? "▍" : "(empty response)"}
            </span>
          )}
        </div>

        <div
          className={[
            "flex items-center gap-1.5 px-1 font-mono text-[11px] text-parchment-600",
            isUser ? "flex-row-reverse" : "",
          ].join(" ")}
        >
          {!isUser && <MetaLine meta={message.meta} modelKey={message.model} />}
          <div
            className={[
              "flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
              isUser ? "flex-row-reverse" : "",
            ].join(" ")}
          >
            <ActionButton label={copied ? "Copied" : "Copy message"} onClick={copy}>
              {copied ? (
                <IconCheck className="h-3.5 w-3.5 text-signal-ok" />
              ) : (
                <IconCopy className="h-3.5 w-3.5" />
              )}
            </ActionButton>
            {onResend && (
              <ActionButton
                label="Resend (regenerates everything after this message)"
                onClick={() => onResend(message.id)}
                disabled={isStreaming}
              >
                <IconResend className="h-3.5 w-3.5" />
              </ActionButton>
            )}
            <ConfirmDelete
              label="Delete message"
              message="Delete?"
              onConfirm={() => onDelete(message.id)}
            />
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.onResend === next.onResend &&
    prev.onDelete === next.onDelete
);

function InterruptedTag({ standalone = false }: { standalone?: boolean }) {
  return (
    <div
      className={[
        "flex items-center gap-1.5 text-[11px] text-parchment-600",
        standalone ? "" : "mt-2 border-t border-ink-700 pt-2",
      ].join(" ")}
    >
      <IconStop className="h-3 w-3 text-signal-err" />
      <span className="italic">Generation interrupted</span>
    </div>
  );
}

function MetaLine({
  meta,
  modelKey,
}: {
  meta?: NonNullable<Message["meta"]>;
  modelKey?: string;
}) {
  const settings = useMimir((s) => s.settings);
  const parts: string[] = [];
  if (meta?.tokensPerSecond) parts.push(`${meta.tokensPerSecond.toFixed(1)} tok/s`);
  if (meta?.completionTokens) parts.push(`${formatTokens(meta.completionTokens)} out`);
  if (meta?.promptTokens != null && meta?.completionTokens != null) {
    const used = meta.promptTokens + meta.completionTokens;
    parts.push(
      meta.contextSize
        ? `${formatTokens(used)}/${formatTokens(meta.contextSize)} ctx`
        : `${formatTokens(used)} ctx`
    );
  }
  if (meta?.durationMs) parts.push(`${(meta.durationMs / 1000).toFixed(1)}s`);

  const modelLabel = modelKey ? describeModelKey(modelKey, settings) : null;
  if (!modelLabel && parts.length === 0) return null;

  return (
    <span className="flex items-center gap-1.5">
      {modelLabel && <span className="text-parchment-400">{modelLabel}</span>}
      {modelLabel && parts.length > 0 && <span className="text-ink-700">|</span>}
      {parts.length > 0 && <span>{parts.join(" · ")}</span>}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded p-1 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100 disabled:opacity-30"
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

function ThinkingPanel({
  text,
  live,
  thinkingMs,
}: {
  text: string;
  live: boolean;
  thinkingMs?: number;
}) {
  const [open, setOpen] = useState(live);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!live) return;
    setOpen(true);
    if (startRef.current == null) startRef.current = performance.now();
    const t = setInterval(() => {
      if (startRef.current != null) setElapsed(performance.now() - startRef.current);
    }, 100);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);

  const duration = live ? elapsed : thinkingMs;
  const durationLabel = duration != null ? `${(duration / 1000).toFixed(1)}s` : null;

  return (
    <div className="overflow-hidden rounded-md border border-bronze-600/40 bg-bronze-600/10">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-bronze-600/15 px-3 py-1.5 text-left text-xs text-bronze-300 transition-colors hover:bg-bronze-600/25"
      >
        <IconSpark className={["h-3.5 w-3.5 text-bronze-400", live ? "mimir-spin" : ""].join(" ")} />
        <span className="font-medium">
          {live ? "Thinking" : "Thought"}
          {durationLabel ? ` · ${durationLabel}` : ""}
        </span>
        <div className="flex-1" />
        <IconChevron
          className={["h-3.5 w-3.5 transition-transform", open ? "" : "-rotate-90"].join(" ")}
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

function ToolChip({ event }: { event?: ToolEventRecord }) {
  const [open, setOpen] = useState(false);
  const memories = useMimir((s) => s.memories);
  const deleteMemory = useMimir((s) => s.deleteMemory);
  const [deleted, setDeleted] = useState(false);

  if (!event) {
    return (
      <div className="inline-flex items-center gap-2 self-start rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs text-parchment-400">
        <IconSpark className="h-3.5 w-3.5 mimir-spin text-bronze-400" />
        running tool…
      </div>
    );
  }

  const label = describeTool(event);

  const savedContent =
    event.name === "remember" && typeof event.args.content === "string"
      ? (event.args.content as string)
      : null;
  const matchingMemory = savedContent
    ? Object.values(memories).find((m) => m.content === savedContent.trim())
    : undefined;

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
          className={["h-3 w-3 transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && (
        <div className="border-t border-ink-700 px-2.5 py-1.5">
          <div className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-parchment-400">
            {event.result}
          </div>
          {savedContent && (
            <div className="mt-2 flex items-center gap-2 border-t border-ink-700 pt-2">
              {deleted ? (
                <span className="text-[11px] italic text-parchment-600">
                  Memory deleted.
                </span>
              ) : matchingMemory ? (
                <ConfirmDeleteInline
                  message="Delete this memory?"
                  onConfirm={() => {
                    deleteMemory(matchingMemory.id);
                    setDeleted(true);
                  }}
                />
              ) : (
                <span className="text-[11px] italic text-parchment-600">
                  Memory no longer stored.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfirmDeleteInline({
  onConfirm,
  message,
}: {
  onConfirm: () => void;
  message: string;
}) {
  const [armed, setArmed] = useState(false);
  if (armed) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-signal-err">
        {message}
        <button
          onClick={onConfirm}
          className="rounded px-1 hover:bg-signal-err/20"
          title="Confirm — can't be undone"
        >
          <IconCheck className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setArmed(false)}
          className="rounded px-1 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
        >
          cancel
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={() => setArmed(true)}
      className="flex items-center gap-1 rounded text-[11px] text-parchment-400 hover:text-signal-err"
    >
      <IconTrash className="h-3.5 w-3.5" />
      Delete memory
    </button>
  );
}

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
