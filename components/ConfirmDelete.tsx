"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconClose, IconTrash } from "./icons";

/**
 * A delete control that requires confirmation. Clicking the trash icon reveals
 * "Sure? · ✓ · ✕" inline next to it; the check commits, the cross cancels.
 * Confirmation auto-dismisses on outside click or after a timeout so a stray
 * armed button never lingers.
 */
export default function ConfirmDelete({
  onConfirm,
  label = "Delete",
  message = "Delete permanently?",
  className = "",
  stopPropagation = true,
}: {
  onConfirm: () => void;
  label?: string;
  /** Short text shown while armed. */
  message?: string;
  size?: "sm" | "md";
  className?: string;
  stopPropagation?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!armed) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setArmed(false);
      }
    }
    const timer = setTimeout(() => setArmed(false), 4000);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [armed]);

  function wrap(e: React.MouseEvent, fn: () => void) {
    if (stopPropagation) e.stopPropagation();
    fn();
  }

  if (armed) {
    return (
      <div
        ref={ref}
        className={[
          "flex items-center gap-1 rounded-md border border-signal-err/40 bg-signal-err/10 px-1.5 py-0.5",
          className,
        ].join(" ")}
      >
        <span className="text-xs text-signal-err">{message}</span>
        <button
          onClick={(e) => wrap(e, onConfirm)}
          className="rounded p-0.5 text-signal-err hover:bg-signal-err/20"
          title="Confirm delete — can't be undone"
          aria-label="Confirm delete"
        >
          <IconCheck className={"h-4 w-4"} />
        </button>
        <button
          onClick={(e) => wrap(e, () => setArmed(false))}
          className="rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
          title="Cancel"
          aria-label="Cancel delete"
        >
          <IconClose className={"h-4 w-4"} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => wrap(e, () => setArmed(true))}
      className={[
        "rounded p-1 text-parchment-600 transition-colors hover:bg-ink-800 hover:text-signal-err",
        className,
      ].join(" ")}
      title={label}
      aria-label={label}
    >
      <IconTrash className={["h-4 w-4", className].join(" ")} />
    </button>
  );
}
