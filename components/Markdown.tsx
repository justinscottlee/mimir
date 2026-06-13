"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { buildArtifactDoc } from "@/lib/artifactTheme";
import { IconCheck, IconCopy } from "./icons";

/**
 * Two distinct behaviors, chosen explicitly by the fence's language tag:
 *
 *   ```html / ```svg / ```xml      -> CODE. Shown as source (collapsible).
 *   ```html-preview / ```svg-preview -> ARTIFACT. Rendered live by default,
 *                                       no code view. Use this only when the
 *                                       artifact is meant to be interacted
 *                                       with in the chat.
 *
 * This keeps "generate some HTML for me" (plain ```html) cleanly separate
 * from "build me a live widget" (```html-preview), so nothing renders by
 * accident.
 */
const PREVIEW_SUFFIX = "-preview";
const PREVIEWABLE_BASE = new Set(["html", "svg", "xml"]);

/** Collapsed code blocks taller than this (px) show an Expand button. */
const COLLAPSED_MAX_HEIGHT = 320;

export default function Markdown({ content }: { content: string }) {
  return (
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
            const code = String(child?.props?.children ?? "").replace(/\n$/, "");

            const isArtifact =
              lang.endsWith(PREVIEW_SUFFIX) &&
              PREVIEWABLE_BASE.has(lang.slice(0, -PREVIEW_SUFFIX.length));

            if (isArtifact) {
              return <Artifact code={code} />;
            }
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** A live, themed web artifact rendered in a sandboxed iframe. No code view. */
function Artifact({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);

  // Auto-size the iframe to its content where possible (same-origin srcDoc
  // is readable here because we don't set allow-same-origin, but height via
  // postMessage is the robust path; we fall back to a sensible default).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    function onLoad() {
      try {
        const doc = frame!.contentDocument;
        if (doc) {
          const h = doc.body.scrollHeight;
          if (h > 0) setHeight(Math.min(720, Math.max(160, h + 8)));
        }
      } catch {
        // Sandboxed cross-origin; keep the default height.
      }
    }
    frame.addEventListener("load", onLoad);
    return () => frame.removeEventListener("load", onLoad);
  }, [code]);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-bronze-400" />
        <span className="font-mono text-[11px] text-bronze-300">artifact</span>
        <div className="flex-1" />
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-parchment-600 transition-colors hover:bg-ink-700 hover:text-parchment-100"
          title="Copy artifact source"
        >
          {copied ? (
            <IconCheck className="h-3.5 w-3.5 text-signal-ok" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" />
          )}
          {copied ? "copied" : "source"}
        </button>
      </div>
      <iframe
        ref={frameRef}
        // allow-scripts only: no same-origin, so the artifact can't reach
        // Talos state, cookies, or localStorage.
        sandbox="allow-scripts"
        srcDoc={buildArtifactDoc(code)}
        title="artifact"
        style={{ height }}
        className="w-full bg-ink-950"
      />
    </div>
  );
}

/** Source code block. Tall blocks start collapsed with an Expand toggle. */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // After render, check whether the content is taller than the collapsed cap.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 8);
  }, [code]);

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
        <span className="font-mono text-[11px] text-parchment-600">
          {language}
        </span>
        <div className="flex-1" />
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-parchment-600 transition-colors hover:bg-ink-700 hover:text-parchment-100"
          title="Copy code"
        >
          {copied ? (
            <IconCheck className="h-3.5 w-3.5 text-signal-ok" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" />
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
          // Fade hint that there's more below.
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
