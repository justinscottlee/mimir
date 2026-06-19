import type { CSSProperties } from "react";
import { TagColor } from "./types";

/**
 * Inline style fragments for a tag/folder color.
 *
 * These are plain hex/rgba values applied via `style`, NOT Tailwind class
 * strings. The old class-based map lived in `lib/` — which Tailwind's content
 * scanner doesn't read — so every non-default color was purged from the build
 * and tags rendered colorless (only the default bronze survived, because it's
 * also used directly in components). Hex inline styles can't be purged, so the
 * full palette renders reliably wherever it's used.
 *
 * The palette is intentionally soft/pastel: light, low-saturation tones that
 * stay legible on the dark workshop background.
 *
 * `dot` is a solid swatch, `chip` a resting pill, `chipActive` a selected pill,
 * and `text` just the foreground (e.g. a folder icon).
 */
export interface TagStyle {
  dot: CSSProperties;
  chip: CSSProperties;
  chipActive: CSSProperties;
  text: CSSProperties;
}

/** Soft pastel base color per palette key (the dot + foreground tone). */
const BASE: Record<TagColor, string> = {
  bronze: "#e3c28a",
  blue: "#a9c8f0",
  green: "#a9ddb4",
  red: "#f2b0ac",
  purple: "#cdbdf0",
  amber: "#f0d39a",
  teal: "#9fd9d0",
  pink: "#f1b8d8",
  slate: "#bcc6d2",
};

/** rgba() string from a #rrggbb hex and an alpha in [0,1]. */
function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function make(hex: string): TagStyle {
  return {
    dot: { backgroundColor: hex },
    text: { color: hex },
    chip: {
      color: hex,
      borderColor: rgba(hex, 0.38),
      backgroundColor: rgba(hex, 0.08),
    },
    chipActive: {
      color: hex,
      borderColor: rgba(hex, 0.7),
      backgroundColor: rgba(hex, 0.2),
    },
  };
}

const MAP: Record<TagColor, TagStyle> = {
  bronze: make(BASE.bronze),
  blue: make(BASE.blue),
  green: make(BASE.green),
  red: make(BASE.red),
  purple: make(BASE.purple),
  amber: make(BASE.amber),
  teal: make(BASE.teal),
  pink: make(BASE.pink),
  slate: make(BASE.slate),
};

/** Resolve the inline style set for a color (defaults to bronze). */
export function tagStyle(color?: TagColor): TagStyle {
  return MAP[color ?? "bronze"] ?? MAP.bronze;
}
