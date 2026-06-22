"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One inline-rename input, shared by the TabBar, FileExplorer rows and Library
 * rows. Each used to reimplement the same input with autofocus, Enter to
 * commit, Escape to cancel, and blur to commit. This folds it into a single
 * self-contained component: it owns the draft (seeded from `value`), stops
 * click propagation so clicking inside doesn't trigger the row, and dispatches
 * exactly one terminal action per editing session.
 *
 * The session resets when the user keeps typing, so a parent that rejects a
 * commit (e.g. a duplicate filename) and keeps the input mounted can still
 * accept a corrected value on the next Enter/blur.
 */
export default function InlineRename({
  value,
  onCommit,
  onCancel,
  className = "",
  placeholder,
  spellCheck = true,
  selectOnFocus = false,
  ariaLabel,
}: {
  value: string;
  /** Called with the trimmed-or-raw current draft when committing. */
  onCommit: (next: string) => void;
  onCancel?: () => void;
  className?: string;
  placeholder?: string;
  spellCheck?: boolean;
  /** Select the whole value on focus (handy for "rename" over a filename). */
  selectOnFocus?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const ref = useRef<HTMLInputElement>(null);
  // Whether this editing session has already committed/cancelled. Resets on
  // edit so a rejected commit can be retried (see note above).
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (selectOnFocus) el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit() {
    if (done.current) return;
    done.current = true;
    onCommit(draftRef.current);
  }
  function cancel() {
    if (done.current) return;
    done.current = true;
    onCancel?.();
  }

  return (
    <input
      ref={ref}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      spellCheck={spellCheck}
      onChange={(e) => {
        done.current = false;
        draftRef.current = e.target.value;
        setDraft(e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      className={className}
    />
  );
}
