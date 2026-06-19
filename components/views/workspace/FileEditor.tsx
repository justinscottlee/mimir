"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMimir } from "@/lib/store";
import * as fs from "@/lib/workspace/fs";
import {
  assembleHtmlPreview,
  previewKindFor,
} from "@/lib/workspace/preview";
import Markdown from "@/components/Markdown";
import * as Icons from "@/components/icons";

/**
 * A text editor for a single sandbox file, with a live preview for the file
 * types where one helps: HTML (rendered in a sandboxed iframe with its CSS,
 * scripts, and images inlined from the workspace), Markdown, and SVG. The store
 * is the source of truth: opening a file seeds the editor from it, and saving
 * writes back through the same fs ops the agent uses. While the user hasn't made
 * edits, external writes (e.g. the agent editing this file mid-run) flow in
 * live; once the user has unsaved changes we stop clobbering them and flag that
 * the file moved underneath instead.
 */
export default function FileEditor({
  workspaceId,
  path,
  onClose,
}: {
  workspaceId: string;
  path: string;
  onClose: () => void;
}) {
  const file = useMimir((s) =>
    s.workspaces[workspaceId]?.files.find((f) => f.path === path)
  );
  const filesRef = useMimir((s) => s.workspaces[workspaceId]?.files ?? []);
  const setFiles = useMimir((s) => s.setWorkspaceFiles);

  const [draft, setDraft] = useState(file?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [externallyChanged, setExternallyChanged] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const previewKind = previewKindFor(path);

  // Reset when switching files.
  useEffect(() => {
    setDraft(file?.content ?? "");
    setDirty(false);
    setExternallyChanged(false);
    // A non-previewable file can only be edited; don't strand the user in a
    // preview tab that no longer applies.
    if (!previewKindFor(path)) setMode("edit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Reflect external writes when the user hasn't started editing.
  const storeContent = file?.content;
  useEffect(() => {
    if (storeContent == null) return;
    if (!dirty) {
      setDraft(storeContent);
    } else if (storeContent !== draft) {
      setExternallyChanged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeContent]);

  // Build the preview from the *draft* so it tracks unsaved edits live. For HTML
  // we resolve sibling assets from the live filesystem (with the current file's
  // draft substituted in) so its CSS/JS/images render.
  const previewHtml = useMemo(() => {
    if (previewKind !== "html") return "";
    const withDraft = fs.writeFile(filesRef, path, draft).files;
    return assembleHtmlPreview(withDraft, path).html;
  }, [previewKind, filesRef, path, draft]);

  const previewMissing = useMemo(() => {
    if (previewKind !== "html") return [];
    const withDraft = fs.writeFile(filesRef, path, draft).files;
    return assembleHtmlPreview(withDraft, path).missing;
  }, [previewKind, filesRef, path, draft]);

  const save = useCallback(() => {
    if (!file) return;
    const next = fs.writeFile(filesRef, path, draft).files;
    setFiles(workspaceId, next);
    setDirty(false);
    setExternallyChanged(false);
  }, [file, filesRef, path, draft, setFiles, workspaceId]);

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  }

  function revert() {
    setDraft(file?.content ?? "");
    setDirty(false);
    setExternallyChanged(false);
  }

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Icons.IconFile className="h-8 w-8 text-parchment-600" />
        <div className="text-sm text-parchment-400">
          <span className="font-mono text-parchment-100">{path}</span> no longer
          exists.
        </div>
        <button
          onClick={onClose}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
        >
          Close
        </button>
      </div>
    );
  }

  // Binary files can't be edited as text — show a viewer (image preview when we
  // can, otherwise a size summary) rather than dumping base64 into a textarea.
  if (fs.isBinary(file)) {
    return <BinaryFileView path={path} content={file.content} bytes={fs.byteLength(file)} />;
  }

  const lines = fs.lineCount(draft);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Icons.IconFile className="h-4 w-4 shrink-0 text-parchment-600" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-parchment-100">
          {path}
          {dirty && <span className="ml-1 text-bronze-400">•</span>}
        </span>
        {/* Edit / Preview toggle, only for file types with a preview. */}
        {previewKind && (
          <div className="flex items-center rounded-md border border-ink-700 p-0.5">
            <ModeTab
              label="Edit"
              active={mode === "edit"}
              onClick={() => setMode("edit")}
            />
            <ModeTab
              label="Preview"
              active={mode === "preview"}
              onClick={() => setMode("preview")}
            />
          </div>
        )}
        {dirty && (
          <button
            onClick={revert}
            className="rounded-md px-2 py-1 text-xs text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
          >
            Revert
          </button>
        )}
        <button
          onClick={save}
          disabled={!dirty}
          className="rounded-md border border-bronze-600/60 bg-bronze-600/15 px-2.5 py-1 text-xs font-medium text-bronze-300 transition-colors hover:bg-bronze-600/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </div>

      {externallyChanged && (
        <div className="flex items-center gap-2 border-b border-bronze-600/40 bg-bronze-600/10 px-3 py-1.5 text-[11px] text-bronze-300">
          <Icons.IconSpark className="h-3.5 w-3.5" />
          The agent changed this file while you were editing. Saving overwrites
          its version;
          <button onClick={revert} className="underline hover:text-bronze-300">
            load theirs
          </button>
          .
        </div>
      )}

      {mode === "preview" && previewKind ? (
        <Preview
          kind={previewKind}
          html={previewHtml}
          markdown={draft}
          missing={previewMissing}
        />
      ) : (
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          wrap="off"
          className="min-h-0 flex-1 resize-none bg-ink-950 px-4 py-3 font-mono text-sm leading-relaxed text-parchment-100 placeholder:text-parchment-600 focus:outline-none"
          placeholder="Empty file. Start typing…"
        />
      )}

      <div className="border-t border-ink-700 px-3 py-1.5 font-mono text-[10px] text-parchment-600">
        {lines} lines · {fs.humanSize(draft)}
        {dirty ? " · unsaved" : " · saved"}
      </div>
    </div>
  );
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded px-2 py-0.5 text-xs transition-colors",
        active
          ? "bg-ink-800 text-parchment-100"
          : "text-parchment-600 hover:text-parchment-100",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

const IMAGE_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

/**
 * Viewer for a binary (base64) file. Images render from a base64 data URL on a
 * checkerboard so transparency shows; everything else gets a short summary —
 * the bytes are safe in the store and downloadable from the file explorer, they
 * just aren't text to edit.
 */
function BinaryFileView({
  path,
  content,
  bytes,
}: {
  path: string;
  content: string;
  bytes: number;
}) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const imageMime = IMAGE_EXT[ext];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Icons.IconFile className="h-4 w-4 shrink-0 text-parchment-600" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-parchment-100">
          {path}
        </span>
        <span className="rounded border border-ink-700 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-parchment-600">
          binary
        </span>
      </div>

      {imageMime ? (
        <div className="mimir-checker flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${imageMime};base64,${content.replace(/\s+/g, "")}`}
            alt={path}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Icons.IconFile className="h-10 w-10 text-parchment-600" />
          <div className="text-sm text-parchment-300">
            Binary file — {fs.humanBytes(bytes)}
          </div>
          <div className="max-w-sm text-xs leading-relaxed text-parchment-600">
            This file isn&apos;t text, so there&apos;s nothing to edit here. Use
            the download button in the file explorer to save it.
          </div>
        </div>
      )}

      <div className="border-t border-ink-700 px-3 py-1.5 font-mono text-[10px] text-parchment-600">
        {fs.humanBytes(bytes)} · binary ({ext || "no ext"})
      </div>
    </div>
  );
}

