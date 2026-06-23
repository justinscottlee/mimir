"use client";

/**
 * Small browser helpers for getting data out to a file and back in. Kept apart
 * from lib/transfer.ts (which is pure/isomorphic) so the serialization logic
 * can be imported on the server without dragging in DOM APIs.
 */

/** Triggers a download of `text` as a file named `filename`. */
export function downloadText(
  filename: string,
  text: string,
  mime = "application/json"
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Opens the native file picker and resolves with the chosen files (empty if the
 * user cancels). `accept` is a standard input accept string, e.g. ".json,.md".
 */
export function pickFiles(
  accept: string,
  multiple = false
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.onchange = () => done(input.files ? Array.from(input.files) : []);
    // If the picker is dismissed, `change` never fires; window focus returning
    // lets us resolve empty so callers don't hang forever.
    window.addEventListener(
      "focus",
      () => setTimeout(() => done([]), 300),
      { once: true }
    );
    document.body.appendChild(input);
    input.click();
  });
}

/** Reads a File as UTF-8 text. */
export function readFileText(file: File): Promise<string> {
  return file.text();
}
