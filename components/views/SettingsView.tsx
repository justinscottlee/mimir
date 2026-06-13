"use client";

import { useState } from "react";
import { useTalos } from "@/lib/store";
import { listModels } from "@/lib/llama";

export default function SettingsView() {
  const settings = useTalos((s) => s.settings);
  const setSettings = useTalos((s) => s.setSettings);

  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [username, setUsername] = useState(settings.username);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "ok"; models: string[] }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function testConnection() {
    setStatus({ kind: "testing" });
    try {
      const models = await listModels(endpoint);
      setStatus({ kind: "ok", models: models.map((m) => m.id) });
    } catch (e) {
      setStatus({ kind: "err", message: (e as Error).message });
    }
  }

  function save() {
    setSettings({ endpoint: endpoint.trim(), username: username.trim() || "operator" });
  }

  const dirty =
    endpoint.trim() !== settings.endpoint || username.trim() !== settings.username;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-bronze-500">
        Configuration
      </div>
      <h1 className="mt-2 text-xl font-semibold">Settings</h1>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-parchment-100">
          llama.cpp endpoint
        </h2>
        <p className="mt-1 text-sm text-parchment-600">
          Base URL of a llama-server instance. Multi-model serving works if the
          server exposes more than one model on /v1/models.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://localhost:8080"
            spellCheck={false}
            className="flex-1 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
          />
          <button
            onClick={testConnection}
            disabled={status.kind === "testing"}
            className="rounded-md border border-ink-700 px-4 py-2 text-sm text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100 disabled:opacity-50"
          >
            {status.kind === "testing" ? "Testing…" : "Test connection"}
          </button>
        </div>

        {status.kind === "ok" && (
          <div className="mt-3 rounded-md border border-signal-ok/40 bg-signal-ok/10 px-3 py-2 text-sm text-signal-ok">
            Connected. {status.models.length} model
            {status.models.length === 1 ? "" : "s"} available
            {status.models.length > 0 ? `: ${status.models.join(", ")}` : ""}.
          </div>
        )}
        {status.kind === "err" && (
          <div className="mt-3 rounded-md border border-signal-err/40 bg-signal-err/10 px-3 py-2 text-sm text-signal-err">
            {status.message}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-parchment-100">Profile</h2>
        <p className="mt-1 text-sm text-parchment-600">
          Shown in the sidebar. Local only — there are no accounts.
        </p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="operator"
          className="mt-3 w-64 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
        />
      </section>

      <div className="mt-10 flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty}
          className="rounded-md bg-bronze-500 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:opacity-30"
        >
          Save changes
        </button>
        {dirty && (
          <span className="text-xs text-parchment-600">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}