/**
 * The rendered preview pane. HTML renders in a sandboxed iframe (scripts allowed
 * but no same-origin access, so it can't reach the app or network credentials);
 * Markdown uses the same renderer as chat; SVG is shown on a checkerboard so
 * transparency is visible.
 */
function Preview({
  kind,
  html,
  markdown,
  missing,
}: {
  kind: "html" | "markdown" | "svg";
  html: string;
  markdown: string;
  missing: string[];
}) {
  if (kind === "markdown") {
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-ink-950 px-5 py-4">
        <Markdown content={markdown} />
      </div>
    );
  }

  if (kind === "svg") {
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      markdown
    )}`;
    return (
      <div className="mimir-checker min-h-0 flex-1 overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="SVG preview" className="max-w-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {missing.length > 0 && (
        <div className="border-b border-bronze-600/40 bg-bronze-600/10 px-3 py-1.5 text-[11px] text-bronze-300">
          {missing.length} referenced asset
          {missing.length === 1 ? "" : "s"} not found in the workspace:{" "}
          <span className="font-mono">{missing.slice(0, 4).join(", ")}</span>
          {missing.length > 4 ? ", …" : ""}
        </div>
      )}
      <iframe
        title="HTML preview"
        srcDoc={html}
        sandbox="allow-scripts allow-popups allow-forms allow-modals"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
