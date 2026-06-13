"use client";

import { useEffect, useMemo, useState } from "react";
import { useMimir } from "@/lib/store";
import {
  EndpointLoad,
  loadAllModels,
  resolveEnabledModels,
} from "@/lib/models";
import { modelKey } from "@/lib/types";
import ConfirmDelete from "../ConfirmDelete";
import { IconPlus } from "../icons";

type Section = "models" | "system" | "account";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "models", label: "Models & Endpoints" },
  { id: "system", label: "System" },
  { id: "account", label: "Account" },
];

export default function SettingsView() {
  const [section, setSection] = useState<Section>("models");

  return (
    <div className="flex h-full">
      {/* Settings sidebar */}
      <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-ink-700 bg-ink-950/40 p-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={[
              "rounded-md px-3 py-2 text-left text-sm transition-colors",
              section === s.id
                ? "bg-ink-800 text-parchment-100"
                : "text-parchment-400 hover:bg-ink-850 hover:text-parchment-100",
            ].join(" ")}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Section body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "models" && <ModelsSection />}
        {section === "system" && <SystemSection />}
        {section === "account" && <AccountSection />}
      </div>
    </div>
  );
}

/* ------------------------------- Models ------------------------------- */

function ModelsSection() {
  const settings = useMimir((s) => s.settings);
  const addEndpoint = useMimir((s) => s.addEndpoint);
  const updateEndpoint = useMimir((s) => s.updateEndpoint);
  const removeEndpoint = useMimir((s) => s.removeEndpoint);
  const setModelDisabled = useMimir((s) => s.setModelDisabled);
  const setSettings = useMimir((s) => s.setSettings);

  const [loads, setLoads] = useState<EndpointLoad[]>([]);
  const [loading, setLoading] = useState(true);

  const endpointsKey = settings.endpoints.map((e) => e.id + e.url).join("|");
  const refresh = () => {
    setLoading(true);
    loadAllModels(settings.endpoints).then((res) => {
      setLoads(res);
      setLoading(false);
    });
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointsKey]);

  const enabledModels = useMemo(
    () => resolveEnabledModels(loads, settings.disabledModels),
    [loads, settings.disabledModels]
  );

  const disabledSet = new Set(settings.disabledModels);

  return (
    <div className="p-5">
      <SectionHeading
        title="Endpoints"
        subtitle="llama.cpp servers Mimir can reach. Each can host multiple models."
      />

      <div className="mt-4 flex flex-col gap-3">
        {settings.endpoints.map((ep) => {
          const load = loads.find((l) => l.endpoint.id === ep.id);
          return (
            <EndpointCard
              key={ep.id}
              id={ep.id}
              name={ep.name}
              url={ep.url}
              status={
                loading
                  ? "loading"
                  : load?.error
                  ? load.error
                  : `${load?.models.length ?? 0} models`
              }
              error={!!load?.error}
              onChange={(patch) => updateEndpoint(ep.id, patch)}
              onRemove={() => removeEndpoint(ep.id)}
              canRemove={settings.endpoints.length > 1}
            />
          );
        })}
        <AddEndpoint onAdd={(name, url) => addEndpoint(name, url)} />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <SectionHeading
          title="Available models"
          subtitle="Toggle which models appear in pickers, and set defaults."
        />
        <button
          onClick={refresh}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-parchment-400 hover:bg-ink-800 hover:text-parchment-100"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {loads.map((load) => (
          <div key={load.endpoint.id}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-xs text-parchment-100">
                {load.endpoint.name}
              </span>
              {load.error && (
                <span className="font-mono text-[11px] text-signal-err">
                  unreachable
                </span>
              )}
            </div>
            {load.models.length === 0 ? (
              <p className="text-xs text-parchment-600">
                {load.error ? "Could not reach this endpoint." : "No models."}
              </p>
            ) : (
              <ul className="divide-y divide-ink-700 overflow-hidden rounded-md border border-ink-700">
                {load.models.map((m) => {
                  const key = modelKey(load.endpoint.id, m.id);
                  const enabled = !disabledSet.has(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-3 bg-ink-900 px-3 py-2"
                    >
                      <button
                        onClick={() => setModelDisabled(key, enabled)}
                        title={enabled ? "Enabled — click to hide" : "Disabled — click to show"}
                        className={[
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          enabled
                            ? "border-bronze-500 bg-bronze-500"
                            : "border-ink-700 hover:border-parchment-600",
                        ].join(" ")}
                      >
                        {enabled && (
                          <span className="h-1.5 w-1.5 rounded-sm bg-ink-950" />
                        )}
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-parchment-100">
                        {m.id}
                      </span>
                      {m.contextLength && (
                        <span className="font-mono text-[10px] text-parchment-600">
                          {formatK(m.contextLength)} ctx
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>

      <SectionHeading
        className="mt-8"
        title="Default models"
        subtitle="Pre-selected when you open a new conversation or workspace."
      />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DefaultModelPicker
          label="New conversations"
          models={enabledModels}
          value={settings.defaultConversationModel}
          onChange={(v) => setSettings({ defaultConversationModel: v })}
        />
        <DefaultModelPicker
          label="New workspaces"
          models={enabledModels}
          value={settings.defaultWorkspaceModel}
          onChange={(v) => setSettings({ defaultWorkspaceModel: v })}
        />
      </div>
    </div>
  );
}

function EndpointCard({
  name,
  url,
  status,
  error,
  onChange,
  onRemove,
  canRemove,
}: {
  id: string;
  name: string;
  url: string;
  status: string;
  error: boolean;
  onChange: (patch: { name?: string; url?: string }) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name"
          className="w-36 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-parchment-100 focus:border-bronze-600 focus:outline-none"
        />
        <input
          value={url}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="http://localhost:8080"
          spellCheck={false}
          className="flex-1 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
        />
        {canRemove && (
          <ConfirmDelete
            label="Remove endpoint"
            message="Remove endpoint?"
            onConfirm={onRemove}
            stopPropagation={false}
          />
        )}
      </div>
      <div
        className={[
          "mt-2 font-mono text-[11px]",
          error ? "text-signal-err" : "text-parchment-600",
        ].join(" ")}
      >
        {status}
      </div>
    </div>
  );
}

function AddEndpoint({ onAdd }: { onAdd: (name: string, url: string) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  function add() {
    if (!url.trim()) return;
    onAdd(name.trim() || "Endpoint", url.trim());
    setName("");
    setUrl("");
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink-700 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="w-36 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="http://192.168.1.50:8080"
        spellCheck={false}
        className="flex-1 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
      />
      <button
        onClick={add}
        disabled={!url.trim()}
        className="flex items-center gap-1.5 rounded-md bg-bronze-500 px-3 py-1.5 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:opacity-30"
      >
        <IconPlus className="h-3.5 w-3.5" />
        Add
      </button>
    </div>
  );
}

function DefaultModelPicker({
  label,
  models,
  value,
  onChange,
}: {
  label: string;
  models: ReturnType<typeof resolveEnabledModels>;
  value?: string;
  onChange: (v: string | undefined) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: typeof models }>();
    for (const m of models) {
      if (!map.has(m.endpointId)) map.set(m.endpointId, { name: m.endpointName, items: [] });
      map.get(m.endpointId)!.items.push(m);
    }
    return [...map.values()];
  }, [models]);

  return (
    <div>
      <label className="block text-xs text-parchment-400">{label}</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="mt-1 w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
      >
        <option value="">First available</option>
        {groups.map((g) => (
          <optgroup key={g.name} label={g.name}>
            {g.items.map((m) => (
              <option key={m.key} value={m.key}>
                {m.modelId}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------- System ------------------------------- */

function SystemSection() {
  return (
    <div className="p-5">
      <SectionHeading
        title="Reasoning"
        subtitle="How Mimir surfaces model thinking."
      />
      <p className="mt-3 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-xs leading-relaxed text-parchment-600">
        Mimir reads both inline{" "}
        <span className="font-mono text-parchment-400">&lt;think&gt;</span> tags
        and llama.cpp&apos;s separate{" "}
        <span className="font-mono text-parchment-400">reasoning_content</span>{" "}
        field, so the thinking panel works on the default server config. If you
        never see thinking, your model may not be a reasoning model, or reasoning
        may be disabled — try launching with{" "}
        <span className="font-mono text-parchment-400">--reasoning-budget -1</span>.
      </p>

      <SectionHeading
        className="mt-8"
        title="Privacy"
        subtitle="Where your data goes."
      />
      <p className="mt-3 text-sm leading-relaxed text-parchment-400">
        Conversations, memories, skills, and settings are stored locally in your
        browser. Prompts are sent only to the endpoints you configure. Nothing
        is sent anywhere else unless you use an externally hosted endpoint.
      </p>
    </div>
  );
}

/* ------------------------------- Account ------------------------------- */

function AccountSection() {
  const settings = useMimir((s) => s.settings);
  const setSettings = useMimir((s) => s.setSettings);
  const [username, setUsername] = useState(settings.username);

  const dirty = username.trim() !== settings.username;

  return (
    <div className="p-5">
      <SectionHeading
        title="Profile"
        subtitle="Shown in the sidebar. Local only — there are no accounts."
      />
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="admin"
        className="mt-4 w-64 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
      />
      <div className="mt-4">
        <button
          onClick={() => setSettings({ username: username.trim() || "admin" })}
          disabled={!dirty}
          className="rounded-md bg-bronze-500 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:opacity-30"
        >
          Save
        </button>
      </div>
    </div>
  );
}

/* ------------------------------- shared ------------------------------- */

function SectionHeading({
  title,
  subtitle,
  className = "",
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-parchment-100">{title}</h2>
      {subtitle && <p className="mt-1 text-xs text-parchment-600">{subtitle}</p>}
    </div>
  );
}

function formatK(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
