"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uid, useMimir } from "@/lib/store";
import {
  EndpointLoad,
  loadAllModels,
  resolveEnabledModels,
  modelsForModality,
  resolveModelKey,
  describeModelKey,
} from "@/lib/models";
import { Attachment, Message, ResolvedModel, ToolEventRecord } from "@/lib/types";
import { DEFAULT_CONTEXT_MANAGEMENT } from "@/lib/defaults";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  messageContentForModel,
  readAttachment,
} from "@/lib/attachments";
import { rememberTool } from "@/lib/memory";
import { loadSkillTool } from "@/lib/skills";
import { buildSystemSegments, joinSegments } from "@/lib/systemPrompts";
import { webFetchTool, webSearchTool } from "@/lib/webtools";
import { runToolLoop, ToolEvent, ToolRegistry } from "@/lib/tools";
import { makeContextRuntime } from "@/lib/contextManager";
import { parseTranscript } from "@/lib/transcript";
import * as Icons from "../icons";
import ConfirmDelete from "../ConfirmDelete";
import Markdown from "../Markdown";

/**
 * In-flight generation controllers keyed by conversation id, kept at module
 * scope so they survive ChatView remounting (tab switches). This lets a
 * generation continue in the background and still be stoppable when you return
 * to the conversation, and prevents a remounted view from losing the handle.
 */
