"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useMimir } from "@/lib/store";
import { WorkspaceFile } from "@/lib/types";
import * as fs from "@/lib/workspace/fs";
import { downloadWorkspaceZip, zipNameFor } from "@/lib/workspace/download";
import {
  buildUploadFromDataTransfer,
  buildUploadFromFiles,
  UploadNode,
} from "@/lib/workspace/upload";
import * as Icons from "@/components/icons";

/**
 * Custom drag type for *internal* moves (dragging a node onto a folder), so the
 * explorer can tell them apart from an external file/zip upload (which arrives
 * as "Files" on the DataTransfer).
 */
const MOVE_MIME = "application/x-mimir-path";

/** Whether `src` may be moved into directory `destDir`. */
function canDropInto(src: string, destDir: string): boolean {
  if (!src) return false;
  const s = fs.normalizePath(src);
  const d = fs.normalizePath(destDir);
  if (s === d) return false; // onto itself
  if (d === s || d.startsWith(s + "/")) return false; // into itself/descendant
  if (fs.parentPath(s) === d) return false; // already there
  return true;
}

/**
 * File explorer for a workspace's virtual filesystem. Renders the tree, lets you
 * open files into the editor, and — via a right-click context menu modeled on
 * the tab menu — create files/folders (inside the clicked directory or at the
 * root), rename in place, download, and delete. Nodes can also be **dragged to
 * move them**: drop one onto a folder to file it there, or onto the empty area
 * to move it to the root. A small inline composer handles the "new file / new
 * folder" name entry. Every mutation goes through the pure fs ops and writes
 * back to the store, so the agent and the user share one filesystem and one
 * undo-less truth.
 */
