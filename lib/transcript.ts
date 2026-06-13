/**
 * Splits an assistant message's raw content into ordered segments for display.
 * The content can contain:
 *   - <think>…</think> reasoning blocks (emitted by reasoning models)
 *   - ⟦tool:N⟧ markers where a tool call occurred (injected by the tool loop)
 *   - ordinary markdown text
 *
 * Segments come back in document order so the chat can render thinking panels,
 * tool chips, and prose exactly where they appear in the stream.
 */

export type Segment =
  | { type: "think"; text: string; open: boolean }
  | { type: "tool"; index: number }
  | { type: "text"; text: string };

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
const TOOL_RE = /⟦tool:(\d+)⟧/;

export function parseTranscript(content: string): Segment[] {
  const segments: Segment[] = [];
  let rest = content;

  while (rest.length > 0) {
    const thinkStart = rest.indexOf(THINK_OPEN);
    const toolMatch = rest.match(TOOL_RE);
    const toolStart = toolMatch ? toolMatch.index! : -1;

    // Find whichever special token comes first.
    const nextSpecial = [thinkStart, toolStart].filter((i) => i >= 0);
    if (nextSpecial.length === 0) {
      pushText(segments, rest);
      break;
    }
    const at = Math.min(...nextSpecial);

    // Emit any plain text before the token.
    if (at > 0) pushText(segments, rest.slice(0, at));

    if (at === thinkStart) {
      const after = rest.slice(at + THINK_OPEN.length);
      const closeIdx = after.indexOf(THINK_CLOSE);
      if (closeIdx === -1) {
        // Still streaming inside the think block — no close tag yet.
        segments.push({ type: "think", text: after, open: true });
        break;
      }
      segments.push({
        type: "think",
        text: after.slice(0, closeIdx),
        open: false,
      });
      rest = after.slice(closeIdx + THINK_CLOSE.length);
    } else {
      // Tool marker.
      segments.push({ type: "tool", index: Number(toolMatch![1]) });
      rest = rest.slice(at + toolMatch![0].length);
    }
  }

  return segments;
}

function pushText(segments: Segment[], text: string) {
  if (text.trim().length === 0) return;
  segments.push({ type: "text", text });
}