const convControllers = new Map<string, AbortController>();

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
  const setConversationWebTools = useMimir((s) => s.setConversationWebTools);

  const [loads, setLoads] = useState<EndpointLoad[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  // Whether THIS conversation is generating. Sourced from the store so it
  // survives ChatView remounting on tab switches (the loop runs to completion
  // in the background regardless of which conversation is on screen).
  const streaming = useMimir((s) => !!s.streamingConvs[conversationId]);
  const setConvStreaming = useMimir((s) => s.setConvStreaming);
  const [streamError, setStreamError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const models = useMemo(
    () =>
      modelsForModality(
        resolveEnabledModels(loads, settings.disabledModels),
        settings.endpoints,
        "text"
      ),
    [loads, settings.disabledModels, settings.endpoints]
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

      setConvStreaming(conversationId, true);
      const controller = new AbortController();
      convControllers.set(conversationId, controller);

      // Build the tool registry from current settings. A tool only appears if
      // its master switch is on; the two web tools additionally require this
      // conversation's web toggle to be on (defaults to on once enabled).
      const toolSettings = state.settings.tools;
      const webOn = current?.webToolsEnabled ?? true;
      const registry: ToolRegistry = {};

      if (toolSettings.builtins.remember) {
        registry.remember = rememberTool((content, category) => {
          addMemory(content, { category, source: "auto" });
        });
      }
      if (toolSettings.builtins.loadSkill) {
        registry.load_skill = loadSkillTool((name) => {
          const match = Object.values(useMimir.getState().skills).find(
            (s) => s.name === name
          );
          return match ?? null;
        });
      }
      if (toolSettings.webSearch.enabled && webOn) {
        registry.web_search = webSearchTool(toolSettings.webSearch);
      }
      if (toolSettings.webFetch.enabled && webOn) {
        registry.web_fetch = webFetchTool(toolSettings.webFetch);
      }

      const segments = buildSystemSegments({
        systemPrompts: Object.values(useMimir.getState().systemPrompts),
        memories: Object.values(useMimir.getState().memories),
        skills: Object.values(useMimir.getState().skills),
      });
      const system = joinSegments(segments);

      let thinkStartedAt: number | null = null;
      let thinkingMs = 0;
      let sawThinkOpen = false;
      let sawThinkClose = false;
      let interrupted = false;

      const lastUserText =
        [...history].reverse().find((m) => m.role === "user")?.content;
      const context = makeContextRuntime({
        endpoint: resolved.url,
        apiKey: resolved.apiKey,
        model: resolved.modelId,
        settings:
          state.settings.contextManagement ?? DEFAULT_CONTEXT_MANAGEMENT,
        taskContext: () => lastUserText,
        signal: controller.signal,
      });

      try {
        const result = await runToolLoop(
          {
            endpoint: resolved.url,
            apiKey: resolved.apiKey,
            model: resolved.modelId,
            messages: history.map((m) => ({
              role: m.role,
              content: messageContentForModel(m),
            })),
            system,
            registry,
            context,
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
            // Upsert by index so a tool's pending chip is replaced in place by
            // its finished chip (rather than appended as a duplicate).
            const next = existing.some((e) => e.index === event.index)
              ? existing.map((e) => (e.index === event.index ? event : e))
              : [...existing, event];
            patchMessage(conversationId, assistantMessage.id, {
              toolEvents: next,
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
            thinkingMs: thinkingMs || undefined,
          },
        });

        // Fold this completed generation into the persistent usage ledger (one
        // billed response). Keyed the same way the Usage view keys this message,
        // so it survives the conversation being deleted. Only the success path
        // records — an interrupted generation has no token counts.
        useMimir.getState().recordUsage(
          current?.model ?? "unknown",
          result.meta.promptTokens ?? 0,
          result.meta.completionTokens ?? 0
        );
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
              thinkingMs: thinkingMs || undefined,
            },
          });
        }
        // Only clear the flag/controller if this run still owns them — a newer
        // run for the same conversation may have replaced them.
        if (convControllers.get(conversationId) === controller) {
          convControllers.delete(conversationId);
          setConvStreaming(conversationId, false);
        }
      }
    },
    [conversationId, appendMessage, patchMessage, addMemory, setConvStreaming]
  );

  const send = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      const trimmed = text.trim();
      const hasAttachments = !!attachments && attachments.length > 0;
      // Allow sending with only attachments (no typed text).
      if ((!trimmed && !hasAttachments) ||
        useMimir.getState().streamingConvs[conversationId])
        return;

      const userMessage: Message = {
        id: uid("msg_"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
        attachments: hasAttachments ? attachments : undefined,
      };

      const before = useMimir.getState().conversations[conversationId];
      appendMessage(conversationId, userMessage);

      if (before && before.messages.length === 0) {
        // Title from the typed text, or the first attachment's name if the
        // message was attachment-only.
        const basis =
          trimmed || (hasAttachments ? attachments![0].name : "");
        if (basis) {
          setConversationTitle(
            conversationId,
            basis.length > 42 ? basis.slice(0, 42) + "…" : basis
          );
        }
      }

      await runCompletion([...(before?.messages ?? []), userMessage]);
    },
    [conversationId, appendMessage, setConversationTitle, runCompletion]
  );

  const resend = useCallback(
    async (messageId: string) => {
      if (useMimir.getState().streamingConvs[conversationId]) return;
      truncateAfterMessage(conversationId, messageId);
      const current = useMimir.getState().conversations[conversationId];
      if (!current) return;
      await runCompletion(current.messages);
    },
    [conversationId, truncateAfterMessage, runCompletion]
  );

  const editMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (useMimir.getState().streamingConvs[conversationId] || !newContent.trim())
        return;

      // Remove everything after the target message
      truncateAfterMessage(conversationId, messageId);
      // Replace the target message content
      patchMessage(conversationId, messageId, { content: newContent.trim() });

      const current = useMimir.getState().conversations[conversationId];
      if (!current) return;
      await runCompletion(current.messages);
    },
    [conversationId, truncateAfterMessage, patchMessage, runCompletion]
  );

  const stop = useCallback(() => {
    convControllers.get(conversationId)?.abort();
  }, [conversationId]);

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

  // Web tools state for the input-bar toggle. "Available" means at least one
  // web tool is enabled globally in the Tools window; "on" is this
  // conversation's switch (defaults on once available).
  const webToolsAvailable =
    settings.tools.webSearch.enabled || settings.tools.webFetch.enabled;
  const webToolsOn = conversation.webToolsEnabled ?? true;

  return (
    <div className="flex h-full flex-col pb-3">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2.5 md:gap-3 md:px-5">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600 sm:inline">
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
          <span className="truncate font-mono text-xs text-parchment-600">
            {noEndpoints ? "no endpoints configured" : "no models available"}
          </span>
        )}
        {(noModels || noEndpoints) && (
          <button
            onClick={() => openWindow("settings")}
            className="ml-auto shrink-0 text-xs text-bronze-300 hover:underline"
          >
            Open Settings →
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
          <div className="mx-auto flex max-w-4xl flex-col gap-6 px-3 py-5 md:px-5 md:py-6">
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
                // Edit props
                canEdit={m.role === "user"}
                isEditing={editingMsgId === m.id}
                editDraft={editDraft}
                onStartEdit={(id, content) => { setEditingMsgId(id); setEditDraft(content); }}
                onDraftChange={setEditDraft}
                onSubmitEdit={() => {
                  if (editingMsgId) editMessage(editingMsgId, editDraft);
                  setEditingMsgId(null);
                }}
                onCancelEdit={() => setEditingMsgId(null)}
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
            <Icons.IconChevron className="h-4 w-4" />
          </button>
        )}
      </div>

      <ChatInput
        streaming={streaming}
        onSend={send}
        onStop={stop}
        onResize={() => scrollToBottom()}
        webToolsAvailable={webToolsAvailable}
        webToolsOn={webToolsOn}
        onToggleWebTools={() =>
          setConversationWebTools(conversationId, !webToolsOn)
        }
        onOpenTools={() => openWindow("tools")}
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
    <div className="flex min-w-0 items-center gap-2">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 max-w-[55vw] rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-parchment-100 md:max-w-[20rem]"
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
                        canEdit,
                        isEditing,
                        editDraft,
                        onStartEdit,
                        onDraftChange,
                        onSubmitEdit,
                        onCancelEdit,
                      }: {
    message: Message;
    isStreaming: boolean;
    onDelete: (id: string) => void;
    onResend?: (id: string) => void;
    canEdit?: boolean;
    isEditing?: boolean;
    editDraft?: string;
    onStartEdit?: (id: string, content: string) => void;
    onDraftChange?: (val: string) => void;
    onSubmitEdit?: () => void;
    onCancelEdit?: () => void;
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
      <div className={["group flex flex-col gap-1", isUser ? "items-end" : "items-start"].join(" ")}>
        <div
          className={[
            "max-w-[92%] min-w-0 md:max-w-[88%] h-full rounded-lg px-4 py-2.5",
            isUser
              ? "whitespace-pre-wrap bg-bronze-600/20 text-sm leading-relaxed text-parchment-100"
              : "w-full border border-ink-700 bg-ink-900 text-parchment-100", isEditing ? "w-[40rem]" : ""
          ].join(" ")}
        >
          {isUser ? (
            isEditing && onDraftChange ? (
              <div className="flex w-full flex-col gap-2">
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSubmitEdit?.();
                    }
                  }}
                  className="w-full resize-none max-h-72 [field-sizing:content] rounded-lg border border-bronze-600/50 bg-ink-850 px-4 py-2 text-sm leading-relaxed text-parchment-100 focus:border-bronze-500 focus:outline-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={onCancelEdit}
                    className="rounded px-3 py-1.5 text-sm font-medium text-parchment-600  hover:text-parchment-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onSubmitEdit}
                    disabled={!editDraft?.trim() || isStreaming}
                    className="flex items-center gap-1.5 rounded-md bg-bronze-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-bronze-400 transition-colors disabled:opacity-30"
                  >
                    <Icons.IconSend className="h-4 w-4" /> Resend
                  </button>
                </div>
              </div>
            ) : (
              <span>{message.content}</span>
            )
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
              {isStreaming ? "..." : "(empty response)"}
            </span>
          )}
        </div>

        {/* Attached files (user messages) — shown as read-only chips. */}
        {isUser && !isEditing && message.attachments && message.attachments.length > 0 && (
          <div className="flex max-w-[92%] flex-wrap justify-end gap-1.5 md:max-w-[88%]">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        )}

        {/* Action Toolbar */}
        <div className={["flex items-center gap-1.5 px-1 text-xs text-parchment-600", isUser ? "flex-row-reverse" : ""].join(" ")}>
          {!isUser && !isEditing && <MetaLine meta={message.meta} modelKey={message.model} />}
          <div className={["flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100", isUser ? "flex-row-reverse" : ""].join(" ")}>
            {isEditing && !canEdit && null} {/* No-op for layout */}

            <ActionButton label={copied ? "Copied" : "Copy message"} onClick={copy}>
              {copied ? (
                <Icons.IconCheck className="h-4 w-4 text-signal-ok" />
              ) : (
                <Icons.IconCopy className="h-4 w-4" />
              )}
            </ActionButton>

            {/* Edit Trigger Button */}
            {canEdit && !isEditing && (
              <ActionButton
                label="Edit message"
                onClick={() => onStartEdit?.(message.id, message.content)}
                disabled={isStreaming}
              >
                <Icons.IconPencil className="h-4 w-4" />
              </ActionButton>
            )}

            {onResend && !isEditing && (
              <ActionButton
                label="Resend (regenerates everything after this message)"
                onClick={() => onResend(message.id)}
                disabled={isStreaming}
              >
                <Icons.IconRefresh className="h-4 w-4" />
              </ActionButton>
            )}

            {!isEditing && (
              <ConfirmDelete
                label="Delete message"
                message="Delete?"
                onConfirm={() => onDelete(message.id)}
              />
            )}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.onResend === next.onResend &&
    prev.onDelete === next.onDelete &&
    prev.canEdit === next.canEdit &&
    prev.isEditing === next.isEditing &&
    prev.editDraft === next.editDraft
);

