/**
 * A small, dependency-free terminal emulator model. It consumes the raw byte
 * stream from a TTY (decoded to text) and maintains a grid of styled cells plus
 * a cursor, so the interactive terminal can render colored, overwriting output
 * (prompts, progress bars, `ls --color`, REPLs) without pulling in xterm.js.
 *
 * It implements the subset that matters for a workbench shell: SGR colors/styles
 * (16-color, 256-color, and truecolor), cursor movement, line/screen erase, tab
 * stops, carriage-return overwrite, and backspace. Full-screen TUIs that rely on
 * exotic sequences (alternate screen, complex scroll regions) degrade gracefully
 * rather than crash — the common cases look right.
 */

export interface CellStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

interface Cell {
  ch: string;
  style: CellStyle;
}

export interface TerminalState {
  lines: Cell[][];
  row: number;
  col: number;
  style: CellStyle;
  savedRow: number;
  savedCol: number;
  /** Incomplete escape sequence carried to the next feed. */
  pending: string;
}

/** A run of same-styled text, for rendering one line as a few spans. */
export interface Span {
  text: string;
  style: CellStyle;
  /** When set, this one-cell span is the cursor position (the UI draws a caret
   *  block here). Lets the caret track the true cursor column — e.g. after a
   *  backspace, where the cursor sits mid-line rather than at the end. */
  cursor?: boolean;
}

const MAX_LINES = 5000;
const TAB = 8;

export function createTerminal(): TerminalState {
  return {
    lines: [[]],
    row: 0,
    col: 0,
    style: {},
    savedRow: 0,
    savedCol: 0,
    pending: "",
  };
}

/* ------------------------------ color helpers ---------------------------- */

const BASE16 = [
  "#2a3037", "#d06c5b", "#7fb069", "#d99f54", "#6f9bd1", "#b48ead", "#7fc7c2", "#c9cdd3",
  "#4b525a", "#e08b7c", "#9cc77f", "#e8b878", "#8fb3df", "#c9a9c4", "#9bd6d1", "#ece7dd",
];

function xterm256(n: number): string {
  if (n < 16) return BASE16[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return rgb(v, v, v);
  }
  const c = n - 16;
  const r = Math.floor(c / 36);
  const g = Math.floor((c % 36) / 6);
  const b = c % 6;
  const conv = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return rgb(conv(r), conv(g), conv(b));
}

function rgb(r: number, g: number, b: number): string {
  const h = (x: number) => x.toString(16).padStart(2, "0");
  return `#${h(r & 255)}${h(g & 255)}${h(b & 255)}`;
}

/* ------------------------------- SGR (colors) ---------------------------- */

function applySgr(style: CellStyle, params: number[]): CellStyle {
  const s: CellStyle = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) {
      // reset
      s.fg = undefined;
      s.bg = undefined;
      s.bold = s.dim = s.underline = s.inverse = false;
    } else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 4) s.underline = true;
    else if (p === 7) s.inverse = true;
    else if (p === 22) s.bold = s.dim = false;
    else if (p === 24) s.underline = false;
    else if (p === 27) s.inverse = false;
    else if (p >= 30 && p <= 37) s.fg = BASE16[p - 30];
    else if (p >= 90 && p <= 97) s.fg = BASE16[p - 90 + 8];
    else if (p >= 40 && p <= 47) s.bg = BASE16[p - 40];
    else if (p >= 100 && p <= 107) s.bg = BASE16[p - 100 + 8];
    else if (p === 39) s.fg = undefined;
    else if (p === 49) s.bg = undefined;
    else if (p === 38 || p === 48) {
      // Extended color: 38;5;n  or  38;2;r;g;b
      const mode = params[i + 1];
      if (mode === 5) {
        const color = xterm256(params[i + 2] ?? 0);
        if (p === 38) s.fg = color;
        else s.bg = color;
        i += 2;
      } else if (mode === 2) {
        const color = rgb(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        if (p === 38) s.fg = color;
        else s.bg = color;
        i += 4;
      }
    }
  }
  return s;
}

/* --------------------------------- feeding ------------------------------- */

function ensureLine(t: TerminalState, row: number) {
  while (t.lines.length <= row) t.lines.push([]);
}

