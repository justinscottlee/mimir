"use client";

import { useTalos } from "@/lib/store";
import { IconTrash } from "../icons";

export default function WorkspacesView() {
  const workspaces = useTalos((s) => s.workspaces);
  const openWorkspace = useTalos((s) => s.openWorkspace);
  const deleteWorkspace = useTalos((s) => s.deleteWorkspace);
  const newWorkspace = useTalos((s) => s.newWorkspace);

  const list = Object.values(workspaces).sort(
    (a, b) => b.createdAt - a.createdAt
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-bronze-500">
        Library
      </div>
      <h1 className="mt-2 text-xl font-semibold">Workspaces</h1>

      {list.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-ink-700 p-8 text-center">
          <p className="text-sm text-parchment-600">No workspaces yet.</p>
          <button
            onClick={newWorkspace}
            className="mt-4 rounded-md border border-ink-700 px-4 py-2 text-sm text-parchment-400 hover:bg-ink-800 hover:text-parchment-100"
          >
            New workspace
          </button>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-700">
          {list.map((w) => (
            <li
              key={w.id}
              className="group flex cursor-pointer items-center gap-3 bg-ink-900 px-4 py-3 transition-colors hover:bg-ink-850"
              onClick={() => openWorkspace(w.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-parchment-100">
                  {w.name}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-parchment-600">
                  created {new Date(w.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteWorkspace(w.id);
                }}
                className="rounded p-1.5 text-parchment-600 opacity-0 transition-opacity hover:bg-ink-700 hover:text-signal-err focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Delete ${w.name}`}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
