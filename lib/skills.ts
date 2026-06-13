import { Skill } from "./types";
import { ToolHandler } from "./tools";

/**
 * Skills reach the model by progressive disclosure — the same pattern real
 * skill systems use, because you can't fit every skill's full text in context:
 *
 *   1. DISCOVERY. Enabled skills' name + description go into the system prompt
 *      as a short menu. Cheap: one line per skill.
 *   2. ACTIVATION. When a task matches, the model calls `load_skill(name)`.
 *      The handler returns that skill's full SKILL.md body as the tool result,
 *      and the tool loop feeds it back so the model can follow the procedure.
 *   3. EXECUTION (not yet). If a skill references scripts, running them needs a
 *      sandboxed backend. Until that exists, `load_skill` notes which scripts
 *      the skill defines but cannot run them.
 *
 * Discovery costs almost nothing; the expensive full body is only pulled in
 * when actually needed.
 */

/** Builds the discovery menu injected into the system prompt. */
export function buildSkillsPrompt(skills: Skill[]): string | null {
  const active = skills.filter((s) => s.enabled);
  if (active.length === 0) return null;

  const lines = [
    "You have access to skills — reusable procedures you can load when a task matches one. To use a skill, call the load_skill tool with its name; you will receive its full instructions. Available skills:",
  ];
  for (const s of active) {
    lines.push(`- ${s.name}: ${s.description}`);
  }
  return lines.join("\n");
}

/**
 * Builds the `load_skill` registry entry. `lookup` resolves a skill by name
 * (wired to the store in ChatView). The handler returns the full body, plus a
 * note about any scripts the skill defines — which cannot run yet.
 */
export function loadSkillTool(lookup: (name: string) => Skill | null): ToolHandler {
  return {
    def: {
      type: "function",
      function: {
        name: "load_skill",
        description:
          "Load the full instructions for a skill by name. Call this when the user's task matches a skill from the available list.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The skill's name, exactly as listed.",
            },
          },
          required: ["name"],
        },
      },
    },
    run: (args) => {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) return "Error: a skill 'name' is required.";
      const skill = lookup(name);
      if (!skill) {
        return `Error: no skill named "${name}". Check the available skills list.`;
      }
      if (!skill.enabled) {
        return `The skill "${name}" is currently disabled.`;
      }

      let out = skill.body.trim();
      if (skill.scripts.length > 0) {
        out +=
          `\n\n---\nThis skill defines scripts: ${skill.scripts.join(", ")}. ` +
          "Script execution is not available yet, so describe what you would run rather than attempting to run it.";
      }
      return out;
    },
  };
}

/**
 * Parses a raw SKILL.md into a partial skill. Supports YAML-style frontmatter
 * with `name:` and `description:` keys; falls back to the first heading and the
 * first paragraph if there's no frontmatter. Script references are picked up
 * from a `scripts:` frontmatter list or inferred from fenced paths like
 * `scripts/foo.py` in the body.
 */
export function parseSkillMarkdown(raw: string): {
  name: string;
  description: string;
  body: string;
  scripts: string[];
} {
  const text = raw.replace(/\r\n/g, "\n");
  let name = "";
  let description = "";
  const scripts = new Set<string>();
  let body = text;

  // Frontmatter block: --- ... ---
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    const block = fm[1];
    body = text.slice(fm[0].length).trim();
    for (const line of block.split("\n")) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === "name") name = value.trim();
      else if (key === "description") description = value.trim();
      else if (key === "scripts") {
        value
          .replace(/[[\]]/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((s) => scripts.add(s));
      }
    }
  }

  // Fallbacks from the body.
  if (!name) {
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) name = heading[1].trim();
  }
  if (!description) {
    const para = body
      .split("\n\n")
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith("#"));
    if (para) description = para.replace(/\n/g, " ").slice(0, 200);
  }

  // Infer script references from the body (e.g. scripts/run.py, ./tool.sh).
  const scriptRe = /(?:^|\s)((?:\.\/|scripts\/)[\w./-]+\.(?:py|sh|js|ts|rb))/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(body))) {
    scripts.add(match[1]);
  }

  return {
    name: name || "untitled-skill",
    description: description || "No description provided.",
    body,
    scripts: [...scripts],
  };
}