function ensureCol(line: Cell[], col: number, style: CellStyle) {
  while (line.length < col) line.push({ ch: " ", style });
}

function putChar(t: TerminalState, ch: string) {
  ensureLine(t, t.row);
  const line = t.lines[t.row];
  ensureCol(line, t.col, {});
  line[t.col] = { ch, style: t.style };
  t.col++;
}

function newline(t: TerminalState) {
  t.row++;
  ensureLine(t, t.row);
  // Scrollback cap: drop the oldest lines, keeping the cursor consistent.
  if (t.lines.length > MAX_LINES) {
    const drop = t.lines.length - MAX_LINES;
    t.lines.splice(0, drop);
    t.row -= drop;
    if (t.row < 0) t.row = 0;
  }
}

/** Feed a chunk of decoded text into the terminal model (mutates + returns it). */
export function feed(t: TerminalState, input: string): TerminalState {
  const data = t.pending + input;
  t.pending = "";
  let i = 0;

  while (i < data.length) {
    const ch = data[i];

    // Escape sequences.
    if (ch === "\x1b") {
      const next = data[i + 1];
      if (next === undefined) {
        t.pending = data.slice(i);
        return t;
      }
      if (next === "[") {
        // CSI: ESC [ params (intermediate) final
        const m = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(data.slice(i));
        if (!m) {
          t.pending = data.slice(i);
          return t;
        }
        handleCsi(t, m[0]);
        i += m[0].length;
        continue;
      }
      if (next === "]") {
        // OSC: ESC ] ... (BEL | ST). Used for window titles etc. — consume it.
        const end = findOscEnd(data, i);
        if (end < 0) {
          t.pending = data.slice(i);
          return t;
        }
        i = end;
        continue;
      }
      if (next === "(" || next === ")" || next === "*" || next === "+") {
        // Charset designation: ESC ( x — consume the two-char selector.
        if (i + 2 >= data.length) {
          t.pending = data.slice(i);
          return t;
        }
        i += 3;
        continue;
      }
      // Other two-char escapes (ESC 7/8/M/c/D/E …): handle the common ones.
      if (next === "7") {
        t.savedRow = t.row;
        t.savedCol = t.col;
      } else if (next === "8") {
        t.row = t.savedRow;
        t.col = t.savedCol;
      } else if (next === "c") {
        reset(t);
      }
      i += 2;
      continue;
    }

    // Control characters.
    if (ch === "\n") {
      newline(t);
      i++;
      continue;
    }
    if (ch === "\r") {
      t.col = 0;
      i++;
      continue;
    }
    if (ch === "\b") {
      if (t.col > 0) t.col--;
      i++;
      continue;
    }
    if (ch === "\t") {
      t.col = t.col + (TAB - (t.col % TAB));
      i++;
      continue;
    }
    if (ch === "\x07") {
      i++;
      continue; // bell
    }
    if (ch < " " && ch !== "\t") {
      i++;
      continue; // drop other C0 controls
    }

    putChar(t, ch);
    i++;
  }
  return t;
}

function reset(t: TerminalState) {
  t.lines = [[]];
  t.row = 0;
  t.col = 0;
  t.style = {};
}

function findOscEnd(data: string, start: number): number {
  for (let j = start + 2; j < data.length; j++) {
    if (data[j] === "\x07") return j + 1;
    if (data[j] === "\x1b" && data[j + 1] === "\\") return j + 2;
  }
  return -1;
}

