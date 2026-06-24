import { WorkspaceFile } from "../types";
import { ToolHandler, ToolRegistry } from "../tools";
import { DEFAULT_TOOL_OUTPUT_LIMITS } from "../defaults";
import * as fs from "./fs";

/**
 * The filesystem toolset the workspace agent uses to operate on its sandboxed
 * virtual filesystem. Built the same way as `rememberTool` / the web tools: the
 * model only emits an intent (a tool call), and the handler performs the
 * mutation through a small injected API so the store stays the owner of the
 * data. The handlers are deliberately backend-agnostic — they go through the
 * pure ops in ./fs and a `WorkspaceFsApi`, so swapping the in-store virtual FS
 * for a container-backed one later means reimplementing only this file's API.
 *
 * Every path is scoped to one workspace's tree; there is no escape to the host.
 * That capability boundary is the sandbox.
 */

/** The thin surface the tools read/write the workspace filesystem through. */
export interface WorkspaceFsApi {
  getFiles: () => WorkspaceFile[];
  setFiles: (files: WorkspaceFile[]) => void;
}

function listFilesTool(api: WorkspaceFsApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "list_files",
        description:
          "List the workspace filesystem as an indented tree. Call this to see what already exists before reading or writing — at the start of a task, and again after creating or moving files if you need to reorient. Pass a `path` to list a single subtree, or omit it to list everything from the root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Optional directory to list from, e.g. \"/src\". Defaults to the root \"/\".",
            },
          },
        },
      },
    },
    run: (args) => {
      const files = api.getFiles();
      const path = typeof args.path === "string" && args.path.trim() ? args.path : "/";
      const node = fs.findNode(files, path);
      if (path !== "/" && !node) {
        return `Error: no such path: "${fs.normalizePath(path)}".`;
      }
      if (node && node.type === "file") {
        return `"${node.path}" is a file, not a directory. Use read_file to read it.`;
      }
      const stats = fs.fsStats(files);
      const tree = fs.renderTree(files, path);
      return `${tree}\n\n(${stats.files} files, ${stats.dirs} dirs, ${fs.humanBytes(
        stats.bytes
      )} total)`;
    },
  };
}

function readFileTool(api: WorkspaceFsApi, readCharCap: number): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Read the full contents of a file. Use this before editing a file so your edit targets the exact current text. Optionally pass a 1-based line range to read just part of a large file.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file to read, e.g. \"/src/main.py\".",
            },
            start_line: {
              type: "integer",
              description: "Optional 1-based first line to return (inclusive).",
            },
            end_line: {
              type: "integer",
              description: "Optional 1-based last line to return (inclusive).",
            },
          },
          required: ["path"],
        },
      },
    },
    run: (args) => {
      const files = api.getFiles();
      const path = typeof args.path === "string" ? args.path : "";
      const node = fs.findNode(files, path);
      if (!node) return `Error: no such file: "${fs.normalizePath(path)}".`;
      if (node.type === "dir") {
        return `Error: "${node.path}" is a directory. Use list_files to see its contents.`;
      }
      // Binary files are stored base64; surfacing that to the model is useless
      // (and huge). Report it instead of dumping the encoded bytes.
      if (fs.isBinary(node)) {
        return `"${node.path}" is a binary file (${fs.nodeSize(
          node
        )}); its contents aren't text and can't be shown.`;
      }
      const total = fs.lineCount(node.content);
      const start = numArg(args.start_line);
      const end = numArg(args.end_line);

      let body = node.content;
      let rangeNote = "";
      if (start != null || end != null) {
        const lines = node.content.split("\n");
        const from = Math.max(1, start ?? 1);
        const to = Math.min(lines.length, end ?? lines.length);
        body = lines.slice(from - 1, to).join("\n");
        rangeNote = ` (lines ${from}–${to} of ${total})`;
      }

      let truncated = "";
      if (body.length > readCharCap) {
        body = body.slice(0, readCharCap);
        truncated =
          "\n\n…(truncated — read a line range to see the rest rather than guessing it)";
      }

      if (node.content === "") {
        return `"${node.path}" is empty (0 lines).`;
      }
      return `${node.path}${rangeNote} — ${total} lines:\n\n${body}${truncated}`;
    },
  };
}

function writeFileTool(api: WorkspaceFsApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Create a new file or overwrite an existing one with the given content. Parent directories are created automatically. Use this for new files or full rewrites; for a small change to a large existing file, prefer edit_file so you don't have to restate the whole thing.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Destination path, e.g. \"/src/main.py\".",
            },
            content: {
              type: "string",
              description: "The complete file contents to write.",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    run: (args) => {
      const path = typeof args.path === "string" ? args.path : "";
      const content = typeof args.content === "string" ? args.content : "";
      if (!path.trim()) return "Error: a 'path' is required.";
      const { files, created } = fs.writeFile(api.getFiles(), path, content);
      api.setFiles(files);
      const norm = fs.normalizePath(path);
      return `${created ? "Created" : "Overwrote"} ${norm} (${fs.lineCount(
        content
      )} lines, ${fs.humanSize(content)}).`;
    },
  };
}

