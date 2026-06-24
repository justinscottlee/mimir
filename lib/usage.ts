import { Conversation, ModelUsageTotals, Workspace } from "./types";

/**
 * Helpers for the persistent per-model usage ledger that backs the Usage & cost
 * view.
 *
 * The ledger is the single source of truth for what the table shows. It's
 * incremented imperatively as responses finish (one bump per finalized
 * assistant message / agent step), so it keeps counting tokens even after the
 * conversation or workspace that produced them is deleted — the thing a tally
 * derived from live state can't do. Two operations live here:
 *
 *  - `bumpUsage`: fold one billed response into a ledger entry.
 *  - `computeUsageLedger`: a one-time backfill that reconstructs the ledger from
 *    existing conversations and runs, so upgrading to the ledger doesn't lose a
 *    user's historical usage. It runs exactly once (guarded in the store), and
 *    going-forward increments are disjoint from it, so nothing is double-counted.
 *
 * Both key usage the same way the view does: an assistant message bills against
 * its own `model` (falling back to the conversation's), and an agent step bills
 * against its run's `model` (falling back to the workspace's), with `"unknown"`
 * as a last resort.
 */

/** An empty ledger entry. */
function emptyTotals(): ModelUsageTotals {
  return { inputTokens: 0, outputTokens: 0, responses: 0 };
}

/**
 * Returns a new ledger with one billed response folded into `key`'s totals.
 * Pure: never mutates the input. Tokens default to 0; the response count always
 * advances by one so the per-model "N responses" figure stays accurate.
 */
export function bumpUsage(
  ledger: Record<string, ModelUsageTotals>,
  key: string,
  inputTokens: number,
  outputTokens: number
): Record<string, ModelUsageTotals> {
  const prev = ledger[key] ?? emptyTotals();
  return {
    ...ledger,
    [key]: {
      inputTokens: prev.inputTokens + (inputTokens || 0),
      outputTokens: prev.outputTokens + (outputTokens || 0),
      responses: prev.responses + 1,
    },
  };
}

/**
 * Reconstruct a usage ledger from current conversations and workspaces. Used
 * once, at migration, to seed the ledger so existing history isn't lost when the
 * view switches from live-derived totals to the persistent ledger.
 */
export function computeUsageLedger(
  conversations: Record<string, Conversation>,
  workspaces: Record<string, Workspace>
): Record<string, ModelUsageTotals> {
  let ledger: Record<string, ModelUsageTotals> = {};

  for (const c of Object.values(conversations)) {
    for (const m of c.messages) {
      if (m.role !== "assistant" || !m.meta) continue;
      const key = m.model ?? c.model ?? "unknown";
      ledger = bumpUsage(
        ledger,
        key,
        m.meta.promptTokens ?? 0,
        m.meta.completionTokens ?? 0
      );
    }
  }

  for (const w of Object.values(workspaces)) {
    for (const run of w.runs) {
      for (const step of run.steps) {
        if (!step.meta) continue;
        const key = run.model ?? w.model ?? "unknown";
        ledger = bumpUsage(
          ledger,
          key,
          step.meta.promptTokens ?? 0,
          step.meta.completionTokens ?? 0
        );
      }
    }
  }

  return ledger;
}
