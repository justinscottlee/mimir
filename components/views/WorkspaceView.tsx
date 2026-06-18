"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMimir } from "@/lib/store";
import {
  EndpointLoad,
  loadAllModels,
  resolveEnabledModels,
} from "@/lib/models";
import { AgentRun, ResolvedModel } from "@/lib/types";
import { useWorkspaceRunner } from "@/lib/workspace/useWorkspaceRunner";
import { useIsMobile } from "@/lib/useMediaQuery";
import * as Icons from "@/components/icons";
import FileExplorer from "./workspace/FileExplorer";
import FileEditor from "./workspace/FileEditor";
import AgentPanel from "./workspace/AgentPanel";
import AgentSettings from "./workspace/AgentSettings";
import WorkspaceAgentSidebar from "./workspace/WorkspaceAgentSidebar";
import Terminal from "./workspace/Terminal";

type CenterTab = "agent" | "terminal" | "file";
type MobilePane = "files" | "main" | "agents";

/**
 * The workspace workbench: a model picker and agent controls up top, a file
 * explorer for the sandbox on the left, the agent transcript (or a file editor)
 * in the center, and an agent composer at the bottom. The composer either starts
 * a new lead agent or continues (re-prompts) the selected one, so an agent is a
 * durable, resumable conversation rather than a throwaway. All run execution is
 * delegated to the workspace runner hook, which streams steps, plan updates, and
 * sub-agent activity straight into the store.
 */
