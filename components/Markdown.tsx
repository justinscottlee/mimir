"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { IconCheck, IconCopy } from "./icons";

/** Languages that can be rendered live as an artifact preview. */
const PREVIEWABLE = new Set(["html", "svg", "xml"]);

export default function Markdown({ content }: { content: string }) {
  return (
    <div className="md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Block code arrives wrapped in <pre><code class="language-x">.
          // Intercept at the <pre> level so we control the whole block.
          pre({ children }) {
            const child = (
              Array.isArray(children) ? children[0] : children
            ) as React.ReactElement<{
              className?: string;
              children?: React.ReactNode;
            }>;
            const className = child?.props?.className ?? "";
            const match = /language-([\w-]+)/.exec(className);
            const code = String(child?.props?.children ?? "").replace(
              /\n$/,
              ""
            );
            return <CodeBlock language={match?.[1] ?? "text"} code={code} />;
          },
          code({ children, ...props }) {
            // Only inline code reaches here (blocks are handled in `pre`).
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

function CodeBlock({ language, code }: { language: string; code: string }) {
  const previewable = PREVIEWABLE.has(language.toLowerCase());
  const [mode, setMode] = useState<"code" | "preview">("code");
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
      {/* Block header */}
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-3 py-1.5">
        <span className="font-mono text-[11px] text-parchment-600">
          {language}
        </span>
        <div className="flex-1" />
        {previewable && (
          <div className="flex overflow-hidden rounded-md border border-ink-700 font-mono text-[11px]">
            <button
              onClick={() => setMode("code")}
              className={
                mode === "code"
                  ? "bg-ink-700 px-2 py-0.5 text-parchment-100"
                  : "px-2 py-0.5 text-parchment-600 hover:text-parchment-100"
              }
            >
              Code
            </button>
            <button
              onClick={() => setMode("preview")}
              className={
                mode === "preview"
                  ? "bg-bronze-600/40 px-2 py-0.5 text-bronze-300"
                  : "px-2 py-0.5 text-parchment-600 hover:text-parchment-100"
              }
            >
              Preview
            </button>
          </div>
        )}
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

      {/* Body */}
      {mode === "preview" && previewable ? (
        <iframe
          // Scripts run, but the sandbox blocks same-origin access, so the
          // artifact can't touch Talos state or localStorage.
          sandbox="allow-scripts"
          srcDoc={code}
          title="artifact preview"
          className="h-96 w-full bg-white"
        />
      ) : (
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
      )}
    </div>
  );
}
