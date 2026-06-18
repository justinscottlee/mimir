"use client";

import { useState } from "react";
import { useMimir } from "@/lib/store";
import { PlanItem, PlanItemStatus } from "@/lib/types";
import * as Icons from "@/components/icons";

/**
 * The agent's checklist plan, rendered as a live, editable list. The agent
 * builds and updates it through the planning tools; the user can also tick,
 * reword, add, reorder, or delete items here, and the agent is told to re-read
 * the plan on its next step — so a person can steer the run by editing the plan
 * underneath it. All edits write straight back to the run via setRunPlan.
 */

const STATUS_ORDER: PlanItemStatus[] = ["pending", "active", "done", "blocked"];

const STATUS_LABEL: Record<PlanItemStatus, string> = {
  pending: "To do",
  active: "In progress",
  done: "Done",
  blocked: "Blocked",
};

export default function PlanView({
  workspaceId,
  runId,
  plan,
  editable,
}: {
  workspaceId: string;
  runId: string;
  plan: PlanItem[];
  /** When false (run finished and not focused), the controls are read-only. */
  editable: boolean;
}) {
  const setRunPlan = useMimir((s) => s.setRunPlan);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const done = plan.filter((p) => p.status === "done").length;

  function update(next: PlanItem[]) {
    setRunPlan(workspaceId, runId, next);
  }

  function cycleStatus(item: PlanItem) {
    // Clicking the checkbox cycles pending → active → done → pending; a done
    // item goes back to pending so a person can re-open it.
    const order: PlanItemStatus[] =
      item.status === "blocked"
        ? ["blocked", "pending"]
        : ["pending", "active", "done"];
    const i = order.indexOf(item.status);
    const nextStatus = order[(i + 1) % order.length];
    update(
      plan.map((p) => (p.id === item.id ? { ...p, status: nextStatus } : p))
    );
  }

  function setStatus(id: string, status: PlanItemStatus) {
    update(plan.map((p) => (p.id === id ? { ...p, status } : p)));
  }

  function remove(id: string) {
    update(plan.filter((p) => p.id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    const idx = plan.findIndex((p) => p.id === id);
    const to = idx + dir;
    if (idx === -1 || to < 0 || to >= plan.length) return;
    const next = [...plan];
    const [it] = next.splice(idx, 1);
    next.splice(to, 0, it);
    update(next);
  }

  function commitAdd() {
    const text = draft.trim();
    if (text) {
      update([
        ...plan,
        {
          id: "pl_" + Math.random().toString(36).slice(2, 9),
          text,
          status: "pending",
        },
      ]);
    }
    setDraft("");
    setAdding(false);
  }

  function commitEdit(id: string) {
    const text = editDraft.trim();
    if (text) update(plan.map((p) => (p.id === id ? { ...p, text } : p)));
    setEditingId(null);
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-850">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-1.5">
        <Icons.IconList className="h-4 w-4 text-bronze-400" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
          Plan
        </span>
        <span className="font-mono text-[10px] text-parchment-600">
          {done}/{plan.length}
        </span>
        {/* Mini progress bar */}
        <div className="ml-1 h-1 w-16 overflow-hidden rounded-full bg-ink-700">
          <div
            className="h-full bg-bronze-500 transition-all"
            style={{
              width: plan.length ? `${(done / plan.length) * 100}%` : "0%",
            }}
          />
        </div>
        <div className="flex-1" />
        {editable && (
          <button
            onClick={() => {
              setAdding(true);
              setDraft("");
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            title="Add a step"
          >
            <Icons.IconPlus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      <ul className="divide-y divide-ink-800/60">
        {plan.map((item, i) => (
          <li key={item.id} className="group flex items-start gap-2 px-3 py-1.5">
            <button
              onClick={() => editable && cycleStatus(item)}
              disabled={!editable}
              className="mt-0.5 shrink-0"
              title={editable ? "Click to change status" : STATUS_LABEL[item.status]}
            >
              <StatusBox status={item.status} />
            </button>

            <div className="min-w-0 flex-1">
              {editingId === item.id ? (
                <input
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitEdit(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit(item.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded border border-bronze-600 bg-ink-900 px-1.5 py-0.5 text-sm text-parchment-100 focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    if (!editable) return;
                    setEditingId(item.id);
                    setEditDraft(item.text);
                  }}
                  className={[
                    "block w-full text-left text-sm leading-snug",
                    item.status === "done"
                      ? "text-parchment-600 line-through"
                      : item.status === "blocked"
                      ? "text-signal-err"
                      : "text-parchment-100",
                  ].join(" ")}
                  title={editable ? "Click to edit" : undefined}
                >
                  {item.text}
                </button>
              )}
              {item.note && (
                <div className="mt-0.5 text-[11px] italic text-parchment-600">
                  {item.note}
                </div>
              )}
            </div>

            {editable && (
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <BlockToggle
                  status={item.status}
                  onToggle={() =>
                    setStatus(
                      item.id,
                      item.status === "blocked" ? "pending" : "blocked"
                    )
                  }
                />
                <IconBtn
                  label="Move up"
                  disabled={i === 0}
                  onClick={() => move(item.id, -1)}
                >
                  <Icons.IconChevron className="h-3.5 w-3.5 rotate-180" />
                </IconBtn>
                <IconBtn
                  label="Move down"
                  disabled={i === plan.length - 1}
                  onClick={() => move(item.id, 1)}
                >
                  <Icons.IconChevron className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Delete step" onClick={() => remove(item.id)}>
                  <Icons.IconClose className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            )}
          </li>
        ))}

        {adding && (
          <li className="flex items-center gap-2 px-3 py-1.5">
            <StatusBox status="pending" />
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitAdd}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAdd();
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="New step…"
              className="w-full rounded border border-bronze-600 bg-ink-900 px-1.5 py-0.5 text-sm text-parchment-100 placeholder:text-parchment-600 focus:outline-none"
            />
          </li>
        )}
      </ul>
    </div>
  );
}

function StatusBox({ status }: { status: PlanItemStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded border border-signal-ok bg-signal-ok/20 text-signal-ok">
        <Icons.IconCheck className="h-3 w-3" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-bronze-400">
        <Icons.IconSpark className="h-3 w-3 mimir-spin text-bronze-400" />
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded border border-signal-err text-signal-err">
        !
      </span>
    );
  }
  return <span className="block h-4 w-4 rounded border border-ink-700" />;
}

function BlockToggle({
  status,
  onToggle,
}: {
  status: PlanItemStatus;
  onToggle: () => void;
}) {
  return (
    <IconBtn
      label={status === "blocked" ? "Unblock" : "Mark blocked"}
      onClick={onToggle}
    >
      <span
        className={[
          "text-xs font-bold",
          status === "blocked" ? "text-bronze-300" : "text-parchment-600",
        ].join(" ")}
      >
        !
      </span>
    </IconBtn>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-parchment-100 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export { STATUS_ORDER };
