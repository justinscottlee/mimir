import { PlanItem, PlanItemStatus } from "../types";
import { ToolHandler, ToolRegistry } from "../tools";
import { uid } from "../defaults";

/**
 * The planning toolset: lets the agent build and maintain a visible checklist
 * the user can watch (and edit) as the run proceeds. Like the filesystem tools,
 * these only express intent — the handlers mutate the run's plan through a small
 * injected API so the store stays the owner of the data, and the UI re-renders
 * the checklist live.
 *
 * The plan is deliberately simple: an ordered list of items, each with a status
 * (pending / active / done / blocked) and an optional note. The agent is told to
 * keep exactly one item active at a time and to re-read the plan when it changes
 * underneath it (because the user can reorder, edit, or delete items).
 */

/** The surface the planning tools read/write the run's plan through. */
export interface PlanApi {
  getPlan: () => PlanItem[];
  setPlan: (plan: PlanItem[]) => void;
}

const VALID_STATUSES: PlanItemStatus[] = [
  "pending",
  "active",
  "done",
  "blocked",
];

function renderPlan(plan: PlanItem[]): string {
  if (plan.length === 0) return "(plan is empty)";
  const glyph: Record<PlanItemStatus, string> = {
    pending: "[ ]",
    active: "[~]",
    done: "[x]",
    blocked: "[!]",
  };
  return plan
    .map((it, i) => {
      const note = it.note ? `  — ${it.note}` : "";
      return `${i + 1}. ${glyph[it.status]} ${it.text} (id: ${it.id})${note}`;
    })
    .join("\n");
}

function setPlanTool(api: PlanApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "set_plan",
        description:
          "Create or completely replace your checklist plan with an ordered list of steps. Call this near the start of a multi-step task once you understand the goal. Each item should be a single, verifiable outcome. This overwrites any existing plan, so pass the full list.",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              description:
                "The ordered checklist, each a short outcome like \"Write the CSV parser\".",
              items: { type: "string" },
            },
          },
          required: ["items"],
        },
      },
    },
    run: (args) => {
      const raw = Array.isArray(args.items) ? args.items : [];
      const items: PlanItem[] = raw
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t.length > 0)
        .map((text) => ({ id: uid("pl_"), text, status: "pending" as const }));
      if (items.length === 0) {
        return "Error: provide at least one non-empty plan item.";
      }
      api.setPlan(items);
      return `Plan set (${items.length} steps):\n${renderPlan(items)}`;
    },
  };
}

function addPlanItemTool(api: PlanApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "add_plan_item",
        description:
          "Append a new step to your plan, or insert it right after an existing step. Use this when you discover work mid-run that wasn't in the original plan.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "The new step's text." },
            after_id: {
              type: "string",
              description:
                "Optional id of the item to insert after. Omit to append at the end.",
            },
          },
          required: ["text"],
        },
      },
    },
    run: (args) => {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text) return "Error: 'text' is required.";
      const afterId =
        typeof args.after_id === "string" ? args.after_id : undefined;
      const plan = [...api.getPlan()];
      const item: PlanItem = { id: uid("pl_"), text, status: "pending" };
      if (afterId) {
        const idx = plan.findIndex((p) => p.id === afterId);
        if (idx === -1) {
          return `Error: no plan item with id "${afterId}". Current plan:\n${renderPlan(
            plan
          )}`;
        }
        plan.splice(idx + 1, 0, item);
      } else {
        plan.push(item);
      }
      api.setPlan(plan);
      return `Added step "${text}" (id: ${item.id}).\n${renderPlan(plan)}`;
    },
  };
}

function updatePlanItemTool(api: PlanApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "update_plan_item",
        description:
          "Reword a plan item or attach a short status note to it (e.g. why it's blocked, or a key decision). Pass at least one of text/note.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The plan item's id." },
            text: { type: "string", description: "New text for the item." },
            note: {
              type: "string",
              description: "A short note to attach (pass empty string to clear).",
            },
          },
          required: ["id"],
        },
      },
    },
    run: (args) => {
      const id = typeof args.id === "string" ? args.id : "";
      const plan = [...api.getPlan()];
      const idx = plan.findIndex((p) => p.id === id);
      if (idx === -1) {
        return `Error: no plan item with id "${id}". Current plan:\n${renderPlan(
          plan
        )}`;
      }
      const next = { ...plan[idx] };
      if (typeof args.text === "string" && args.text.trim()) {
        next.text = args.text.trim();
      }
      if (typeof args.note === "string") {
        next.note = args.note.trim() || undefined;
      }
      plan[idx] = next;
      api.setPlan(plan);
      return `Updated item ${id}.\n${renderPlan(plan)}`;
    },
  };
}

function setPlanItemStatusTool(api: PlanApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "set_plan_item_status",
        description:
          "Move a plan item between states: pending, active, done, or blocked. Keep exactly one item active at a time as you work through the plan — mark an item active when you start it, done when its outcome is verified.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The plan item's id." },
            status: {
              type: "string",
              enum: VALID_STATUSES,
              description: "The new status.",
            },
          },
          required: ["id", "status"],
        },
      },
    },
    run: (args) => {
      const id = typeof args.id === "string" ? args.id : "";
      const status = args.status as PlanItemStatus;
      if (!VALID_STATUSES.includes(status)) {
        return `Error: status must be one of ${VALID_STATUSES.join(", ")}.`;
      }
      const plan = [...api.getPlan()];
      const idx = plan.findIndex((p) => p.id === id);
      if (idx === -1) {
        return `Error: no plan item with id "${id}". Current plan:\n${renderPlan(
          plan
        )}`;
      }
      plan[idx] = { ...plan[idx], status };
      api.setPlan(plan);
      return `Marked "${plan[idx].text}" as ${status}.\n${renderPlan(plan)}`;
    },
  };
}

export const PLANNING_TOOL_NAMES = [
  "set_plan",
  "add_plan_item",
  "update_plan_item",
  "set_plan_item_status",
] as const;

/** Builds the planning tool registry bound to a run's plan API. */
export function buildPlanningTools(api: PlanApi): ToolRegistry {
  return {
    set_plan: setPlanTool(api),
    add_plan_item: addPlanItemTool(api),
    update_plan_item: updatePlanItemTool(api),
    set_plan_item_status: setPlanItemStatusTool(api),
  };
}

export { renderPlan };