function InterruptedTag({ standalone = false }: { standalone?: boolean }) {
  return (
    <div
      className={[
        "flex items-center gap-1.5 text-xs text-parchment-600",
        standalone ? "" : "mt-2 border-t border-ink-700 pt-2",
      ].join(" ")}
    >
      <Icons.IconStop className="h-4 w-4 text-signal-err" />
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
    parts.push(`${formatTokens(used)} ctx`);
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
                     webToolsAvailable,
                     webToolsOn,
                     onToggleWebTools,
                     onOpenTools,
                   }: {
  streaming: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  onResize: () => void;
  webToolsAvailable: boolean;
  webToolsOn: boolean;
  onToggleWebTools: () => void;
  onOpenTools: () => void;
}) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(0); // count of files currently reading
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastHeight = useRef(0);
  // Depth counter so nested dragenter/dragleave events don't flicker the overlay.
  const dragDepth = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const maxPx = 288; // matches max-h-72
    el.style.height = "auto";
    const full = el.scrollHeight;
    const next = Math.min(full, maxPx);
    el.style.height = `${next}px`;
    el.style.overflowY = full > maxPx ? "auto" : "hidden";
    if (next !== lastHeight.current) {
      lastHeight.current = next;
      onResize();
    }
  }, [value, onResize]);

  // Reflect the attachment row growing/shrinking so the scroll view stays put.
  useEffect(() => {
    onResize();
  }, [attachments.length, attachError, reading, onResize]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setAttachError(null);

    const room = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    if (room <= 0) {
      setAttachError(
        `You can attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`
      );
      return;
    }
    const toRead = list.slice(0, room);
    if (toRead.length < list.length) {
      setAttachError(
        `Only the first ${room} of ${list.length} files were added (limit ${MAX_ATTACHMENTS_PER_MESSAGE} per message).`
      );
    }

    setReading((n) => n + toRead.length);
    for (const file of toRead) {
      try {
        const res = await readAttachment(file, uid);
        if (res.ok) {
          setAttachments((cur) => [...cur, res.attachment]);
        } else {
          setAttachError(res.error);
        }
      } catch (e) {
        setAttachError((e as Error).message || `Could not read ${file.name}.`);
      } finally {
        setReading((n) => n - 1);
      }
    }
  }, [attachments]);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) void addFiles(e.target.files);
    // Reset so picking the same file again re-triggers change.
    e.target.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
  }

  function submit() {
    const text = value.trim();
    if ((!text && attachments.length === 0) || streaming || reading > 0) return;
    onSend(text, attachments.length > 0 ? attachments : undefined);
    setValue("");
    setAttachments([]);
    setAttachError(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
  }

  const canSend = (!!value.trim() || attachments.length > 0) && reading === 0;

  return (
    <div className="px-3 pb-3 pt-1 pb-safe md:px-5 md:pb-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-1.5 flex items-center gap-2 px-1">
          <WebToolsToggle
            available={webToolsAvailable}
            on={webToolsOn}
            onToggle={onToggleWebTools}
            onOpenTools={onOpenTools}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onPickFiles}
          className="hidden"
          aria-hidden
        />

        <div
          className={[
            "relative rounded-xl border bg-ink-850 px-3 py-2 transition-colors",
            dragOver
              ? "border-bronze-500 ring-1 ring-bronze-500/40"
              : "border-ink-700 focus-within:border-bronze-600",
          ].join(" ")}
          onDragEnter={(e) => {
            if (!e.dataTransfer?.types?.includes("Files")) return;
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragOver(false);
          }}
          onDrop={onDrop}
        >
          {(attachments.length > 0 || reading > 0) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <AttachmentChip
                  key={a.id}
                  attachment={a}
                  onRemove={() => removeAttachment(a.id)}
                />
              ))}
              {reading > 0 && (
                <span className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-parchment-400">
                  <span className="h-3 w-3 animate-spin rounded-full border border-bronze-500 border-t-transparent" />
                  Reading {reading} file{reading === 1 ? "" : "s"}…
                </span>
              )}
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100 disabled:opacity-30"
              title="Attach files as context"
              aria-label="Attach files"
            >
              <Icons.IconPaperclip className="h-4 w-4" />
            </button>
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
              placeholder="Message the model…  (attach files with the clip, or drop them here)"
              className="max-h-72 min-h-[2.5rem] flex-1 resize-none overflow-hidden bg-transparent px-1 py-2 text-base leading-relaxed text-parchment-100 placeholder:text-parchment-600 focus:outline-none md:text-sm"
            />
            {streaming ? (
              <button
                onClick={onStop}
                className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-ink-700 text-parchment-100 transition-colors hover:bg-ink-800"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Icons.IconStop />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend}
                className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-bronze-500 text-ink-950 transition-colors hover:bg-bronze-400 disabled:opacity-30"
                title="Send"
                aria-label="Send"
              >
                <Icons.IconSend />
              </button>
            )}
          </div>

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-ink-950/70 text-sm font-medium text-bronze-300">
              Drop files to attach as context
            </div>
          )}
        </div>

        {attachError && (
          <p className="mt-1.5 px-1 text-xs text-signal-err" role="alert">
            {attachError}
          </p>
        )}
      </div>
    </div>
  );
}