function handleCsi(t: TerminalState, seq: string) {
  const final = seq[seq.length - 1];
  const body = seq.slice(2, seq.length - 1);
  if (body.startsWith("?")) {
    // DEC private mode set/reset (cursor visibility, alt screen, bracketed
    // paste, …). We don't model these — just swallow the sequence.
    return;
  }
  const params = body
    .split(";")
    .map((p) => (p === "" ? NaN : parseInt(p, 10)));
  const n = (idx: number, def = 0) =>
    Number.isFinite(params[idx]) ? (params[idx] as number) : def;

  switch (final) {
    case "m":
      t.style = applySgr(t.style, params.map((p) => (Number.isNaN(p) ? 0 : p)));
      break;
    case "H":
    case "f":
      t.row = Math.max(0, n(0, 1) - 1);
      t.col = Math.max(0, n(1, 1) - 1);
      ensureLine(t, t.row);
      break;
    case "A":
      t.row = Math.max(0, t.row - n(0, 1));
      break;
    case "B":
      t.row = t.row + n(0, 1);
      ensureLine(t, t.row);
      break;
    case "C":
      t.col = t.col + n(0, 1);
      break;
    case "D":
      t.col = Math.max(0, t.col - n(0, 1));
      break;
    case "G":
      t.col = Math.max(0, n(0, 1) - 1);
      break;
    case "d":
      t.row = Math.max(0, n(0, 1) - 1);
      ensureLine(t, t.row);
      break;
    case "J": {
      const mode = n(0, 0);
      if (mode === 2 || mode === 3) {
        reset(t);
      } else if (mode === 0) {
        // cursor → end of screen
        ensureLine(t, t.row);
        t.lines[t.row] = t.lines[t.row].slice(0, t.col);
        t.lines.length = t.row + 1;
      } else if (mode === 1) {
        // start → cursor
        for (let r = 0; r < t.row; r++) t.lines[r] = [];
        ensureLine(t, t.row);
        for (let c = 0; c < t.col && c < t.lines[t.row].length; c++) {
          t.lines[t.row][c] = { ch: " ", style: {} };
        }
      }
      break;
    }
    case "K": {
      const mode = n(0, 0);
      ensureLine(t, t.row);
      const line = t.lines[t.row];
      if (mode === 0) t.lines[t.row] = line.slice(0, t.col);
      else if (mode === 1) {
        for (let c = 0; c < t.col && c < line.length; c++)
          line[c] = { ch: " ", style: {} };
      } else if (mode === 2) t.lines[t.row] = [];
      break;
    }
    case "s":
      t.savedRow = t.row;
      t.savedCol = t.col;
      break;
    case "u":
      t.row = t.savedRow;
      t.col = t.savedCol;
      break;
    default:
      break; // ignore the rest
  }
}

/* -------------------------------- rendering ------------------------------ */

function sameStyle(a: CellStyle, b: CellStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    !!a.bold === !!b.bold &&
    !!a.dim === !!b.dim &&
    !!a.underline === !!b.underline &&
    !!a.inverse === !!b.inverse
  );
}

/** Collapse a line of cells into styled spans for rendering. */
export function lineToSpans(line: Cell[]): Span[] {
  const spans: Span[] = [];
  for (const cell of line) {
    const last = spans[spans.length - 1];
    if (last && sameStyle(last.style, cell.style)) last.text += cell.ch;
    else spans.push({ text: cell.ch, style: { ...cell.style } });
  }
  return spans;
}

/** Snapshot all lines as spans (a stable structure React can render). */
export function snapshot(t: TerminalState): Span[][] {
  return t.lines.map(lineToSpans);
}

/** Like `lineToSpans`, but marks the cell at `col` as the cursor cell (padding
 *  with a space when the cursor sits past the end of the line). */
function lineToSpansWithCursor(line: Cell[], col: number): Span[] {
  const spans: Span[] = [];
  const len = Math.max(line.length, col + 1);
  for (let i = 0; i < len; i++) {
    const cell = line[i] ?? { ch: " ", style: {} };
    const ch = cell.ch === "" ? " " : cell.ch;
    if (i === col) {
      spans.push({ text: ch, style: { ...cell.style }, cursor: true });
      continue;
    }
    const last = spans[spans.length - 1];
    if (last && !last.cursor && sameStyle(last.style, cell.style)) last.text += ch;
    else spans.push({ text: ch, style: { ...cell.style } });
  }
  return spans;
}

/** Snapshot for rendering, marking the cursor cell on the cursor row so the UI
 *  can draw the caret at the true (row, col) — including after a backspace or a
 *  cursor-move escape, not just at the end of the last line. */
export function snapshotWithCursor(t: TerminalState): Span[][] {
  return t.lines.map((line, row) =>
    row === t.row ? lineToSpansWithCursor(line, t.col) : lineToSpans(line)
  );
}
