"use client";

import { useEffect, useRef, useState } from "react";
import { uid, useTalos } from "@/lib/store";
import { listModels, streamChat } from "@/lib/llama";
import { LlamaModel, Message } from "@/lib/types";
import { IconSend, IconStop } from "../icons";

export default function ChatView({ conversationId }: { conversationId: string }) {
  const conversation = useTalos((s) => s.conversations[conversationId]);
  const endpoint = useTalos((s) => s.settings.endpoint);
  const appendMessage = useTalos((s) => s.appendMessage);
  const updateMessageContent = useTalos((s) => s.updateMessageContent);
  const setConversationModel = useTalos((s) => s.setConversationModel);
  const setConversationTitle = useTalos((s) => s.setConversationTitle);
  const openTab = useTalos((s) => s.openTab);

  const [models, setModels] = useState<LlamaModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch available models from the endpoint.
  useEffect(() => {
    let cancelled = false;
    setModelsError(null);
    listModels(endpoint)
      .then((m) => {
        if (cancelled) return;
        setModels(m);
        // Default the conversation to the first model if none is set.
        if (m.length > 0 && !conversation?.model) {
          setConversationModel(conversationId, m[0].id);
        }
      })
      .catch((e) => !cancelled && setModelsError(e.message));
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

  async function send() {
    const text = input.trim();
    if (!text || streaming || !conversation) return;
    if (!conversation.model) {
      setStreamError("Pick a model first — none is selected.");
      return;
    }

    setInput("");
    setStreamError(null);

    const userMessage: Message = {
      id: uid("msg_"),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    appendMessage(conversationId, userMessage);

    // First user message names the conversation.
    if (conversation.messages.length === 0) {
      setConversationTitle(
        conversationId,
        text.length > 42 ? text.slice(0, 42) + "…" : text
      );
    }

    const assistantMessage: Message = {
      id: uid("msg_"),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    appendMessage(conversationId, assistantMessage);

    const history = [...conversation.messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let acc = "";
      for await (const token of streamChat({
        endpoint,
        model: conversation.model,
        messages: history,
        signal: controller.signal,
      })) {
        acc += token;
        updateMessageContent(conversationId, assistantMessage.id, acc);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setStreamError((e as Error).message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
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
            onClick={() => openTab("settings")}
            className="ml-auto text-xs text-bronze-300 hover:underline"
          >
            Check endpoint in Settings →
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6">
          {conversation.messages.length === 0 && (
            <p className="pt-16 text-center text-sm text-parchment-600">
              Send a message to begin. The full conversation is kept on this
              machine.
            </p>
          )}
          {conversation.messages.map((m) => (
            <MessageBubble key={m.id} message={m} streaming={streaming} />
          ))}
          {streamError && (
            <div className="rounded-md border border-signal-err/40 bg-signal-err/10 px-3 py-2 text-sm text-signal-err">
              {streamError}
            </div>
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

function MessageBubble({
  message,
  streaming,
}: {
  message: Message;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-bronze-600/20 text-parchment-100"
            : "border border-ink-700 bg-ink-900 text-parchment-100",
        ].join(" ")}
      >
        {message.content || (
          <span className="text-parchment-600">
            {streaming ? "▍" : "(empty response)"}
          </span>
        )}
      </div>
    </div>
  );
}
