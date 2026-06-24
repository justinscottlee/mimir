"use client";

import { useMemo, useState } from "react";
import { useMimir } from "@/lib/store";
import { describeModelKey } from "@/lib/models";
import { ModelPrice, parseModelKey } from "@/lib/types";
import * as Icons from "../icons";

/**
 * Usage & cost. Aggregates the per-message / per-step token counts Mimir already
 * records (prompt + completion tokens) across every conversation and agent run,
 * groups them by model, and — for models you've given a price — estimates spend.
 *
 * Pricing is per one-million tokens (the unit hosted providers quote) and fully
 * user-configurable: set an input and output rate per model, in US dollars.
 * Local models cost nothing, so just leave them unpriced. Costs are estimates:
 * token counts come from what each endpoint reported, and multi-round tool
 * responses can under-count prompt tokens.
 */

interface ModelUsage {
  key: string;
  inputTokens: number;
  outputTokens: number;
  /** Assistant messages + agent steps attributed to this model. */
  responses: number;
}

export default function UsageView() {
  const settings = useMimir((s) => s.settings);
  const pricing = settings.pricing;

  const setModelPrice = useMimir((s) => s.setModelPrice);
  const removeModelPrice = useMimir((s) => s.removeModelPrice);
  const resetModelUsage = useMimir((s) => s.resetModelUsage);
  const resetAllUsage = useMimir((s) => s.resetAllUsage);

  // The persistent per-model ledger is the source of truth: it's incremented as
  // responses finish and keeps counting after the conversation or workspace that
  // produced them is deleted. (Earlier this was derived live from conversations
  // + runs, which made deleting a chat erase its usage.)
  const usage = useMemo<ModelUsage[]>(() => {
    const ledger = pricing.ledger ?? {};
    return Object.entries(ledger)
      .map(([key, u]) => ({
        key,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        responses: u.responses,
      }))
      .sort(
        (a, b) =>
          b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
      );
  }, [pricing.ledger]);

  /** Resolve a model's price: exact key first, then bare model id. */
  function priceFor(key: string): ModelPrice | undefined {
    const exact = pricing.models[key];
    if (exact) return exact;
    const id = parseModelKey(key)?.modelId;
    return id ? pricing.models[id] : undefined;
  }

  function costOf(u: ModelUsage): number | null {
    const p = priceFor(u.key);
    if (!p) return null;
    return (
      (u.inputTokens / 1_000_000) * p.inputPerMTok +
      (u.outputTokens / 1_000_000) * p.outputPerMTok
    );
  }

  const totals = useMemo(() => {
    let input = 0;
    let output = 0;
    let cost = 0;
    let priced = true;
    for (const u of usage) {
      input += u.inputTokens;
      output += u.outputTokens;
      const c = costOf(u);
      if (c == null) {
        if (u.inputTokens + u.outputTokens > 0) priced = false;
      } else cost += c;
    }
    return { input, output, cost, allPriced: priced };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usage, pricing]);

  // Costs are always shown in US dollars.
  const cur = "$";

  return (
    <div className="flex flex-col gap-5 p-5">
      <p className="max-w-2xl text-sm leading-relaxed text-parchment-400">
        Token usage across every model, accumulated as responses finish.
        Totals persist even after you delete the conversation or workspace that
        produced them; reset a model below to clear its history. Give a model an
        input/output rate and Mimir estimates what it cost; leave local models
        unpriced. Figures are estimates from the token counts each endpoint
        reported.
      </p>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Input tokens" value={fmtTokens(totals.input)} />
        <Stat label="Output tokens" value={fmtTokens(totals.output)} />
        <Stat
          label="Estimated cost"
          value={`${cur}${totals.cost.toFixed(2)}`}
          hint={totals.allPriced ? undefined : "some models unpriced"}
          accent
        />
      </div>

      {/* Per-model table */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-parchment-600">
            By model
          </div>
          {usage.length > 0 && <ResetAllUsage onResetAll={resetAllUsage} />}
        </div>
        {usage.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center text-sm text-parchment-600">
            No usage recorded yet. Send a message or run an agent and it shows up
            here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850 text-left font-mono text-[10px] uppercase tracking-wider text-parchment-600">
                  <th className="px-3 py-2 font-normal">Model</th>
                  <th className="px-3 py-2 text-right font-normal">Input</th>
                  <th className="px-3 py-2 text-right font-normal">Output</th>
                  <th className="px-3 py-2 text-right font-normal">
                    Price /Mtok (in / out)
                  </th>
                  <th className="px-3 py-2 text-right font-normal">Cost</th>
                  <th className="w-8 px-2 py-2 font-normal" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700">
                {usage.map((u) => (
                  <ModelRow
                    key={u.key}
                    usage={u}
                    label={describeModelKey(u.key, settings)}
                    price={priceFor(u.key)}
                    cost={costOf(u)}
                    currency={cur}
                    onSetPrice={(p) => setModelPrice(u.key, p)}
                    onClearPrice={() => removeModelPrice(u.key)}
                    onResetUsage={() => resetModelUsage(u.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ManualPrices />
    </div>
  );
}

function ModelRow({
  usage,
  label,
  price,
  cost,
  currency,
  onSetPrice,
  onClearPrice,
  onResetUsage,
}: {
  usage: ModelUsage;
  label: string;
  price?: ModelPrice;
  cost: number | null;
  currency: string;
  onSetPrice: (p: ModelPrice) => void;
  onClearPrice: () => void;
  onResetUsage: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [inStr, setInStr] = useState(String(price?.inputPerMTok ?? ""));
  const [outStr, setOutStr] = useState(String(price?.outputPerMTok ?? ""));

  function commit() {
    const i = Number(inStr);
    const o = Number(outStr);
    if (Number.isFinite(i) && Number.isFinite(o) && (i > 0 || o > 0)) {
      onSetPrice({ inputPerMTok: i, outputPerMTok: o });
    }
    setEditing(false);
  }

  return (
    <tr className="text-parchment-300">
      <td className="px-3 py-2">
        <span className="font-mono text-xs text-parchment-100">{label}</span>
        <div className="font-mono text-[10px] text-parchment-600">
          {usage.responses} response{usage.responses === 1 ? "" : "s"}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {fmtTokens(usage.inputTokens)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {fmtTokens(usage.outputTokens)}
      </td>
      <td className="px-3 py-2 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-1">
            <input
              autoFocus
              value={inStr}
              onChange={(e) => setInStr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              placeholder="in"
              className="w-14 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-right font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
            />
            <span className="text-parchment-600">/</span>
            <input
              value={outStr}
              onChange={(e) => setOutStr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              placeholder="out"
              className="w-14 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-right font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
            />
            <button
              onClick={commit}
              className="rounded p-0.5 text-bronze-300 hover:bg-ink-800"
              aria-label="Save price"
            >
              <Icons.IconCheck className="h-4 w-4" />
            </button>
          </div>
        ) : price ? (
          <button
            onClick={() => setEditing(true)}
            className="font-mono text-xs text-parchment-400 underline-offset-2 hover:text-parchment-100 hover:underline"
          >
            {currency}
            {price.inputPerMTok} / {currency}
            {price.outputPerMTok}
          </button>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded border border-ink-700 px-1.5 py-0.5 text-[11px] text-parchment-500 hover:bg-ink-800 hover:text-parchment-100"
          >
            set price
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {cost == null ? (
          <span className="font-mono text-xs text-parchment-600">—</span>
        ) : (
          <span className="flex items-center justify-end gap-1.5 font-mono text-xs text-parchment-100">
            {currency}
            {cost.toFixed(cost < 1 ? 4 : 2)}
            {price && (
              <button
                onClick={onClearPrice}
                className="text-parchment-600 hover:text-signal-err"
                title="Clear this model's price"
                aria-label="Clear price"
              >
                <Icons.IconClose className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {confirmReset ? (
          <span className="flex items-center justify-end gap-1">
            <button
              onClick={() => {
                onResetUsage();
                setConfirmReset(false);
              }}
              className="rounded p-0.5 text-signal-err hover:bg-signal-err/20"
              title="Clear this model's usage history — can't be undone"
              aria-label="Confirm reset usage"
            >
              <Icons.IconCheck className="h-4 w-4" />
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
              title="Cancel"
              aria-label="Cancel reset"
            >
              <Icons.IconClose className="h-4 w-4" />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            className="rounded p-0.5 text-parchment-600 hover:text-signal-err"
            title="Reset this model's usage history"
            aria-label="Reset usage history"
          >
            <Icons.IconTrash className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

/** A small "Reset all" button with an inline confirm, above the usage table. */
function ResetAllUsage({ onResetAll }: { onResetAll: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-xs text-signal-err">
        Reset all usage?
        <button
          onClick={() => {
            onResetAll();
            setConfirming(false);
          }}
          className="rounded p-0.5 text-signal-err hover:bg-signal-err/20"
          title="Clear all usage history — can't be undone"
          aria-label="Confirm reset all usage"
        >
          <Icons.IconCheck className="h-4 w-4" />
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
          title="Cancel"
          aria-label="Cancel reset all"
        >
          <Icons.IconClose className="h-4 w-4" />
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-parchment-500 hover:bg-ink-800 hover:text-parchment-100"
    >
      Reset all
    </button>
  );
}

/** Lets the user price a model that hasn't been used yet (by id or key). */
function ManualPrices() {
  const pricing = useMimir((s) => s.settings.pricing);
  const setModelPrice = useMimir((s) => s.setModelPrice);
  const removeModelPrice = useMimir((s) => s.removeModelPrice);
  const settings = useMimir((s) => s.settings);
  const [id, setId] = useState("");
  const [inStr, setInStr] = useState("");
  const [outStr, setOutStr] = useState("");

  const entries = Object.entries(pricing.models);

  function add() {
    const key = id.trim();
    const i = Number(inStr);
    const o = Number(outStr);
    if (!key || !Number.isFinite(i) || !Number.isFinite(o)) return;
    setModelPrice(key, { inputPerMTok: i, outputPerMTok: o });
    setId("");
    setInStr("");
    setOutStr("");
  }

  return (
    <div>
      <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-parchment-600">
        Configured prices
      </div>
      <p className="mb-2 max-w-2xl text-[11px] leading-relaxed text-parchment-600">
        Prices apply by exact model key or by bare model id (so one rate covers
        the same model across endpoints). Add a price ahead of time, or override
        one set from the table above.
      </p>
      {entries.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {entries.map(([key, p]) => (
            <div
              key={key}
              className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-parchment-100">
                {describeModelKey(key, settings) || key}
              </span>
              <span className="font-mono text-[11px] text-parchment-400">
                ${p.inputPerMTok} / ${p.outputPerMTok} per Mtok
              </span>
              <button
                onClick={() => removeModelPrice(key)}
                className="rounded p-0.5 text-parchment-600 hover:text-signal-err"
                aria-label="Remove price"
              >
                <Icons.IconTrash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-parchment-600">Model id or key</span>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="claude-opus-4-8"
            spellCheck={false}
            className="w-56 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 placeholder:text-parchment-600/60 focus:border-bronze-600 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-parchment-600">Input /Mtok</span>
          <input
            value={inStr}
            onChange={(e) => setInStr(e.target.value)}
            placeholder="3"
            className="w-24 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-parchment-600">Output /Mtok</span>
          <input
            value={outStr}
            onChange={(e) => setOutStr(e.target.value)}
            placeholder="15"
            className="w-24 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
          />
        </label>
        <button
          onClick={add}
          className="rounded-md bg-bronze-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-bronze-400"
        >
          Add price
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-parchment-600">
        {label}
      </div>
      <div
        className={[
          "mt-1 text-xl font-semibold",
          accent ? "text-bronze-300" : "text-parchment-100",
        ].join(" ")}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-parchment-600">{hint}</div>}
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
