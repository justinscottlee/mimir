"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useMimir } from "@/lib/store";
import { describeModelKey } from "@/lib/models";
import { Folder, TabKind, Tag, TAG_COLORS, TagColor } from "@/lib/types";
import { tagStyle } from "@/lib/tagColors";
import * as Icons from "../icons";
import ConfirmDelete from "../ConfirmDelete";

/**
 * The Library: one window that lists conversations AND workspaces together
 * (they used to be two separate windows). Each row is clearly badged as a Chat
 * or a Workspace. Items can be filed into folders and labeled with color-coded
 * tags — both fully user-defined — and filtered by folder, tag, type, or a text
 * search across titles and contents. Folders and tags are managed inline.
 */

/** A conversation or workspace, normalized into one row shape. */
interface LibItem {
  kind: TabKind; // "chat" | "workspace"
  id: string;
  title: string;
  sortAt: number;
  subtitle: string;
  folderId?: string;
  tagIds: string[];
  pinned: boolean;
  haystack: string;
}

type TypeFilter = "all" | "chat" | "workspace";

export default function LibraryView() {
  const conversations = useMimir((s) => s.conversations);
  const workspaces = useMimir((s) => s.workspaces);
  const settings = useMimir((s) => s.settings);
  const folders = settings.folders;
  const tags = settings.tags;

  const openConversation = useMimir((s) => s.openConversation);
  const openWorkspace = useMimir((s) => s.openWorkspace);
  const deleteConversation = useMimir((s) => s.deleteConversation);
  const deleteWorkspace = useMimir((s) => s.deleteWorkspace);
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);
  const closeWindowByKind = useMimir((s) => s.closeWindowByKind);
  const setConversationTitle = useMimir((s) => s.setConversationTitle);
  const setWorkspaceName = useMimir((s) => s.setWorkspaceName);

  const addFolder = useMimir((s) => s.addFolder);
  const deleteFolder = useMimir((s) => s.deleteFolder);
  const setItemFolder = useMimir((s) => s.setItemFolder);
  const setItemPinned = useMimir((s) => s.setItemPinned);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all"); // "all" | "none" | folderId
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [managingTags, setManagingTags] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  // Build the unified item list once per data change.
  const items = useMemo<LibItem[]>(() => {
    const out: LibItem[] = [];
    for (const c of Object.values(conversations)) {
      out.push({
        kind: "chat",
        id: c.id,
        title: c.title,
        sortAt: c.updatedAt,
        subtitle: `${c.messages.length} message${
          c.messages.length === 1 ? "" : "s"
        }${c.model ? ` · ${describeModelKey(c.model, settings)}` : ""} · ${new Date(
          c.updatedAt
        ).toLocaleDateString()}`,
        folderId: c.folderId,
        tagIds: c.tagIds ?? [],
        pinned: c.pinned ?? false,
        haystack: (
          c.title +
          " " +
          c.messages.map((m) => m.content).join(" ")
        ).toLowerCase(),
      });
    }
    for (const w of Object.values(workspaces)) {
      const fileCount = w.files.filter((f) => f.type === "file").length;
      out.push({
        kind: "workspace",
        id: w.id,
        title: w.name,
        sortAt: w.createdAt,
        subtitle: `${fileCount} file${fileCount === 1 ? "" : "s"} · ${
          w.runs.length
        } run${w.runs.length === 1 ? "" : "s"} · created ${new Date(
          w.createdAt
        ).toLocaleDateString()}`,
        folderId: w.folderId,
        tagIds: w.tagIds ?? [],
        pinned: w.pinned ?? false,
        haystack: (
          w.name +
          " " +
          w.files.map((f) => f.path).join(" ") +
          " " +
          w.runs.map((r) => r.goal).join(" ")
        ).toLowerCase(),
      });
    }
    return out;
  }, [conversations, workspaces, settings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tagList = [...tagFilter];
    return items
      .filter((it) => {
        if (typeFilter !== "all" && it.kind !== typeFilter) return false;
        if (folderFilter === "none" && it.folderId) return false;
        if (folderFilter !== "all" && folderFilter !== "none") {
          if (it.folderId !== folderFilter) return false;
        }
        if (tagList.length && !tagList.every((t) => it.tagIds.includes(t)))
          return false;
        if (q && !it.haystack.includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.sortAt - a.sortAt;
      });
  }, [items, query, typeFilter, folderFilter, tagFilter]);

  // Per-folder counts for the left rail.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let unfiled = 0;
    for (const it of items) {
      if (it.folderId) map.set(it.folderId, (map.get(it.folderId) ?? 0) + 1);
      else unfiled++;
    }
    return { byFolder: map, unfiled, total: items.length };
  }, [items]);

  function open(it: LibItem) {
    if (it.kind === "chat") openConversation(it.id);
    else openWorkspace(it.id);
    closeWindowByKind("library");
  }

  function toggleTagFilter(id: string) {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const empty = items.length === 0;

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail: folders */}
      <div className="flex w-48 shrink-0 flex-col border-r border-ink-700 bg-ink-900/40">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <FolderRow
            label="All items"
            icon={<Icons.IconBox className="h-4 w-4" />}
            count={counts.total}
            active={folderFilter === "all"}
            onClick={() => setFolderFilter("all")}
          />
          <FolderRow
            label="Unfiled"
            icon={<Icons.IconFile className="h-4 w-4" />}
            count={counts.unfiled}
            active={folderFilter === "none"}
            onClick={() => setFolderFilter("none")}
          />
          <div className="my-1.5 h-px bg-ink-700" />
          {folders.length === 0 && (
            <p className="px-2 py-2 text-[11px] leading-relaxed text-parchment-600">
              No folders yet. Create one to group chats and workspaces.
            </p>
          )}
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              label={f.name}
              icon={
                <Icons.IconFolder className="h-4 w-4" style={tagStyle(f.color).text} />
              }
              count={counts.byFolder.get(f.id) ?? 0}
              active={folderFilter === f.id}
              onClick={() => setFolderFilter(f.id)}
              onDelete={() => {
                deleteFolder(f.id);
                if (folderFilter === f.id) setFolderFilter("all");
              }}
            />
          ))}
        </div>
        <div className="border-t border-ink-700 p-2">
          {newFolderOpen ? (
            <NewFolderRow
              onCommit={(name, color) => {
                if (name.trim()) addFolder(name, color);
                setNewFolderOpen(false);
              }}
              onCancel={() => setNewFolderOpen(false)}
            />
          ) : (
            <button
              onClick={() => setNewFolderOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconPlus className="h-3.5 w-3.5" /> New folder
            </button>
          )}
        </div>
      </div>

      {/* Right: search, filters, list */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-ink-700 p-3">
          <div className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 focus-within:border-bronze-600">
            <Icons.IconSearch className="h-4 w-4 text-parchment-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats & workspaces…"
              className="flex-1 bg-transparent text-base text-parchment-100 placeholder:text-parchment-600 focus:outline-none md:text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-xs text-parchment-600 hover:text-parchment-100"
              >
                clear
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <SegBtn
              label="All"
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
            />
            <SegBtn
              label="Chats"
              icon={<Icons.IconChat className="h-3.5 w-3.5" />}
              active={typeFilter === "chat"}
              onClick={() => setTypeFilter("chat")}
            />
            <SegBtn
              label="Workspaces"
              icon={<Icons.IconBox className="h-3.5 w-3.5" />}
              active={typeFilter === "workspace"}
              onClick={() => setTypeFilter("workspace")}
            />
            <div className="flex-1" />
            <button
              onClick={() => {
                newConversation();
                closeWindowByKind("library");
              }}
              className="flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-xs text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconChat className="h-3.5 w-3.5" /> New chat
            </button>
            <button
              onClick={() => {
                newWorkspace();
                closeWindowByKind("library");
              }}
              className="flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-xs text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconBox className="h-3.5 w-3.5" /> New workspace
            </button>
          </div>

          {/* Tag filter + management */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Icons.IconTag className="h-3.5 w-3.5 text-parchment-600" />
            {tags.length === 0 ? (
              <span className="text-[11px] text-parchment-600">No tags yet</span>
            ) : (
              tags.map((t) => {
                const on = tagFilter.has(t.id);
                const c = tagStyle(t.color);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTagFilter(t.id)}
                    style={on ? c.chipActive : c.chip}
                    className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={c.dot} />
                    {t.label}
                  </button>
                );
              })
            )}
            <button
              onClick={() => setManagingTags((v) => !v)}
              className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-parchment-600 hover:bg-ink-800 hover:text-parchment-100"
            >
              {managingTags ? "done" : "manage tags"}
            </button>
          </div>

          {managingTags && <TagManager />}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {empty ? (
            <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center">
              <p className="text-sm text-parchment-600">
                Nothing here yet — start a chat or a workspace.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  onClick={() => {
                    newConversation();
                    closeWindowByKind("library");
                  }}
                  className="rounded-md bg-bronze-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-bronze-400"
                >
                  New conversation
                </button>
                <button
                  onClick={() => {
                    newWorkspace();
                    closeWindowByKind("library");
                  }}
                  className="rounded-md border border-ink-700 px-4 py-2 text-sm font-medium text-parchment-200 hover:bg-ink-800"
                >
                  New workspace
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-parchment-600">
              Nothing matches your filters.
            </div>
          ) : (
            <ul className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700">
              {filtered.map((it) => (
                <ItemRow
                  key={`${it.kind}:${it.id}`}
                  item={it}
                  folders={folders}
                  tags={tags}
                  onOpen={() => open(it)}
                  onTogglePin={() =>
                    setItemPinned(it.kind, it.id, !it.pinned)
                  }
                  onMoveFolder={(fid) => setItemFolder(it.kind, it.id, fid)}
                  onRename={(title) =>
                    it.kind === "chat"
                      ? setConversationTitle(it.id, title)
                      : setWorkspaceName(it.id, title)
                  }
                  onDelete={() =>
                    it.kind === "chat"
                      ? deleteConversation(it.id)
                      : deleteWorkspace(it.id)
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- left rail ------------------------------- */

function FolderRow({
  label,
  icon,
  count,
  active,
  onClick,
  onDelete,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={[
        "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-ink-800 text-parchment-100"
          : "text-parchment-400 hover:bg-ink-850 hover:text-parchment-100",
      ].join(" ")}
      onClick={onClick}
    >
      <span className="text-parchment-600">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[10px] text-parchment-600">{count}</span>
      {onDelete && (
        <ConfirmDelete
          label={`Delete folder ${label}`}
          message="Delete folder? Items move to Unfiled."
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}

function NewFolderRow({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string, color: TagColor) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("bronze");
  return (
    <div className="rounded-md border border-bronze-600/50 bg-ink-850 p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(name, color);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Folder name"
        className="mb-1.5 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
      />
      <ColorPicker value={color} onChange={setColor} />
      <div className="mt-1.5 flex justify-end gap-1">
        <button
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-[11px] text-parchment-600 hover:text-parchment-100"
        >
          Cancel
        </button>
        <button
          onClick={() => onCommit(name, color)}
          className="rounded bg-bronze-500 px-2 py-0.5 text-[11px] font-medium text-ink-950 hover:bg-bronze-400"
        >
          Create
        </button>
      </div>
    </div>
  );
}

/* ------------------------------- tag manager ----------------------------- */

function TagManager() {
  const tags = useMimir((s) => s.settings.tags);
  const addTag = useMimir((s) => s.addTag);
  const updateTag = useMimir((s) => s.updateTag);
  const deleteTag = useMimir((s) => s.deleteTag);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TagColor>("blue");

  return (
    <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 p-2.5">
      <div className="mb-2 flex flex-col gap-1.5">
        {tags.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <ColorPicker
              value={t.color}
              onChange={(c) => updateTag(t.id, { color: c })}
              compact
            />
            <input
              value={t.label}
              onChange={(e) => updateTag(t.id, { label: e.target.value })}
              className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
            />
            <ConfirmDelete
              label={`Delete tag ${t.label}`}
              message="Delete tag? It's removed from all items."
              onConfirm={() => deleteTag(t.id)}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-ink-700 pt-2">
        <ColorPicker value={color} onChange={setColor} compact />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) {
              addTag(label, color);
              setLabel("");
            }
          }}
          placeholder="New tag label"
          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
        />
        <button
          onClick={() => {
            if (label.trim()) {
              addTag(label, color);
              setLabel("");
            }
          }}
          className="rounded bg-bronze-500 px-2 py-1 text-[11px] font-medium text-ink-950 hover:bg-bronze-400"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
  compact,
}: {
  value: TagColor;
  onChange: (c: TagColor) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TAG_COLORS.map((c) => {
        const cc = tagStyle(c);
        const sel = c === value;
        return (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            aria-label={c}
            style={cc.dot}
            className={[
              "rounded-full transition-transform",
              compact ? "h-4 w-4" : "h-5 w-5",
              sel ? "ring-2 ring-parchment-100 ring-offset-1 ring-offset-ink-900" : "",
            ].join(" ")}
          />
        );
      })}
    </div>
  );
}

/* -------------------------------- item row ------------------------------- */

function ItemRow({
  item,
  folders,
  tags,
  onOpen,
  onTogglePin,
  onMoveFolder,
  onRename,
  onDelete,
}: {
  item: LibItem;
  folders: Folder[];
  tags: Tag[];
  onOpen: () => void;
  onTogglePin: () => void;
  onMoveFolder: (folderId: string | null) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const toggleItemTag = useMimir((s) => s.toggleItemTag);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const itemTags = tags.filter((t) => item.tagIds.includes(t.id));

  function beginRename() {
    setDraft(item.title);
    setRenaming(true);
  }
  function commitRename() {
    const t = draft.trim();
    if (t && t !== item.title) onRename(t);
    setRenaming(false);
  }

  return (
    <li
      className="group flex cursor-pointer items-center gap-3 bg-ink-900 px-4 py-3 transition-colors hover:bg-ink-850"
      onClick={() => !renaming && onOpen()}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Type badge */}
      <span
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
          item.kind === "chat"
            ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
            : "border-bronze-600/50 bg-bronze-600/15 text-bronze-300",
        ].join(" ")}
        title={item.kind === "chat" ? "Conversation" : "Workspace"}
      >
        {item.kind === "chat" ? (
          <Icons.IconChat className="h-4 w-4" />
        ) : (
          <Icons.IconBox className="h-4 w-4" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.pinned && (
            <Icons.IconPin className="h-3 w-3 shrink-0 text-bronze-400" />
          )}
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="min-w-0 flex-1 rounded border border-bronze-600 bg-ink-900 px-1.5 py-0.5 text-sm text-parchment-100 focus:outline-none"
            />
          ) : (
            <span className="truncate text-sm text-parchment-100">
              {item.title}
            </span>
          )}
          {!renaming &&
            itemTags.map((t) => {
              const c = tagStyle(t.color);
              return (
                <span
                  key={t.id}
                  style={c.chip}
                  className="flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px]"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={c.dot} />
                  {t.label}
                </span>
              );
            })}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-parchment-600">
          <span className="uppercase tracking-wide">
            {item.kind === "chat" ? "Chat" : "Workspace"}
          </span>{" "}
          · {item.subtitle}
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: r.right, y: r.bottom });
        }}
        aria-label="Item actions"
        className="rounded p-1 text-parchment-600 opacity-0 transition-opacity hover:bg-ink-800 hover:text-parchment-100 focus-within:opacity-100 group-hover:opacity-100"
      >
        <Icons.IconSliders className="h-4 w-4" />
      </button>

      {menu && (
        <ItemMenu
          x={menu.x}
          y={menu.y}
          item={item}
          folders={folders}
          tags={tags}
          onClose={() => setMenu(null)}
          onOpen={onOpen}
          onTogglePin={onTogglePin}
          onMoveFolder={onMoveFolder}
          onToggleTag={(tagId) => toggleItemTag(item.kind, item.id, tagId)}
          onRename={beginRename}
          onDelete={onDelete}
        />
      )}
    </li>
  );
}

