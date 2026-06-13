"use client";

import { useMimir } from "@/lib/store";
import ConfirmDelete from "../ConfirmDelete";

export default function WorkspacesView() {
  const workspaces = useMimir((s) => s.workspaces);
  const openWorkspace = useMimir((s) => s.openWorkspace);
  const deleteWorkspace = useMimir((s) => s.deleteWorkspace);
  const newWorkspace = useMimir((s) => s.newWorkspace);
  const closeWindowByKind = useMimir((s) => s.closeWindowByKind);

  const list = Object.values(workspaces).sort(
    (a, b) => b.createdAt - a.createdAt
  );

  function open(id: string) {
    openWorkspace(id);
    closeWindowByKind("workspaces");
  }

  return (
    <div className="p-4">
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center">
          <p className="text-sm text-parchment-600">No workspaces yet.</p>
          <button
            onClick={() => {
              newWorkspace();
              closeWindowByKind("workspaces");
            }}
            className="mt-4 rounded-md border border-ink-700 px-4 py-2 text-sm text-parchment-400 hover:bg-ink-800 hover:text-parchment-100"
          >
            New workspace
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700">
          {list.map((w) => (
            <li
              key={w.id}
              className="group flex cursor-pointer items-center gap-3 bg-ink-900 px-4 py-3 transition-colors hover:bg-ink-850"
              onClick={() => open(w.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-parchment-100">
                  {w.name}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-parchment-600">
                  created {new Date(w.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <ConfirmDelete
                  label={`Delete ${w.name}`}
                  message="Delete? Can't be undone."
                  onConfirm={() => deleteWorkspace(w.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