/** A compact chip for a pending or sent attachment, with a remove control. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove?: () => void;
}) {
  const meta =
    attachment.kind === "pdf"
      ? `PDF${
          attachment.pages
            ? ` · ${attachment.pages}p`
            : ""
        }`
      : "text";
  return (
    <span
      className="flex max-w-[16rem] items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-parchment-200"
      title={`${attachment.name} (${meta}${
        attachment.truncated ? ", truncated" : ""
      })`}
    >
      <Icons.IconFile className="h-3.5 w-3.5 shrink-0 text-parchment-500" />
      <span className="truncate font-mono">{attachment.name}</span>
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-parchment-600">
        {meta}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 rounded text-parchment-500 transition-colors hover:text-parchment-100"
          title={`Remove ${attachment.name}`}
          aria-label={`Remove ${attachment.name}`}
        >
          <Icons.IconX className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/**
 * The web-search switch that sits above the chat input. Three states:
 *   - web tools enabled globally + on for this chat  → lit (bronze)
 *   - web tools enabled globally + off for this chat → muted, click to enable
 *   - web tools disabled globally                    → "off", click opens Tools
 */
function WebToolsToggle({
                          available,
                          on,
                          onToggle,
                          onOpenTools,
                        }: {
  available: boolean;
  on: boolean;
  onToggle: () => void;
  onOpenTools: () => void;
}) {
  if (!available) {
    return (
      <button
        onClick={onOpenTools}
        title="Web search is off — click to enable it in the Tools window"
        className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-2.5 py-1 text-xs text-parchment-600 transition-colors hover:border-parchment-600 hover:text-parchment-400"
      >
        <Icons.IconGlobe className="h-4 w-4" />
        <span>Web search off</span>
      </button>
    );
  }

  const active = on;
  return (
    <button
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      title={
        active
          ? "Web search on for this conversation — click to turn off"
          : "Web search off for this conversation — click to turn on"
      }
      className={[
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-bronze-600/60 bg-bronze-600/15 text-bronze-300 hover:bg-bronze-600/25"
          : "border-ink-700 bg-ink-850 text-parchment-600 hover:border-parchment-600 hover:text-parchment-400",
      ].join(" ")}
    >
      <Icons.IconGlobe className="h-4 w-4" />
      <span>Web search</span>
      <span
        className={[
          "ml-0.5 inline-block h-1.5 w-1.5 rounded-full",
          active ? "bg-bronze-400" : "bg-ink-700",
        ].join(" ")}
      />
    </button>
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
        <Icons.IconSpark className={["h-4 w-4 text-bronze-400", live ? "mimir-spin" : ""].join(" ")} />
        <span className="font-medium">
          {live ? "Thinking" : "Thought"}
          {durationLabel ? ` · ${durationLabel}` : ""}
        </span>
        <div className="flex-1" />
        <Icons.IconChevron
          className={["h-4 w-4 transition-transform", open ? "" : "-rotate-90"].join(" ")}
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
        <Icons.IconSpark className="h-4 w-4 mimir-spin text-bronze-400" />
        running tool…
      </div>
    );
  }

  // Recursive-summarization pass: a distinct, self-explanatory chip showing the
  // context saved.
  if (event.compaction) {
    return <CompactionChip compaction={event.compaction} />;
  }

  // The tool is still executing: show a spinning chip with what it's doing, so a
  // slow tool (e.g. a web search and any pruning of its result) is visibly in
  // progress rather than looking like generation stalled.
  if (event.pending) {
    const pendingLabel = describeTool(event);
    return (
      <div className="inline-flex max-w-full items-center gap-2 self-start rounded-md border border-bronze-600/40 bg-bronze-600/10 px-2.5 py-1 text-xs">
        <Icons.IconSpark className="h-4 w-4 shrink-0 mimir-spin text-bronze-400" />
        <span className="font-mono text-bronze-300">{event.name}</span>
        {pendingLabel && (
          <span className="truncate text-parchment-400">{pendingLabel}</span>
        )}
        <span className="shrink-0 text-parchment-600">· running…</span>
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
        {event.pruned && (
          <span
            className="flex items-center gap-1 rounded-full border border-bronze-600/50 bg-bronze-600/15 px-1.5 py-0.5 font-mono text-[10px] text-bronze-300"
            title={`Output distilled to save context: ${event.pruned.before.toLocaleString()} → ${event.pruned.after.toLocaleString()} characters (${prunePct(event.pruned)}% smaller)`}
          >
            <Icons.IconSliders className="h-3 w-3" />
            distilled {fmtCount(event.pruned.before)}→{fmtCount(event.pruned.after)} (−{prunePct(event.pruned)}%)
          </span>
        )}
        <Icons.IconChevron
          className={["h-4 w-4 transition-transform", open ? "" : "-rotate-90"].join(" ")}
        />
      </button>
      {open && (
        <div className="border-t border-ink-700 px-2.5 py-3">
          <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-parchment-400">
            {event.result}
          </div>
          {savedContent && (
            <div className="flex mt-2 text-xs items-center gap-2 border-t border-ink-700 pt-3">
              {deleted ? (
                <span className="text-parchment-600">
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
                <span className="text-parchment-600">
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

/** Compact a number for badges: 980 → "980", 8200 → "8.2k". */
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

/** Percent reduction from a prune (before → after), clamped to 0–99. */
function prunePct(p: { before: number; after: number }): number {
  if (p.before <= 0) return 0;
  return Math.min(99, Math.max(0, Math.round(((p.before - p.after) / p.before) * 100)));
}

/**
 * A distinct chip shown when the context manager compacted earlier history into
 * a summary, making it obvious that (and how much) context was reclaimed.
 */
function CompactionChip({
                          compaction,
                        }: {
  compaction: { before: number; after: number };
}) {
  const saved = Math.max(0, compaction.before - compaction.after);
  const pct =
    compaction.before > 0 ? Math.round((saved / compaction.before) * 100) : 0;
  return (
    <div
      className="inline-flex max-w-full items-center gap-2 self-start rounded-md border border-bronze-600/40 bg-bronze-600/10 px-2.5 py-1 text-xs text-parchment-300"
      title={`Earlier conversation summarized: ~${compaction.before.toLocaleString()} → ~${compaction.after.toLocaleString()} tokens`}
    >
      <Icons.IconSliders className="h-4 w-4 shrink-0 text-bronze-400" />
      <span className="font-medium text-bronze-200">Context compacted</span>
      <span className="text-parchment-500">
        ~{fmtCount(compaction.before)} → ~{fmtCount(compaction.after)} tokens
        {saved > 0 ? ` · saved ~${fmtCount(saved)} (${pct}%)` : ""}
      </span>
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
      <span className="flex items-center gap-1.5 text-xs text-signal-err">
        {message}
        <button
          onClick={onConfirm}
          className="rounded px-1 hover:bg-signal-err/20"
          title="Confirm — can't be undone"
        >
          <Icons.IconCheck className="h-4 w-4" />
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
      className="flex items-center gap-1 rounded text-xs text-parchment-400 hover:text-signal-err"
    >
      <Icons.IconTrash className="h-4 w-4" />
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
  if (event.name === "web_search") {
    const q = event.args.query;
    return typeof q === "string"
      ? `searched “${q.length > 40 ? q.slice(0, 40) + "…" : q}”`
      : "searched the web";
  }
  if (event.name === "web_fetch") {
    const u = event.args.url;
    if (typeof u === "string") {
      try {
        return `fetched ${new URL(u).hostname}`;
      } catch {
        return "fetched a page";
      }
    }
    return "fetched a page";
  }
  return "";
}