function ItemMenu({
  x,
  y,
  item,
  folders,
  tags,
  onClose,
  onOpen,
  onTogglePin,
  onMoveFolder,
  onToggleTag,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  item: LibItem;
  folders: Folder[];
  tags: Tag[];
  onClose: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
  onMoveFolder: (folderId: string | null) => void;
  onToggleTag: (tagId: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 320;
    const m = 8;
    setPos({
      left: Math.max(m, Math.min(x, window.innerWidth - w - m)),
      top: Math.max(m, Math.min(y, window.innerHeight - h - m)),
    });
  }, [x, y]);

  useEffect(() => {
    function onDoc(e: PointerEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-[100] w-60 overflow-hidden rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
    >
      <MenuItem
        icon={item.kind === "chat" ? <Icons.IconChat className="h-4 w-4" /> : <Icons.IconBox className="h-4 w-4" />}
        label="Open"
        onClick={() => {
          onOpen();
          onClose();
        }}
      />
      <MenuItem
        icon={<Icons.IconPin className="h-4 w-4" />}
        label={item.pinned ? "Unpin" : "Pin to top"}
        onClick={() => {
          onTogglePin();
          onClose();
        }}
      />
      <MenuItem
        icon={<Icons.IconPencil className="h-4 w-4" />}
        label="Rename"
        onClick={() => {
          onRename();
          onClose();
        }}
      />

      <div className="my-1 h-px bg-ink-700" />
      <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
        Tags
      </div>
      {tags.length === 0 ? (
        <div className="px-3 py-1 text-[11px] text-parchment-600">
          No tags — create some in “manage tags”.
        </div>
      ) : (
        tags.map((t) => {
          const on = item.tagIds.includes(t.id);
          const c = tagStyle(t.color);
          return (
            <button
              key={t.id}
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() => onToggleTag(t.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-parchment-300 transition-colors hover:bg-ink-800"
            >
              <span className="h-2 w-2 rounded-full" style={c.dot} />
              <span className="flex-1 truncate">{t.label}</span>
              {on && <Icons.IconCheck className="h-4 w-4 text-bronze-300" />}
            </button>
          );
        })
      )}

      <div className="my-1 h-px bg-ink-700" />
      <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
        Move to folder
      </div>
      <button
        role="menuitemradio"
        aria-checked={!item.folderId}
        onClick={() => {
          onMoveFolder(null);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-parchment-300 transition-colors hover:bg-ink-800"
      >
        <Icons.IconFile className="h-4 w-4 text-parchment-600" />
        <span className="flex-1">Top level (unfiled)</span>
        {!item.folderId && <Icons.IconCheck className="h-4 w-4 text-bronze-300" />}
      </button>
      {folders.map((f) => (
        <button
          key={f.id}
          role="menuitemradio"
          aria-checked={item.folderId === f.id}
          onClick={() => {
            onMoveFolder(f.id);
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-parchment-300 transition-colors hover:bg-ink-800"
        >
          <Icons.IconFolder className="h-4 w-4" style={tagStyle(f.color).text} />
          <span className="flex-1 truncate">{f.name}</span>
          {item.folderId === f.id && (
            <Icons.IconCheck className="h-4 w-4 text-bronze-300" />
          )}
        </button>
      ))}

      <div className="my-1 h-px bg-ink-700" />
      {confirmDelete ? (
        <div className="flex items-center gap-3 py-2 pl-4">
          <span className="text-xs font-medium text-signal-err">
            Delete {item.kind === "chat" ? "chat" : "workspace"}?
          </span>
          <button
            onClick={() => {
              onDelete();
              onClose();
            }}
            className="rounded p-0.5 text-signal-err hover:bg-signal-err/20"
            aria-label="Confirm delete"
          >
            <Icons.IconCheck className="h-4 w-4" />
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
            aria-label="Cancel"
          >
            <Icons.IconClose className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <MenuItem
          icon={<Icons.IconTrash className="h-4 w-4" />}
          label={item.kind === "chat" ? "Delete chat" : "Delete workspace"}
          destructive
          onClick={() => setConfirmDelete(true)}
        />
      )}
    </div>,
    document.body
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
        destructive
          ? "text-signal-err hover:bg-signal-err/10"
          : "text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
      ].join(" ")}
    >
      <span className={destructive ? "text-signal-err" : "text-parchment-600"}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function SegBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
        active
          ? "bg-ink-800 text-parchment-100"
          : "text-parchment-600 hover:bg-ink-850 hover:text-parchment-100",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
