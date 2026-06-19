import { ToolHandler } from "../tools";
import { WorkspaceExecResult, WorkspaceFile } from "../types";
import { api } from "../api";
import { DEFAULT_TOOL_OUTPUT_LIMITS } from "../defaults";
import { WorkspaceFsApi } from "./filesystemTool";

/**
 * The execution tool. Where the filesystem tools let the agent read and write
 * files, this lets it actually *run* them: `run_command` executes a shell
 * command inside the workspace's Docker sandbox (cwd /workspace) and returns the
 * combined stdout/stderr and exit code. Like the web tools, the handler runs
 * client-side and POSTs to a server route (`/api/workspaces/:id/exec`) which
 * owns the container; the route returns the post-run filesystem, which we write
 * straight back into the store so files the command created show up in the
 * explorer.
 *
 * The agent is told it has a real shell so it can verify its own work — run the
 * script it just wrote, read the traceback, fix, and re-run.
 */

const RUN_COMMAND_DESCRIPTION =
  "Run a shell command inside this workspace's sandbox — a real Linux container whose working directory is /workspace, where your files live. Use this to actually execute and verify your work: run scripts, run tests, compile, inspect output, and react to errors. This is the difference between writing code and knowing it works — after writing a program, RUN it and check the result instead of assuming.\n" +
  "\n" +
  "HOW to use it well:\n" +
  "- The command runs through `sh -c`, so pipes, redirects, `&&`, and quoting all work (e.g. `python main.py`, `pytest -q`, `ls -la`, `cat out.txt`).\n" +
  "- Your files are already in /workspace — write them with write_file first, then run them here. Output files a command creates appear back in your filesystem automatically.\n" +
  "- Read the exit code and stderr. If a run fails, read the error, fix the file with edit_file, and run again.\n" +
  "- State persists between commands within a run (installed packages, created files), so you can `pip install` then use the package in a later command — but only if the sandbox has network access, which it may not.\n" +
  "- Long-running or interactive commands won't work: each command runs to completion under a time limit, with no interactive stdin. Don't start servers or REPLs that wait for input.\n" +
  "\n" +
  "If the result says the sandbox is unavailable, code execution is not configured — fall back to writing the files and explaining how to run them.";

export function buildRunCommandTool(
  workspaceId: string,
  fsApi: WorkspaceFsApi,
  signal?: AbortSignal,
  commandOutputCap: number = DEFAULT_TOOL_OUTPUT_LIMITS.commandOutputChars
): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "run_command",
        description: RUN_COMMAND_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The shell command to run in /workspace, e.g. \"python main.py\" or \"pytest -q\".",
            },
          },
          required: ["command"],
        },
      },
    },
    run: async (args) => {
      const command =
        typeof args.command === "string" ? args.command.trim() : "";
      if (!command) return "Error: a non-empty 'command' is required.";

      let payload: { result: WorkspaceExecResult; files: WorkspaceFile[] };
      try {
        payload = await api.execWorkspaceCommand(
          workspaceId,
          command,
          fsApi.getFiles(),
          signal
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          return "Command cancelled (the run was stopped).";
        }
        return `Error: could not run the command — ${(e as Error).message}. The execution sandbox may be unavailable (Docker not running or not configured).`;
      }

      // Reflect any filesystem changes the command made back into the store.
      if (Array.isArray(payload.files)) {
        fsApi.setFiles(payload.files);
      }

      return formatResult(payload.result, commandOutputCap);
    },
  };
}

/** Format an execution result as a compact, model-friendly transcript. */
export function formatResult(
  r: WorkspaceExecResult,
  outputCap: number = DEFAULT_TOOL_OUTPUT_LIMITS.commandOutputChars
): string {
  const status = r.timedOut
    ? `timed out after ${(r.durationMs / 1000).toFixed(1)}s (killed)`
    : `exit ${r.exitCode} · ${(r.durationMs / 1000).toFixed(1)}s`;

  const lines: string[] = [`$ ${r.command}`, `(${status})`];

  if (r.cwd && r.cwd !== "/workspace") {
    lines.push(`(working directory: ${r.cwd})`);
  }

  const stdout = r.stdout.trim();
  const stderr = r.stderr.trim();
  if (stdout) {
    lines.push("", "stdout:", clip(stdout, outputCap));
  }
  if (stderr) {
    lines.push("", "stderr:", clip(stderr, outputCap));
  }
  if (!stdout && !stderr) {
    lines.push("", "(no output)");
  }
  if (r.truncated) {
    lines.push("", "(output truncated)");
  }
  if (r.skippedFiles && r.skippedFiles.length > 0) {
    lines.push(
      "",
      `(${r.skippedFiles.length} file(s) were too large or binary to load into the editor: ${r.skippedFiles
        .slice(0, 8)
        .join(", ")}${r.skippedFiles.length > 8 ? ", …" : ""})`
    );
  }
  return lines.join("\n");
}

// Keep tool-result output bounded so a noisy command can't flood the context.
function clip(s: string, cap: number): string {
  return s.length > cap ? s.slice(0, cap) + "\n…(truncated)" : s;
}
