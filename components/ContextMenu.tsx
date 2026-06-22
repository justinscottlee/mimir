"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconClose } from "./icons";

/**
 * One context-menu primitive, shared by the TabBar, FileExplorer, LibraryView
 * and the Image Studio. Each of those used to hand-roll the same machinery —
 * a portal to <body>, a viewport clamp so the menu never spills off-screen,
 * outside-click + Escape to dismiss, and close-on-scroll/resize. This folds all
 * of that into one place; callers just supply a position and the menu body.
 *
 * Usage:
 *   const { menu, openMenu, closeMenu } = useContextMenu<MyData>();
 *   ...onContextMenu={(e) => openMenu(e, data)}
 *   {menu && (
 *     <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
 *       <ContextMenuItem icon={…} label="…" onClick={…} />
 *       <ContextMenuSeparator />
 *       …
 *     </ContextMenu>
 *   )}
 */

/** A menu's screen position plus arbitrary caller data (the clicked item, …). */
export interface MenuState<T = undefined> {
  x: number;
  y: number;
  data: T;
}

/** Small state helper: tracks the open menu and opens it at the cursor. */
export function useContextMenu<T = undefined>() {
  const [menu, setMenu] = useState<MenuState<T> | null>(null);
  const openMenu = useCallback((e: React.MouseEvent, data: T) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, data });
  }, []);
  /** Open the menu anchored to an element's corner (for an "actions" button). */
  const openMenuAt = useCallback((rect: DOMRect, data: T) => {
    setMenu({ x: rect.right, y: rect.bottom, data });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  return { menu, openMenu, openMenuAt, closeMenu };
}

export function ContextMenu({
  x,
  y,
  onClose,
  width = 224,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  /** Menu width in px; also used to size the clamp fallback. */
  width?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Clamp so the menu never spills off the right or bottom edges. Measured
  // after mount (hidden until then) so we use the real rendered size.
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? width;
    const h = el?.offsetHeight ?? 280;
    const m = 8;
    setPos({
      left: Math.max(m, Math.min(x, window.innerWidth - w - m)),
      top: Math.max(m, Math.min(y, window.innerHeight - h - m)),
    });
  }, [x, y, width]);

  useEffect(() => {
    function onDocPointer(e: PointerEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        width,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-[140] overflow-hidden rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
    >
      {children}
    </div>,
    document.body
  );
}

export function ContextMenuItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-parchment-600/40"
          : destructive
            ? "text-signal-err hover:bg-signal-err/10"
            : "text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
      ].join(" ")}
    >
      {icon && (
        <span
          className={
            disabled
              ? "text-parchment-600/40"
              : destructive
                ? "text-signal-err"
                : "text-parchment-600"
          }
        >
          {icon}
        </span>
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-ink-700" />;
}

/** Small uppercase section header inside a menu (e.g. "Tags", "Move to folder"). */
export function ContextMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
      {children}
    </div>
  );
}

/**
 * A delete row that arms an inline "<message>? ✓ ✕" confirmation in place,
 * replacing the per-menu copies of this pattern. `armed` is owned by the caller
 * so it can reset when the menu closes.
 */
export function ContextMenuDelete({
  label,
  confirmMessage,
  armed,
  onArm,
  onCancel,
  onConfirm,
}: {
  label: string;
  confirmMessage: string;
  armed: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (armed) {
    return (
      <div className="flex items-center gap-3 py-2 pl-4">
        <span className="text-xs font-medium text-signal-err">
          {confirmMessage}
        </span>
        <button
          onClick={onConfirm}
          className="rounded p-0.5 text-signal-err hover:bg-signal-err/20"
          title="Confirm delete — can't be undone"
          aria-label="Confirm delete"
        >
          <IconCheck className="h-4 w-4" />
        </button>
        <button
          onClick={onCancel}
          className="rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-100"
          title="Cancel"
          aria-label="Cancel delete"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <ContextMenuItem
      icon={<IconTrashGlyph />}
      label={label}
      destructive
      onClick={onArm}
    />
  );
}

// Local trash glyph kept here so the delete row is self-contained.
function IconTrashGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M2 4H14M5.33 4V2.67C5.33 2.3 5.63 2 6 2H10C10.37 2 10.67 2.3 10.67 2.67V4M6.67 7V11.33M9.33 7V11.33M3.33 4L4 13.33C4 13.7 4.3 14 4.67 14H11.33C11.7 14 12 13.7 12 13.33L12.67 4" />
    </svg>
  );
}