function editFileTool(api: WorkspaceFsApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "edit_file",
        description:
          "Replace one exact, unique occurrence of a string in a file with new text — the precise way to make a targeted change without rewriting the whole file. `old_str` must appear EXACTLY ONCE in the file (read_file first to copy it verbatim, including indentation); include enough surrounding context to make it unique. To delete text, pass an empty `new_str`.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file to edit.",
            },
            old_str: {
              type: "string",
              description:
                "The exact existing text to replace. Must match the file byte-for-byte and occur exactly once.",
            },
            new_str: {
              type: "string",
              description: "The replacement text. Empty string to delete old_str.",
            },
          },
          required: ["path", "old_str", "new_str"],
        },
      },
    },
    run: (args) => {
      const path = typeof args.path === "string" ? args.path : "";
      const oldStr = typeof args.old_str === "string" ? args.old_str : "";
      const newStr = typeof args.new_str === "string" ? args.new_str : "";
      if (!path.trim()) return "Error: a 'path' is required.";
      const files = fs.editFile(api.getFiles(), path, oldStr, newStr);
      api.setFiles(files);
      const node = fs.findNode(files, path)!;
      return `Edited ${node.path} (${fs.lineCount(node.content)} lines now).`;
    },
  };
}

function makeDirTool(api: WorkspaceFsApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "make_dir",
        description:
          "Create a directory (and any missing parent directories). You usually don't need this — write_file creates parents on its own — but it's useful to lay out an empty folder structure.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The directory to create, e.g. \"/src/components\".",
            },
          },
          required: ["path"],
        },
      },
    },
    run: (args) => {
      const path = typeof args.path === "string" ? args.path : "";
      if (!path.trim()) return "Error: a 'path' is required.";
      api.setFiles(fs.makeDir(api.getFiles(), path));
      return `Directory ${fs.normalizePath(path)} is ready.`;
    },
  };
}

function deletePathTool(api: WorkspaceFsApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "delete_path",
        description:
          "Delete a file, or a directory and everything inside it. This is irreversible within the run, so only delete what you're sure is no longer needed.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file or directory to delete.",
            },
          },
          required: ["path"],
        },
      },
    },
    run: (args) => {
      const path = typeof args.path === "string" ? args.path : "";
      if (!path.trim()) return "Error: a 'path' is required.";
      const { files, removed } = fs.deletePath(api.getFiles(), path);
      api.setFiles(files);
      return `Deleted ${fs.normalizePath(path)} (${removed} ${
        removed === 1 ? "node" : "nodes"
      } removed).`;
    },
  };
}

function movePathTool(api: WorkspaceFsApi): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "move_path",
        description:
          "Move or rename a file or directory (with all its contents). The destination must not already exist.",
        parameters: {
          type: "object",
          properties: {
            from: { type: "string", description: "The current path." },
            to: { type: "string", description: "The new path." },
          },
          required: ["from", "to"],
        },
      },
    },
    run: (args) => {
      const from = typeof args.from === "string" ? args.from : "";
      const to = typeof args.to === "string" ? args.to : "";
      if (!from.trim() || !to.trim()) {
        return "Error: both 'from' and 'to' are required.";
      }
      const { files, moved } = fs.movePath(api.getFiles(), from, to);
      api.setFiles(files);
      return `Moved ${fs.normalizePath(from)} → ${fs.normalizePath(
        to
      )} (${moved} ${moved === 1 ? "node" : "nodes"}).`;
    },
  };
}

/** Names of every filesystem tool, for display and gating. */
export const FILESYSTEM_TOOL_NAMES = [
  "list_files",
  "read_file",
  "write_file",
  "edit_file",
  "make_dir",
  "delete_path",
  "move_path",
] as const;

/** The argument keys a filesystem tool treats as paths. */
const PATH_ARG_KEYS = ["path", "from", "to"] as const;

/**
 * Wrap a filesystem tool so any path-shaped argument has a redundant leading
 * "/workspace" collapsed to the root before the handler runs (see
 * `fs.stripWorkspaceRoot`). This is what keeps an agent that writes to
 * "/workspace/app.py" — matching the shell cwd it was told about — from nesting
 * a second `workspace/` folder and then being unable to find its own file.
 * Empty/whitespace values are left untouched so the handlers' own
 * "a 'path' is required" checks still fire.
 */
function withWorkspacePaths(handler: ToolHandler): ToolHandler {
  return {
    def: handler.def,
    run: (args) => {
      const fixed: Record<string, unknown> = { ...args };
      for (const key of PATH_ARG_KEYS) {
        const v = fixed[key];
        if (typeof v === "string" && v.trim()) fixed[key] = fs.stripWorkspaceRoot(v);
      }
      return handler.run(fixed);
    },
  };
}

/** Builds the complete filesystem tool registry bound to a store-backed API. */
export function buildFilesystemTools(
  api: WorkspaceFsApi,
  readCharCap: number = DEFAULT_TOOL_OUTPUT_LIMITS.readFileChars
): ToolRegistry {
  return {
    list_files: withWorkspacePaths(listFilesTool(api)),
    read_file: withWorkspacePaths(readFileTool(api, readCharCap)),
    write_file: withWorkspacePaths(writeFileTool(api)),
    edit_file: withWorkspacePaths(editFileTool(api)),
    make_dir: withWorkspacePaths(makeDirTool(api)),
    delete_path: withWorkspacePaths(deletePathTool(api)),
    move_path: withWorkspacePaths(movePathTool(api)),
  };
}

function numArg(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Math.round(Number(v));
  }
  return null;
}
