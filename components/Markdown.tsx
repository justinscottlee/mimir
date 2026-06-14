"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { IconCheck, IconCopy } from "./icons";

/** Code blocks taller than this (px) collapse with an Expand button. */
const COLLAPSED_MAX_HEIGHT = 320;

/**
 * While a message is still streaming, code blocks render fully expanded. The
 * collapse measurement only settles once generation finishes — otherwise the
 * block's height crosses the threshold repeatedly as tokens arrive and the
 * Expand/Collapse control flickers.
 */
const StreamingContext = createContext(false);

export default function Markdown({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <StreamingContext.Provider value={isStreaming}>
      <div className="md text-sm leading-relaxed">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre({ children }) {
              const child = (
                Array.isArray(children) ? children[0] : children
              ) as React.ReactElement<{
                className?: string;
                children?: React.ReactNode;
              }>;
              const className = child?.props?.className ?? "";
              const match = /language-([\w-]+)/.exec(className);
              const lang = (match?.[1] ?? "text").toLowerCase();
              const code = String(child?.props?.children ?? "").replace(
                /\n$/,
                ""
              );
              return <CodeBlock language={lang} code={code} />;
            },
            code({ children, ...props }) {
              return (
                <code
                  className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[0.85em] text-bronze-300"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            a({ children, href }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-bronze-300 underline decoration-bronze-600 underline-offset-2 hover:text-bronze-400"
                >
                  {children}
                </a>
              );
            },
            // Tables can be wider than the chat column; give them their own
            // horizontal scroll so they never push the message bubble wider.
            table({ children }) {
              return (
                <div className="md-table-scroll">
                  <table>{children}</table>
                </div>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </StreamingContext.Provider>
  );
}

/** Source code block. Tall blocks collapse with an Expand toggle — but only
 *  once streaming has finished, to avoid flicker while the code is growing. */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const isStreaming = useContext(StreamingContext);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Measure overflow only when not streaming. While streaming we render full
  // height and skip the threshold check entirely.
  useEffect(() => {
    if (isStreaming) {
      setOverflows(false);
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 8);
  }, [code, isStreaming]);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const collapsed = overflows && !expanded;

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-3 py-1.5">
        <span className="font-mono text-xs text-parchment-600">
          {language}
        </span>
        <div className="flex-1" />
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs text-parchment-600 transition-colors hover:bg-ink-700 hover:text-parchment-100"
          title="Copy code"
        >
          {copied ? (
            <IconCheck className="h-4 w-4 text-signal-ok" />
          ) : (
            <IconCopy className="h-4 w-4" />
          )}
          {copied ? "copied" : "copy"}
        </button>
      </div>

      <div
        ref={bodyRef}
        className="relative overflow-auto"
        style={collapsed ? { maxHeight: COLLAPSED_MAX_HEIGHT } : undefined}
      >
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: "12px 16px",
            background: "transparent",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
          codeTagProps={{
            style: { fontFamily: "IBM Plex Mono, ui-monospace, monospace" },
          }}
        >
          {code}
        </SyntaxHighlighter>

        {collapsed && (
          <div className="pointer-events-none sticky bottom-0 h-12 w-full bg-gradient-to-t from-ink-950 to-transparent" />
        )}
      </div>

      {overflows && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full border-t border-ink-700 bg-ink-900 py-1.5 font-mono text-[11px] text-parchment-400 transition-colors hover:bg-ink-850 hover:text-parchment-100"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}