export default function WorkspaceView({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const workspace = useMimir((s) => s.workspaces[workspaceId]);
  const settings = useMimir((s) => s.settings);
  const setWorkspaceModel = useMimir((s) => s.setWorkspaceModel);
  const setWorkspaceName = useMimir((s) => s.setWorkspaceName);

  const runner = useWorkspaceRunner(workspaceId);

  const [loads, setLoads] = useState<EndpointLoad[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [centerTab, setCenterTab] = useState<CenterTab>("agent");
  const [mobilePane, setMobilePane] = useState<MobilePane>("main");
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  const models = useMemo(
    () => resolveEnabledModels(loads, settings.disabledModels),
    [loads, settings.disabledModels]
  );

  // All runs are top-level agents (sub-agents were removed), and the focused run.
  const leadRuns = useMemo(
    () => workspace?.runs ?? [],
    [workspace?.runs]
  );
  const activeRun = useMemo(() => {
    const runs = workspace?.runs ?? [];
    if (runs.length === 0) return undefined;
    return (
      runs.find((r) => r.id === activeRunId) ??
      leadRuns[leadRuns.length - 1] ??
      runs[runs.length - 1]
    );
  }, [workspace?.runs, leadRuns, activeRunId]);

  // "running" reflects whether the focused run's loop is currently executing.
  // We track it reactively off the store status plus the runner's live set so
  // the composer flips between Stop and Send correctly.
  const liveByStatus = activeRun?.status === "running";
  useEffect(() => {
    setRunning(liveByStatus || runner.isRunning(activeRun?.id));
  }, [liveByStatus, activeRun?.id, runner]);

  // Grow the composer with its content, like the conversation composer does.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  const endpointsKey = settings.endpoints.map((e) => e.id + e.url).join("|");
  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    loadAllModels(settings.endpoints).then((res) => {
      if (cancelled) return;
      setLoads(res);
      setLoadingModels(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointsKey]);

  // Keep the workspace pointed at a valid model.
  useEffect(() => {
    if (models.length === 0) return;
    const current = useMimir.getState().workspaces[workspaceId];
    if (!current) return;
    const stillValid =
      current.model && models.some((m) => m.key === current.model);
    if (!stillValid) {
      const fallback =
        settings.defaultWorkspaceModel &&
        models.some((m) => m.key === settings.defaultWorkspaceModel)
          ? settings.defaultWorkspaceModel
          : models[0].key;
      setWorkspaceModel(workspaceId, fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, workspaceId]);

  const selectFile = useCallback((path: string) => {
    if (!path) {
      setSelectedFilePath("");
      setCenterTab("agent");
      return;
    }
    setSelectedFilePath(path);
    setCenterTab("file");
    setMobilePane("main");
  }, []);

  const stop = useCallback(() => {
    if (activeRun) runner.stop(activeRun.id);
  }, [runner, activeRun]);

  /** Start a brand-new lead agent (an explicit, deliberate action). */
  const startNewAgent = useCallback(
    async (goal: string) => {
      setRunError(null);
      setCenterTab("agent");
      setMobilePane("main");
      const runId = await runner.startLead(goal);
      if (runId) setActiveRunId(runId);
    },
    [runner]
  );

  /** Continue the focused agent with a new instruction (same context). */
  const continueAgent = useCallback(
    async (text: string) => {
      if (!activeRun) return;
      setRunError(null);
      setCenterTab("agent");
      setMobilePane("main");
      await runner.reprompt(activeRun.id, text);
    },
    [runner, activeRun]
  );

  // Whether sending continues the focused agent or there's no agent to continue.
  // A fresh workspace starts a new agent; otherwise Send re-prompts the focused
  // one.
  const focusedLead = activeRun ?? undefined;
  const canContinue = !!focusedLead && !running;

  function submitPrompt() {
    const text = prompt.trim();
    if (!text || running) return;
    setPrompt("");
    if (focusedLead) void continueAgent(text);
    else void startNewAgent(text);
  }

  function submitNewAgent() {
    const text = prompt.trim();
    if (!text || running) return;
    setPrompt("");
    void startNewAgent(text);
  }

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-parchment-600">
        This workspace no longer exists.
      </div>
    );
  }

  const hasModels = models.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <WorkspaceName
          name={workspace.name}
          onRename={(n) => setWorkspaceName(workspaceId, n)}
        />
        <div className="flex-1" />
        {loadingModels ? (
          <span className="font-mono text-[10px] text-parchment-600">
            loading models…
          </span>
        ) : hasModels ? (
          <ModelSelect
            models={models}
            value={workspace.model}
            disabled={running}
            onChange={(key) => setWorkspaceModel(workspaceId, key)}
          />
        ) : (
          <span className="font-mono text-[10px] text-signal-err">
            no models — add an endpoint in Settings
          </span>
        )}
        <AgentSettings workspaceId={workspaceId} disabled={running} />
      </div>

      {/* Mobile pane switch */}
      {isMobile && (
        <div className="flex items-center gap-1 border-b border-ink-700 px-3 py-1.5">
          <PaneTab
            label="Files"
            active={mobilePane === "files"}
            onClick={() => setMobilePane("files")}
          />
          <PaneTab
            label={
              centerTab === "file"
                ? "Editor"
                : centerTab === "terminal"
                ? "Terminal"
                : "Agent"
            }
            active={mobilePane === "main"}
            onClick={() => setMobilePane("main")}
          />
          <PaneTab
            label="Agents"
            active={mobilePane === "agents"}
            onClick={() => setMobilePane("agents")}
          />
        </div>
      )}

      {/* Body: explorer | center */}
      <div className="flex min-h-0 flex-1">
        {(!isMobile || mobilePane === "files") && (
          <div
            className={[
              "shrink-0 border-r border-ink-700 bg-ink-900/30",
              isMobile ? "w-full" : "w-64",
            ].join(" ")}
          >
            <FileExplorer
              workspaceId={workspaceId}
              selectedPath={selectedFilePath || null}
              onSelect={selectFile}
            />
          </div>
        )}

        {(!isMobile || mobilePane === "main") && (
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Center tabs */}
            <div className="flex items-center gap-1 border-b border-ink-700 px-3 py-1.5">
              <CenterTabButton
                icon={<Icons.IconSpark className="h-4 w-4" />}
                label="Agent"
                active={centerTab === "agent"}
                onClick={() => setCenterTab("agent")}
              />
              <CenterTabButton
                icon={<Icons.IconTerminal className="h-4 w-4" />}
                label="Terminal"
                active={centerTab === "terminal"}
                onClick={() => setCenterTab("terminal")}
              />
              {selectedFilePath && (
                <CenterTabButton
                  icon={<Icons.IconFile className="h-4 w-4" />}
                  label={baseName(selectedFilePath)}
                  active={centerTab === "file"}
                  onClick={() => setCenterTab("file")}
                  onClose={() => selectFile("")}
                />
              )}
            </div>

            <div className="min-h-0 flex-1">
              {centerTab === "file" && selectedFilePath ? (
                <FileEditor
                  workspaceId={workspaceId}
                  path={selectedFilePath}
                  onClose={() => selectFile("")}
                />
              ) : centerTab === "terminal" ? (
                <Terminal workspaceId={workspaceId} />
              ) : (
                <AgentPanel
                  workspaceId={workspaceId}
                  activeRunId={activeRun?.id ?? null}
                  running={running}
                  runner={runner}
                  onSelectRun={(id) => setActiveRunId(id || null)}
                  onOpenFile={selectFile}
                />
              )}
            </div>
          </div>
        )}

        {/* Right sidebar: plan (top) + agent/sub-agent hierarchy (bottom). The
            sole means of navigating between agents and sub-agents. */}
        {(!isMobile || mobilePane === "agents") && (
          <div
            className={[
              "shrink-0 border-l border-ink-700 bg-ink-900/30",
              isMobile ? "w-full" : "w-72",
            ].join(" ")}
          >
            <WorkspaceAgentSidebar
              workspaceId={workspaceId}
              selectedRun={activeRun}
            />
          </div>
        )}
      </div>

      {/* Agent composer */}
      <div className="border-t border-ink-700 px-3 py-2.5">
        {runError && (
          <div className="mb-2 rounded-md border border-signal-err/40 bg-signal-err/10 px-3 py-1.5 text-xs text-signal-err">
            {runError}
          </div>
        )}
        {/* Mode line: continuing an agent vs starting a new one. */}
        {!running && focusedLead && (
          <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] text-parchment-600">
            <Icons.IconSpark className="h-3.5 w-3.5 text-bronze-400" />
            <span>
              Continuing{" "}
              <span className="text-parchment-400">
                {truncate(focusedLead.title ?? focusedLead.goal, 40)}
              </span>{" "}
              in its existing context.
            </span>
            <button
              onClick={submitNewAgent}
              disabled={!prompt.trim() || !hasModels}
              className="ml-auto rounded px-1.5 py-0.5 text-bronze-300 underline-offset-2 transition-colors hover:bg-ink-800 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
              title="Start a separate new agent with this instruction instead"
            >
              Start new agent instead
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitPrompt();
              }
            }}
            rows={1}
            disabled={running}
            placeholder={
              running
                ? "Agent is working…"
                : canContinue
                ? "Send the agent a follow-up instruction — it continues where it left off."
                : "Describe a task for a new agent — e.g. “Create a Python script that prints the first 20 primes, then a README explaining it.”"
            }
            spellCheck={false}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm leading-relaxed text-parchment-100 placeholder:text-parchment-600/70 focus:border-bronze-600 focus:outline-none disabled:opacity-60"
          />
          {running ? (
            <button
              onClick={stop}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-signal-err/50 bg-signal-err/10 px-3.5 text-sm font-medium text-signal-err transition-colors hover:bg-signal-err/20"
            >
              <Icons.IconStop className="h-4 w-4" />
              Stop
            </button>
          ) : (
            <button
              onClick={submitPrompt}
              disabled={!prompt.trim() || !hasModels}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-bronze-600/60 bg-bronze-600/15 px-3.5 text-sm font-medium text-bronze-300 transition-colors hover:bg-bronze-600/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {canContinue ? (
                <>
                  <Icons.IconSend className="h-4 w-4" />
                  Send
                </>
              ) : (
                <>
                  <Icons.IconPlay className="h-4 w-4" />
                  Run
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ------------------------------ subcomponents ---------------------------- */

function WorkspaceName({
  name,
  onRename,
}: {
  name: string;
  onRename: (n: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  function commit() {
    const n = draft.trim();
    if (n && n !== name) onRename(n);
    else setDraft(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        className="min-w-0 max-w-[14rem] rounded border border-ink-700 bg-ink-850 px-2 py-1 text-sm text-parchment-100 focus:border-bronze-600 focus:outline-none"
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      title="Rename workspace"
      className="group flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-parchment-100 transition-colors hover:bg-ink-800"
    >
      <span className="truncate">{name}</span>
      <Icons.IconPencil className="h-3.5 w-3.5 shrink-0 text-parchment-600 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function ModelSelect({
  models,
  value,
  disabled,
  onChange,
}: {
  models: ResolvedModel[];
  value?: string;
  disabled?: boolean;
  onChange: (key: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: ResolvedModel[] }>();
    for (const m of models) {
      if (!map.has(m.endpointId)) {
        map.set(m.endpointId, { name: m.endpointName, items: [] });
      }
      map.get(m.endpointId)!.items.push(m);
    }
    return [...map.values()];
  }, [models]);

  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 max-w-[45vw] rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-parchment-100 disabled:opacity-50 md:max-w-[18rem]"
    >
      {groups.length === 1
        ? groups[0].items.map((m) => (
            <option key={m.key} value={m.key}>
              {m.modelId}
            </option>
          ))
        : groups.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.items.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.modelId}
                </option>
              ))}
            </optgroup>
          ))}
    </select>
  );
}

function CenterTabButton({
  icon,
  label,
  active,
  onClick,
  onClose,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={[
        "flex items-center gap-1.5 rounded-md pl-2 pr-1 py-1 text-xs transition-colors",
        active
          ? "bg-ink-800 text-parchment-100"
          : "text-parchment-600 hover:text-parchment-100",
      ].join(" ")}
    >
      <button onClick={onClick} className="flex items-center gap-1.5">
        {icon}
        <span className="max-w-[12rem] truncate font-mono">{label}</span>
      </button>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close file"
          className="rounded p-0.5 text-parchment-600 hover:bg-ink-700 hover:text-parchment-100"
        >
          <Icons.IconClose className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function PaneTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-ink-800 text-parchment-100" : "text-parchment-600",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