export default function FileExplorer({
  workspaceId,
  selectedPath,
  onSelect,
}: {
  workspaceId: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const files = useMimir((s) => s.workspaces[workspaceId]?.files ?? []);
  const workspaceName = useMimir(
    (s) => s.workspaces[workspaceId]?.name ?? "workspace"
  );
  const setFiles = useMimir((s) => s.setWorkspaceFiles);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Internal move drag: which node is being dragged, and the directory ("/" for
  // root) currently hovered as a drop target.
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Depth counter so nested dragenter/leave events don't flicker the overlay.
  const dragDepth = useRef(0);

  // Inline create composer: which kind, and the directory it creates into ("/"
  // for root). Shown as a row under that directory.
  const [creating, setCreating] = useState<{
    kind: "file" | "dir";
    dir: string;
  } | null>(null);
  const [draft, setDraft] = useState("");

  // Inline rename: the path being renamed.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Right-click menu state. `path` is null for the empty-area (root) menu.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    path: string | null;
  } | null>(null);

  const stats = useMemo(() => fs.fsStats(files), [files]);

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function ensureExpanded(dir: string) {
    if (dir === "/") return;
    setCollapsed((prev) => {
      if (!prev.has(dir)) return prev;
      const next = new Set(prev);
      next.delete(dir);
      return next;
    });
  }

  /** Begin creating a file/dir inside `dir` (defaults to root). */
  const beginCreate = useCallback((kind: "file" | "dir", dir: string) => {
    setCreating({ kind, dir });
    setDraft("");
    setError(null);
    if (dir !== "/") ensureExpanded(dir);
  }, []);

  function commitCreate() {
    if (!creating) return;
    const name = draft.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    // A name may itself contain slashes to create nested paths; otherwise it's
    // placed inside the target directory.
    const base = creating.dir === "/" ? "" : creating.dir;
    const full = name.startsWith("/") ? name : `${base}/${name}`;
    try {
      if (creating.kind === "dir") {
        setFiles(workspaceId, fs.makeDir(files, full));
      } else {
        const norm = fs.normalizePath(full);
        if (fs.findNode(files, norm)) {
          onSelect(norm);
        } else {
          setFiles(workspaceId, fs.writeFile(files, norm, "").files);
          onSelect(norm);
        }
      }
      setDraft("");
      setCreating(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function beginRename(path: string) {
    setRenaming(path);
    setRenameDraft(fs.baseName(path));
    setError(null);
  }

  function commitRename() {
    if (!renaming) return;
    const newName = renameDraft.trim();
    const oldName = fs.baseName(renaming);
    if (!newName || newName === oldName) {
      setRenaming(null);
      return;
    }
    const parent = fs.parentPath(renaming);
    const dest = `${parent === "/" ? "" : parent}/${newName}`;
    try {
      const wasSelected =
        selectedPath === renaming ||
        (selectedPath && selectedPath.startsWith(renaming + "/"));
      const { files: next } = fs.movePath(files, renaming, dest);
      setFiles(workspaceId, next);
      const destNorm = fs.normalizePath(dest);
      if (wasSelected) {
        // Re-point the editor at the renamed path (or the moved descendant).
        if (selectedPath === renaming) onSelect(destNorm);
        else if (selectedPath) {
          onSelect(destNorm + selectedPath.slice(renaming.length));
        }
      }
      setRenaming(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Move a node into a directory ("/" = root) via drag-and-drop. */
  function moveInto(src: string, destDir: string) {
    setError(null);
    if (!canDropInto(src, destDir)) return;
    const srcNorm = fs.normalizePath(src);
    const dir = fs.normalizePath(destDir);
    const dest = `${dir === "/" ? "" : dir}/${fs.baseName(srcNorm)}`;
    try {
      const wasSelected =
        selectedPath === srcNorm ||
        (selectedPath && selectedPath.startsWith(srcNorm + "/"));
      const { files: next } = fs.movePath(files, srcNorm, dest);
      setFiles(workspaceId, next);
      const destNorm = fs.normalizePath(dest);
      if (wasSelected) {
        if (selectedPath === srcNorm) onSelect(destNorm);
        else if (selectedPath) onSelect(destNorm + selectedPath.slice(srcNorm.length));
      }
      if (dir !== "/") ensureExpanded(dir);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function remove(path: string) {
    try {
      setFiles(workspaceId, fs.deletePath(files, path).files);
      if (
        selectedPath &&
        (selectedPath === path || selectedPath.startsWith(path + "/"))
      ) {
        onSelect("");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function download(node: WorkspaceFile) {
    // Binary files are stored base64 — decode to real bytes so the download is
    // byte-identical; text files download as UTF-8.
    let blob: Blob;
    if (fs.isBinary(node)) {
      const bin = atob(node.content.replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: "application/octet-stream" });
    } else {
      blob = new Blob([node.content], { type: "text/plain;charset=utf-8" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fs.baseName(node.path) || "file.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Zip a subtree ("/" = whole workspace) and download it.
  const downloadZip = useCallback(
    async (root: string) => {
      setZipping(true);
      setError(null);
      try {
        await downloadWorkspaceZip(files, root, zipNameFor(root, workspaceName));
      } catch (e) {
        setError(`Could not build zip — ${(e as Error).message}`);
      } finally {
        setZipping(false);
      }
    },
    [files, workspaceName]
  );

  const hasFiles = files.some((f) => f.type === "file");

  // Apply uploaded nodes onto the current filesystem (dirs first, then files,
  // each through the same pure fs ops the rest of the explorer uses).
  const applyUpload = useCallback(
    (nodes: UploadNode[]) => {
      const now = Date.now();
      let out = files;
      for (const n of nodes) {
        if (n.type === "dir") out = fs.makeDir(out, n.path, now);
      }
      for (const n of nodes) {
        if (n.type === "file") {
          out = fs.writeFile(out, n.path, n.content, now, n.encoding).files;
        }
      }
      setFiles(workspaceId, out);
    },
    [files, setFiles, workspaceId]
  );

  const summarizeUpload = useCallback(
    (nodeCount: number, skipped: { name: string; reason: string }[]) => {
      if (skipped.length === 0) {
        setNotice(
          nodeCount > 0
            ? `Added ${nodeCount} item${nodeCount === 1 ? "" : "s"}.`
            : "Nothing to add."
        );
      } else {
        const first = skipped[0];
        setNotice(
          `Added ${nodeCount} item${nodeCount === 1 ? "" : "s"}; skipped ${
            skipped.length
          } (${first.name}: ${first.reason}${
            skipped.length > 1 ? ", …" : ""
          }).`
        );
      }
    },
    []
  );

  const uploadFiles = useCallback(
    async (list: FileList | File[]) => {
      setUploading(true);
      setError(null);
      setNotice(null);
      try {
        const { nodes, skipped } = await buildUploadFromFiles(list, "/");
        applyUpload(nodes);
        summarizeUpload(nodes.filter((n) => n.type === "file").length, skipped);
      } catch (e) {
        setError(`Upload failed — ${(e as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [applyUpload, summarizeUpload]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      if (!e.dataTransfer || e.dataTransfer.types.indexOf("Files") === -1)
        return;
      setUploading(true);
      setError(null);
      setNotice(null);
      try {
        const { nodes, skipped } = await buildUploadFromDataTransfer(
          e.dataTransfer,
          "/"
        );
        applyUpload(nodes);
        summarizeUpload(nodes.filter((n) => n.type === "file").length, skipped);
      } catch (err) {
        setError(`Upload failed — ${(err as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [applyUpload, summarizeUpload]
  );

  function onDragEnter(e: React.DragEvent) {
    if (e.dataTransfer?.types?.indexOf("Files") === -1) return;
    dragDepth.current += 1;
    setDragOver(true);
  }
  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }

  function openMenu(e: React.MouseEvent, path: string | null) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path });
  }

  const rootChildren = fs.listDir(files, "/");
  const menuNode = menu?.path ? fs.findNode(files, menu.path) : undefined;
  // The directory a create action from this menu should target: the clicked
  // dir, the clicked file's parent, or root for the empty-area menu.
  const menuTargetDir = !menu?.path
    ? "/"
    : menuNode?.type === "dir"
    ? menu.path!
    : fs.parentPath(menu!.path!);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-ink-700 px-3 py-2">
        <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.2em] text-parchment-600">
          Files
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length) {
              void uploadFiles(e.target.files);
            }
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload files or a .zip into the workspace"
          aria-label="Upload files"
          className="rounded p-1 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {uploading ? (
            <Icons.IconSpark className="h-4 w-4 mimir-spin text-bronze-400" />
          ) : (
            <Icons.IconUpload className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={() => downloadZip("/")}
          disabled={!hasFiles || zipping}
          title="Download the whole workspace as a .zip"
          aria-label="Download all as zip"
          className="rounded p-1 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {zipping ? (
            <Icons.IconSpark className="h-4 w-4 mimir-spin text-bronze-400" />
          ) : (
            <Icons.IconDownload className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={() => beginCreate("file", "/")}
          title="New file"
          aria-label="New file"
          className="rounded p-1 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100"
        >
          <Icons.IconFile className="h-4 w-4" />
        </button>
        <button
          onClick={() => beginCreate("dir", "/")}
          title="New folder"
          aria-label="New folder"
          className="rounded p-1 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100"
        >
          <Icons.IconFolder className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="border-b border-signal-err/30 bg-signal-err/10 px-3 py-1.5 text-[11px] text-signal-err">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-3 py-1.5 text-[11px] text-parchment-400">
          <span className="flex-1">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-parchment-600 hover:text-parchment-100"
            aria-label="Dismiss"
          >
            <Icons.IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Root-level create composer (when targeting "/"). */}
      {creating && creating.dir === "/" && (
        <CreateRow
          kind={creating.kind}
          draft={draft}
          onChange={setDraft}
          onCommit={commitCreate}
          onCancel={() => setCreating(null)}
        />
      )}

      <div
        className="relative min-h-0 flex-1 overflow-y-auto py-1"
        onContextMenu={(e) => openMenu(e, null)}
        onDragEnter={onDragEnter}
        onDragOver={(e) => {
          if (dragPath) {
            // Internal move: dropping on empty space targets the root.
            if (canDropInto(dragPath, "/")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropDir("/");
            }
            return;
          }
          if (e.dataTransfer?.types?.indexOf("Files") !== -1) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          const moving =
            e.dataTransfer.getData(MOVE_MIME) ||
            (e.dataTransfer.types.indexOf("Files") === -1 ? dragPath : null);
          if (moving) {
            e.preventDefault();
            moveInto(moving, "/");
            setDragPath(null);
            setDropDir(null);
            return;
          }
          void onDrop(e);
        }}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-1 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-bronze-500 bg-ink-950/80 text-center">
            <Icons.IconUpload className="h-7 w-7 text-bronze-300" />
            <div className="text-sm font-medium text-parchment-100">
              Drop to upload
            </div>
            <div className="px-6 text-[11px] text-parchment-500">
              Files, folders, and .zip archives are added to the workspace.
            </div>
          </div>
        )}
        {dragPath && dropDir === "/" && !dragOver && (
          <div className="pointer-events-none absolute inset-1 z-10 rounded-lg border-2 border-dashed border-bronze-500/50" />
        )}
        {rootChildren.length === 0 && !creating ? (
          <button
            onContextMenu={(e) => openMenu(e, null)}
            onClick={() => beginCreate("file", "/")}
            className="w-full px-3 py-6 text-center text-xs text-parchment-600 transition-colors hover:text-parchment-400"
          >
            Empty sandbox. Click to create a file, right-click for more, or run
            the agent to populate it.
          </button>
        ) : (
          <Tree
            files={files}
            dir="/"
            depth={0}
            collapsed={collapsed}
            onToggle={toggle}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onContextMenu={openMenu}
            renaming={renaming}
            renameDraft={renameDraft}
            onRenameDraft={setRenameDraft}
            onCommitRename={commitRename}
            onCancelRename={() => setRenaming(null)}
            creating={creating}
            createDraft={draft}
            onCreateDraft={setDraft}
            onCommitCreate={commitCreate}
            onCancelCreate={() => setCreating(null)}
            dragPath={dragPath}
            dropDir={dropDir}
            onDragStartNode={setDragPath}
            onDragEndNode={() => {
              setDragPath(null);
              setDropDir(null);
            }}
            onDropTarget={setDropDir}
            onMoveInto={moveInto}
          />
        )}
      </div>

      <div className="border-t border-ink-700 px-3 py-1.5 font-mono text-[10px] text-parchment-600">
        {stats.files} files · {stats.dirs} dirs · {fs.humanBytes(stats.bytes)}
      </div>

      {menu && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          node={menuNode ?? null}
          targetDir={menuTargetDir}
          onClose={() => setMenu(null)}
          onNewFile={() => beginCreate("file", menuTargetDir)}
          onNewFolder={() => beginCreate("dir", menuTargetDir)}
          onOpen={() => menuNode && onSelect(menuNode.path)}
          onRename={() => menu.path && beginRename(menu.path)}
          onDownload={() => menuNode && download(menuNode)}
          onDownloadZip={() => menuNode && void downloadZip(menuNode.path)}
          onDelete={() => menu.path && remove(menu.path)}
        />
      )}
    </div>
  );
}

/* --------------------------------- tree ---------------------------------- */

interface TreeSharedProps {
  files: WorkspaceFile[];
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string | null) => void;
  renaming: string | null;
  renameDraft: string;
  onRenameDraft: (s: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  creating: { kind: "file" | "dir"; dir: string } | null;
  createDraft: string;
  onCreateDraft: (s: string) => void;
  onCommitCreate: () => void;
  onCancelCreate: () => void;
  /* internal drag-to-move */
  dragPath: string | null;
  dropDir: string | null;
  onDragStartNode: (path: string) => void;
  onDragEndNode: () => void;
  onDropTarget: (dir: string | null) => void;
  onMoveInto: (src: string, destDir: string) => void;
}

function Tree({
  dir,
  depth,
  ...shared
}: TreeSharedProps & { dir: string; depth: number }) {
  const children = fs.listDir(shared.files, dir);
  const showCreateHere =
    shared.creating && shared.creating.dir === dir && dir !== "/";
  return (
    <ul>
      {children.map((node) => (
        <Row key={node.path} node={node} depth={depth} {...shared} />
      ))}
      {showCreateHere && (
        <li>
          <CreateRow
            kind={shared.creating!.kind}
            depth={depth}
            draft={shared.createDraft}
            onChange={shared.onCreateDraft}
            onCommit={shared.onCommitCreate}
            onCancel={shared.onCancelCreate}
          />
        </li>
      )}
    </ul>
  );
}

function Row({
  node,
  depth,
  ...shared
}: TreeSharedProps & { node: WorkspaceFile; depth: number }) {
  const name = fs.baseName(node.path);
  const indent = { paddingLeft: `${0.5 + depth * 0.85}rem` };
  const isDir = node.type === "dir";
  const open = isDir && !shared.collapsed.has(node.path);
  const selected = shared.selectedPath === node.path;
  const isRenaming = shared.renaming === node.path;
  const isDragging = shared.dragPath === node.path;
  const isDropTarget =
    isDir &&
    !!shared.dragPath &&
    shared.dropDir === node.path &&
    canDropInto(shared.dragPath, node.path);

  return (
    <li>
      <div
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(MOVE_MIME, node.path);
          e.dataTransfer.setData("text/plain", node.path);
          e.dataTransfer.effectAllowed = "move";
          shared.onDragStartNode(node.path);
        }}
        onDragEnd={(e) => {
          e.stopPropagation();
          shared.onDragEndNode();
        }}
        onDragOver={
          isDir
            ? (e) => {
                if (shared.dragPath && canDropInto(shared.dragPath, node.path)) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  shared.onDropTarget(node.path);
                }
              }
            : undefined
        }
        onDrop={
          isDir
            ? (e) => {
                const moving =
                  e.dataTransfer.getData(MOVE_MIME) || shared.dragPath;
                if (moving) {
                  e.preventDefault();
                  e.stopPropagation();
                  shared.onMoveInto(moving, node.path);
                  shared.onDragEndNode();
                }
              }
            : undefined
        }
        className={[
          "group flex cursor-pointer items-center gap-1.5 pr-2 text-sm transition-colors",
          isDropTarget
            ? "bg-bronze-600/25 text-parchment-100 ring-1 ring-inset ring-bronze-500/60"
            : selected
            ? "bg-bronze-600/15 text-parchment-100"
            : "text-parchment-400 hover:bg-ink-850",
          isDragging ? "opacity-50" : "",
        ].join(" ")}
        style={indent}
        onClick={() =>
          !isRenaming && (isDir ? shared.onToggle(node.path) : shared.onSelect(node.path))
        }
        onContextMenu={(e) => shared.onContextMenu(e, node.path)}
      >
        <span className="flex h-7 items-center">
          {isDir ? (
            <Icons.IconChevron
              className={[
                "h-3.5 w-3.5 shrink-0 text-parchment-600 transition-transform",
                open ? "" : "-rotate-90",
              ].join(" ")}
            />
          ) : (
            <span className="w-3.5" />
          )}
        </span>
        {isDir ? (
          open ? (
            <Icons.IconFolderOpen className="h-4 w-4 shrink-0 text-bronze-400" />
          ) : (
            <Icons.IconFolder className="h-4 w-4 shrink-0 text-bronze-400" />
          )
        ) : (
          <Icons.IconFile className="h-4 w-4 shrink-0 text-parchment-600" />
        )}

        {isRenaming ? (
          <input
            autoFocus
            value={shared.renameDraft}
            onChange={(e) => shared.onRenameDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={shared.onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") shared.onCommitRename();
              if (e.key === "Escape") shared.onCancelRename();
            }}
            spellCheck={false}
            className="my-0.5 min-w-0 flex-1 rounded border border-bronze-600 bg-ink-900 px-1 py-0.5 font-mono text-xs text-parchment-100 focus:outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate py-1">{name}</span>
        )}

        {!isRenaming && (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                shared.onContextMenu(e, node.path);
              }}
              title="More…"
              aria-label={`Actions for ${name}`}
              className="rounded p-1 text-parchment-600 hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconSliders className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      {isDir && open && (
        <Tree dir={node.path} depth={depth + 1} {...shared} />
      )}
    </li>
  );
}

/* ----------------------------- create composer --------------------------- */

function CreateRow({
  kind,
  depth = 0,
  draft,
  onChange,
  onCommit,
  onCancel,
}: {
  kind: "file" | "dir";
  depth?: number;
  draft: string;
  onChange: (s: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const indent = { paddingLeft: `${0.5 + depth * 0.85}rem` };
  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={indent}
    >
      <span className="w-3.5" />
      {kind === "dir" ? (
        <Icons.IconFolder className="h-4 w-4 shrink-0 text-bronze-400" />
      ) : (
        <Icons.IconFile className="h-4 w-4 shrink-0 text-parchment-400" />
      )}
      <input
        autoFocus
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onCommit}
        placeholder={kind === "dir" ? "folder-name" : "file-name.ext"}
        spellCheck={false}
        className="min-w-0 flex-1 rounded border border-bronze-600 bg-ink-900 px-1.5 py-0.5 font-mono text-xs text-parchment-100 placeholder:text-parchment-600/60 focus:outline-none"
      />
    </div>
  );
}

/* ----------------------------- context menu ------------------------------ */

/**
 * Right-click menu for the files view. Rendered in a portal and clamped to the
 * viewport, mirroring the tab context menu. Shows create actions always (so an
 * empty-area right-click can still make files), plus node-specific actions when
 * a file/folder was clicked. Delete uses an inline confirm.
 */
function FileContextMenu({
  x,
  y,
  node,
  targetDir,
  onClose,
  onNewFile,
  onNewFolder,
  onOpen,
  onRename,
  onDownload,
  onDownloadZip,
  onDelete,
}: {
  x: number;
  y: number;
  node: WorkspaceFile | null;
  targetDir: string;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDownload: () => void;
  onDownloadZip: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useLayoutEffect(() => {
    const el = menuRef.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 240;
    const margin = 8;
    const left = Math.max(margin, Math.min(x, window.innerWidth - w - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - h - margin));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onDocPointer(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const isDir = node?.type === "dir";
  const dirLabel =
    targetDir === "/" ? "root" : fs.baseName(targetDir) + "/";

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-[100] w-56 overflow-hidden rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
    >
      {node && (
        <>
          {!isDir && (
            <MenuItem
              icon={<Icons.IconFile className="h-4 w-4" />}
              label="Open"
              onClick={run(onOpen)}
            />
          )}
          <MenuItem
            icon={<Icons.IconPencil className="h-4 w-4" />}
            label="Rename"
            onClick={run(onRename)}
          />
          {!isDir && (
            <MenuItem
              icon={<Icons.IconDownload className="h-4 w-4" />}
              label="Download"
              onClick={run(onDownload)}
            />
          )}
          {isDir && (
            <MenuItem
              icon={<Icons.IconDownload className="h-4 w-4" />}
              label="Download as zip"
              onClick={run(onDownloadZip)}
            />
          )}
          <div className="my-1 h-px bg-ink-700" />
        </>
      )}

      <MenuItem
        icon={<Icons.IconFile className="h-4 w-4" />}
        label={`New file in ${dirLabel}`}
        onClick={run(onNewFile)}
      />
      <MenuItem
        icon={<Icons.IconFolder className="h-4 w-4" />}
        label={`New folder in ${dirLabel}`}
        onClick={run(onNewFolder)}
      />

      {node && (
        <>
          <div className="my-1 h-px bg-ink-700" />
          {confirmDelete ? (
            <div className="flex items-center gap-3 py-2 pl-4">
              <span className="text-xs font-medium text-signal-err">
                Delete {isDir ? "folder" : "file"}?
              </span>
              <button
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                className="rounded p-0.5 text-signal-err hover:bg-signal-err/20"
                title="Confirm delete"
                aria-label="Confirm delete"
              >
                <Icons.IconCheck className="h-4 w-4" />
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
                title="Cancel"
                aria-label="Cancel delete"
              >
                <Icons.IconClose className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <MenuItem
              icon={<Icons.IconTrash className="h-4 w-4" />}
              label={isDir ? "Delete folder" : "Delete file"}
              destructive
              onClick={() => setConfirmDelete(true)}
            />
          )}
        </>
      )}
    </div>,
    document.body
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-parchment-600/40"
          : destructive
          ? "text-signal-err hover:bg-signal-err/10"
          : "text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
      ].join(" ")}
    >
      <span
        className={
          disabled
            ? "text-parchment-600/40"
            : destructive
            ? "text-signal-err"
            : "text-parchment-600"
        }
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
