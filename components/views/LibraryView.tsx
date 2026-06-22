"use client";

import { useMemo, useState } from "react";
import { useMimir } from "@/lib/store";
import { describeModelKey } from "@/lib/models";
import { Folder, TabKind, Tag, TAG_COLORS, TagColor } from "@/lib/types";
import { tagStyle } from "@/lib/tagColors";
import {
  ContextMenu,
  ContextMenuDelete,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ContextMenu";
import InlineRename from "@/components/InlineRename";
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

type TypeFilter = "all" | "chat" | "workspace" | "image";

/** How the list is ordered (pinned items always float to the top). */
type SortKey = "recent" | "oldest" | "name-asc" | "name-desc";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently updated",
  oldest: "Oldest first",
  "name-asc": "Name (A–Z)",
  "name-desc": "Name (Z–A)",
};

/** Stable selection key for a library item. */
function itemKey(it: { kind: TabKind; id: string }): string {
  return `${it.kind}:${it.id}`;
}

export default function LibraryView() {
  const conversations = useMimir((s) => s.conversations);
  const workspaces = useMimir((s) => s.workspaces);
  const imageStudios = useMimir((s) => s.imageStudios);
  const settings = useMimir((s) => s.settings);
  const folders = settings.folders;
  const tags = settings.tags;

  const openConversation = useMimir((s) => s.openConversation);
  const openWorkspace = useMimir((s) => s.openWorkspace);
  const openImageStudio = useMimir((s) => s.openImageStudio);
  const deleteConversation = useMimir((s) => s.deleteConversation);
  const deleteWorkspace = useMimir((s) => s.deleteWorkspace);
  const deleteImageStudio = useMimir((s) => s.deleteImageStudio);
  const newConversation = useMimir((s) => s.newConversation);
  const newWorkspace = useMimir((s) => s.newWorkspace);
  const newImageStudio = useMimir((s) => s.newImageStudio);
  const closeWindowByKind = useMimir((s) => s.closeWindowByKind);
  const setConversationTitle = useMimir((s) => s.setConversationTitle);
  const setWorkspaceName = useMimir((s) => s.setWorkspaceName);
  const setImageStudioTitle = useMimir((s) => s.setImageStudioTitle);

  const addFolder = useMimir((s) => s.addFolder);
  const deleteFolder = useMimir((s) => s.deleteFolder);
  const setItemFolder = useMimir((s) => s.setItemFolder);
  const setItemPinned = useMimir((s) => s.setItemPinned);
  const toggleItemTag = useMimir((s) => s.toggleItemTag);
  const deleteConversations = useMimir((s) => s.deleteConversations);
  const deleteImageStudios = useMimir((s) => s.deleteImageStudios);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string>("all"); // "all" | "none" | folderId
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [managingTags, setManagingTags] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  // Multi-select for bulk tag/move/delete.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    for (const st of Object.values(imageStudios)) {
      out.push({
        kind: "image",
        id: st.id,
        title: st.title,
        sortAt: st.updatedAt,
        subtitle: `${st.images.length} image${
          st.images.length === 1 ? "" : "s"
        }${
          st.model ? ` · ${describeModelKey(st.model, settings)}` : ""
        } · ${new Date(st.updatedAt).toLocaleDateString()}`,
        folderId: st.folderId,
        tagIds: st.tagIds ?? [],
        pinned: st.pinned ?? false,
        haystack: (
          st.title +
          " " +
          (st.params?.prompt ?? "") +
          " " +
          st.images.map((img) => img.prompt).join(" ")
        ).toLowerCase(),
      });
    }
    return out;
  }, [conversations, workspaces, imageStudios, settings]);

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
        // Pinned items always float to the top, regardless of sort.
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        switch (sortKey) {
          case "oldest":
            return a.sortAt - b.sortAt;
          case "name-asc":
            return a.title.localeCompare(b.title);
          case "name-desc":
            return b.title.localeCompare(a.title);
          case "recent":
          default:
            return b.sortAt - a.sortAt;
        }
      });
  }, [items, query, typeFilter, folderFilter, tagFilter, sortKey]);

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
    else if (it.kind === "image") openImageStudio(it.id);
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

  // ---- Selection + bulk actions ----------------------------------------

  // The selected items currently visible (selection survives nothing that
  // isn't on screen, so bulk ops only ever touch what the user can see).
  const selectedItems = useMemo(
    () => filtered.filter((it) => selected.has(itemKey(it))),
    [filtered, selected]
  );
  const allVisibleSelected =
    filtered.length > 0 && selectedItems.length === filtered.length;

  function toggleSelect(it: LibItem) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = itemKey(it);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function selectAllVisible() {
    if (allVisibleSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(itemKey)));
  }

  /** Apply a mutation to every selected item, then clear the selection. */
  function bulkPin(pinned: boolean) {
    for (const it of selectedItems) setItemPinned(it.kind, it.id, pinned);
  }
  function bulkMoveFolder(folderId: string | null) {
    for (const it of selectedItems) setItemFolder(it.kind, it.id, folderId);
  }
  /**
   * Toggle a tag across the selection as a group: if every selected item
   * already has the tag, remove it from all; otherwise add it to those missing
   * it. (toggleItemTag flips per item, so we only call it where it'll move in
   * the intended direction.)
   */
  function bulkToggleTag(tagId: string) {
    const allHave = selectedItems.every((it) => it.tagIds.includes(tagId));
    for (const it of selectedItems) {
      const has = it.tagIds.includes(tagId);
      if (allHave ? has : !has) toggleItemTag(it.kind, it.id, tagId);
    }
  }
  function bulkDelete() {
    const chatIds = selectedItems.filter((i) => i.kind === "chat").map((i) => i.id);
    const imageIds = selectedItems.filter((i) => i.kind === "image").map((i) => i.id);
    const wsIds = selectedItems.filter((i) => i.kind === "workspace").map((i) => i.id);
    if (chatIds.length) deleteConversations(chatIds);
    if (imageIds.length) deleteImageStudios(imageIds);
    for (const id of wsIds) deleteWorkspace(id);
    exitSelectMode();
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
              placeholder="Search chats, workspaces & images…"
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
            <SegBtn
              label="Images"
              icon={<Icons.IconImage className="h-3.5 w-3.5" />}
              active={typeFilter === "image"}
              onClick={() => setTypeFilter("image")}
            />
          </div>

          {/* Sort + multi-select */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-parchment-600">
              <Icons.IconSort className="h-3.5 w-3.5" />
              <span className="sr-only">Sort by</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-parchment-200 focus:border-bronze-600 focus:outline-none"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex-1" />
            <button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={[
                "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                selectMode
                  ? "border-bronze-500 bg-bronze-500/15 text-bronze-200"
                  : "border-ink-700 text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
              ].join(" ")}
            >

              <Icons.IconCheckSquare className="h-4 w-4" />
              {selectMode ? "Done" : "Select"}
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
                Nothing here yet — start a chat, a workspace, or an image.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
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
                <button
                  onClick={() => {
                    newImageStudio();
                    closeWindowByKind("library");
                  }}
                  className="rounded-md border border-ink-700 px-4 py-2 text-sm font-medium text-parchment-200 hover:bg-ink-800"
                >
                  New image studio
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-parchment-600">
              Nothing matches your filters.
            </div>
          ) : (
            <>
              {selectMode && (
                <BulkActionBar
                  count={selectedItems.length}
                  allSelected={allVisibleSelected}
                  folders={folders}
                  tags={tags}
                  selectedItems={selectedItems}
                  onSelectAll={selectAllVisible}
                  onPin={() => bulkPin(true)}
                  onUnpin={() => bulkPin(false)}
                  onMoveFolder={bulkMoveFolder}
                  onToggleTag={bulkToggleTag}
                  onDelete={bulkDelete}
                />
              )}
              <ul className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700">
                {filtered.map((it) => (
                  <ItemRow
                    key={`${it.kind}:${it.id}`}
                    item={it}
                    folders={folders}
                    tags={tags}
                    selectMode={selectMode}
                    selected={selected.has(itemKey(it))}
                    onToggleSelect={() => toggleSelect(it)}
                    onOpen={() => open(it)}
                    onTogglePin={() =>
                      setItemPinned(it.kind, it.id, !it.pinned)
                    }
                    onMoveFolder={(fid) => setItemFolder(it.kind, it.id, fid)}
                    onRename={(title) =>
                      it.kind === "chat"
                        ? setConversationTitle(it.id, title)
                        : it.kind === "image"
                        ? setImageStudioTitle(it.id, title)
                        : setWorkspaceName(it.id, title)
                    }
                    onDelete={() =>
                      it.kind === "chat"
                        ? deleteConversation(it.id)
                        : it.kind === "image"
                        ? deleteImageStudio(it.id)
                        : deleteWorkspace(it.id)
                    }
                  />
                ))}
              </ul>
            </>
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

/** Icon for a library item's kind (chat / workspace / image). */
function kindIcon(kind: TabKind, className = "h-4 w-4") {
  if (kind === "chat") return <Icons.IconChat className={className} />;
  if (kind === "image") return <Icons.IconImage className={className} />;
  return <Icons.IconBox className={className} />;
}

/** Capitalized noun for a kind, used in row labels and confirm prompts. */
function kindNoun(kind: TabKind): "Chat" | "Workspace" | "Image" {
  if (kind === "chat") return "Chat";
  if (kind === "image") return "Image";
  return "Workspace";
}

/** Type-badge color classes per kind. */
function kindBadgeClass(kind: TabKind): string {
  if (kind === "chat") return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  if (kind === "image")
    return "border-teal-500/40 bg-teal-500/10 text-teal-300";
  return "border-bronze-600/50 bg-bronze-600/15 text-bronze-300";
}

function BulkActionBar({
  count,
  allSelected,
  folders,
  tags,
  selectedItems,
  onSelectAll,
  onPin,
  onUnpin,
  onMoveFolder,
  onToggleTag,
  onDelete,
}: {
  count: number;
  allSelected: boolean;
  folders: Folder[];
  tags: Tag[];
  selectedItems: LibItem[];
  onSelectAll: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onMoveFolder: (folderId: string | null) => void;
  onToggleTag: (tagId: string) => void;
  onDelete: () => void;
}) {
  const folderMenu = useContextMenu();
  const tagMenu = useContextMenu();
  const none = count === 0;

  // For the tag picker: how many of the selected items carry each tag, so the
  // row can show fully-applied (✓) vs partially-applied (–).
  const tagState = (tagId: string): "none" | "some" | "all" => {
    const n = selectedItems.filter((it) => it.tagIds.includes(tagId)).length;
    if (n === 0) return "none";
    return n === count ? "all" : "some";
  };

  const openFrom = (
    e: React.MouseEvent,
    open: (rect: DOMRect, data: undefined) => void
  ) => {
    open((e.currentTarget as HTMLElement).getBoundingClientRect(), undefined);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-bronze-500/40 bg-bronze-500/10 px-3 py-2">
      <button
        onClick={onSelectAll}
        className="flex items-center gap-1.5 text-xs font-medium text-bronze-100 hover:text-white"
      >
        {allSelected ? (
          <Icons.IconCheckSquare className="h-4 w-4" />
        ) : (
          <Icons.IconSquare className="h-4 w-4" />
        )}
        {allSelected ? "Clear" : "All"}
      </button>
      <span className="text-xs text-parchment-300">{count} selected</span>

      <div className="flex-1" />

      <BulkBtn disabled={none} onClick={onPin} icon={<Icons.IconPin className="h-3.5 w-3.5" />}>
        Pin
      </BulkBtn>
      <BulkBtn disabled={none} onClick={onUnpin} icon={<Icons.IconPin className="h-3.5 w-3.5" />}>
        Unpin
      </BulkBtn>
      <BulkBtn
        disabled={none}
        onClick={(e) => openFrom(e, folderMenu.openMenuAt)}
        icon={<Icons.IconFolder className="h-3.5 w-3.5" />}
      >
        Move
      </BulkBtn>
      <BulkBtn
        disabled={none || tags.length === 0}
        onClick={(e) => openFrom(e, tagMenu.openMenuAt)}
        icon={<Icons.IconTag className="h-3.5 w-3.5" />}
      >
        Tag
      </BulkBtn>
      <ConfirmDelete
        label={`Delete ${count} item${count === 1 ? "" : "s"}`}
        message={`Delete ${count}?`}
        onConfirm={onDelete}
      />

      {folderMenu.menu && (
        <ContextMenu
          x={folderMenu.menu.x}
          y={folderMenu.menu.y}
          width={220}
          onClose={folderMenu.closeMenu}
        >
          <ContextMenuLabel>Move {count} to folder</ContextMenuLabel>
          <ContextMenuItem
            icon={<Icons.IconFile className="h-4 w-4" />}
            label="Top level (unfiled)"
            onClick={() => {
              onMoveFolder(null);
              folderMenu.closeMenu();
            }}
          />
          {folders.map((f) => (
            <ContextMenuItem
              key={f.id}
              icon={
                <Icons.IconFolder className="h-4 w-4" style={tagStyle(f.color).text} />
              }
              label={f.name}
              onClick={() => {
                onMoveFolder(f.id);
                folderMenu.closeMenu();
              }}
            />
          ))}
        </ContextMenu>
      )}

      {tagMenu.menu && (
        <ContextMenu
          x={tagMenu.menu.x}
          y={tagMenu.menu.y}
          width={220}
          onClose={tagMenu.closeMenu}
        >
          <ContextMenuLabel>Tag {count} items</ContextMenuLabel>
          {tags.map((t) => {
            const state = tagState(t.id);
            const c = tagStyle(t.color);
            return (
              <button
                key={t.id}
                role="menuitemcheckbox"
                aria-checked={state === "all"}
                onClick={() => onToggleTag(t.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-parchment-300 transition-colors hover:bg-ink-800"
              >
                <span className="h-2 w-2 rounded-full" style={c.dot} />
                <span className="flex-1 truncate">{t.label}</span>
                {state === "all" && (
                  <Icons.IconCheck className="h-4 w-4 text-bronze-300" />
                )}
                {state === "some" && (
                  <span className="text-xs text-parchment-600">–</span>
                )}
              </button>
            );
          })}
        </ContextMenu>
      )}
    </div>
  );
}

function BulkBtn({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-xs text-parchment-300 transition-colors hover:bg-ink-800 hover:text-parchment-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  );
}

function ItemRow({
  item,
  folders,
  tags,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onTogglePin,
  onMoveFolder,
  onRename,
  onDelete,
}: {
  item: LibItem;
  folders: Folder[];
  tags: Tag[];
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
  onMoveFolder: (folderId: string | null) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const toggleItemTag = useMimir((s) => s.toggleItemTag);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const itemTags = tags.filter((t) => item.tagIds.includes(t.id));

  function beginRename() {
    setRenaming(true);
  }
  function commitRename(value: string) {
    const t = value.trim();
    if (t && t !== item.title) onRename(t);
    setRenaming(false);
  }

  // In select mode, clicking the row toggles selection instead of opening.
  const onRowClick = () => {
    if (renaming) return;
    if (selectMode) onToggleSelect();
    else onOpen();
  };

  return (
    <li
      className={[
        "group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
        selected ? "bg-bronze-500/10 hover:bg-bronze-500/15" : "bg-ink-900 hover:bg-ink-850",
      ].join(" ")}
      onClick={onRowClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-label={selected ? "Deselect" : "Select"}
          aria-pressed={selected}
          className={[
            "shrink-0 rounded transition-colors",
            selected ? "text-bronze-300" : "text-parchment-600 hover:text-parchment-300",
          ].join(" ")}
        >
          {selected ? (
            <Icons.IconCheckSquare className="h-5 w-5" />
          ) : (
            <Icons.IconSquare className="h-5 w-5" />
          )}
        </button>
      )}

      {/* Type badge */}
      <span
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
          kindBadgeClass(item.kind),
        ].join(" ")}
        title={kindNoun(item.kind)}
      >
        {kindIcon(item.kind)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.pinned && (
            <Icons.IconPin className="h-3 w-3 shrink-0 text-bronze-400" />
          )}
          {renaming ? (
            <InlineRename
              value={item.title}
              onCommit={commitRename}
              onCancel={() => setRenaming(false)}
              selectOnFocus
              ariaLabel={`Rename ${item.title}`}
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
            {kindNoun(item.kind)}
          </span>{" "}
          · {item.subtitle}
        </div>
      </div>

      {!selectMode && (
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
      )}

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
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <ContextMenu x={x} y={y} width={240} onClose={onClose}>
      <ContextMenuItem
        icon={kindIcon(item.kind)}
        label="Open"
        onClick={() => {
          onOpen();
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Icons.IconPin className="h-4 w-4" />}
        label={item.pinned ? "Unpin" : "Pin to top"}
        onClick={() => {
          onTogglePin();
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Icons.IconPencil className="h-4 w-4" />}
        label="Rename"
        onClick={() => {
          onRename();
          onClose();
        }}
      />

      <ContextMenuSeparator />
      <ContextMenuLabel>Tags</ContextMenuLabel>
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

      <ContextMenuSeparator />
      <ContextMenuLabel>Move to folder</ContextMenuLabel>
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

      <ContextMenuSeparator />
      <ContextMenuDelete
        label={`Delete ${kindNoun(item.kind).toLowerCase()}`}
        confirmMessage={`Delete ${kindNoun(item.kind).toLowerCase()}?`}
        armed={confirmDelete}
        onArm={() => setConfirmDelete(true)}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          onDelete();
          onClose();
        }}
      />
    </ContextMenu>
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
