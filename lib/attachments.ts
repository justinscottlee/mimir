import { Attachment, Message } from "./types";

/**
 * File attachments for chat: turning a dropped/picked file into text that is
 * injected directly into the model's context. This module is intentionally
 * isomorphic — the size caps are imported by the server PDF route too — so it
 * carries no "use client" and avoids calling browser-only APIs at module load.
 *
 * Supported inputs:
 *   - Text-like files (code, markdown, csv, json, plain text, …): decoded as
 *     UTF-8 in the browser. Detection is content-based (valid UTF-8, no NUL
 *     bytes), so it works regardless of extension.
 *   - PDFs: posted to /api/extract, which runs pdfjs server-side and returns
 *     the text.
 *
 * Genuinely binary files that aren't PDFs (images, archives, office docs) are
 * rejected at attach time with a clear message, so an Attachment always carries
 * usable `text`. (Image/multimodal input is a separate, future capability.)
 */

/** Hard cap on an attached file's size (applies to the original bytes). */
export const MAX_ATTACHMENT_FILE_BYTES = 12 * 1024 * 1024; // 12 MB

/** Per-file cap on injected text length, so one file can't flood the context. */
export const MAX_ATTACHMENT_TEXT_CHARS = 200_000;

/** Cap on the combined injected text across all attachments on one message. */
export const MAX_TOTAL_ATTACHMENT_CHARS = 400_000;

/** Max number of files attachable to a single message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 12;

export type ReadAttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

function hasPdfShape(file: { name: string; type?: string }): boolean {
  return (
    file.type === "application/pdf" || /\.pdf$/i.test(file.name.trim())
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Reads one File into an Attachment, or returns a human-readable error. Only
 * called in the browser (it uses File/FileReader). The PDF branch awaits the
 * server extraction route; the text branch decodes locally.
 */
export async function readAttachment(
  file: File,
  uid: (prefix?: string) => string
): Promise<ReadAttachmentResult> {
  if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
    return {
      ok: false,
      error: `${file.name} is too large (${humanSize(
        file.size
      )}; limit ${humanSize(MAX_ATTACHMENT_FILE_BYTES)}).`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: `${file.name} is empty.` };
  }

  if (hasPdfShape(file)) {
    return readPdfAttachment(file, uid);
  }
  return readTextAttachment(file, uid);
}

async function readTextAttachment(
  file: File,
  uid: (prefix?: string) => string
): Promise<ReadAttachmentResult> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Binary heuristic: a NUL byte, or bytes that don't decode as UTF-8, mean
  // this isn't a text file we can inject. Sniff a prefix for speed on big files.
  const sniff = bytes.subarray(0, Math.min(bytes.length, 65_536));
  if (sniff.includes(0)) {
    return {
      ok: false,
      error: `${file.name} looks like a binary file. Only text files and PDFs can be attached as context.`,
    };
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sniff);
  } catch {
    return {
      ok: false,
      error: `${file.name} isn't valid UTF-8 text. Only text files and PDFs can be attached as context.`,
    };
  }

  // Decode the whole thing leniently now that the prefix looks like text.
  let text = new TextDecoder("utf-8").decode(bytes);
  let truncated = false;
  if (text.length > MAX_ATTACHMENT_TEXT_CHARS) {
    text = text.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
    truncated = true;
  }

  return {
    ok: true,
    attachment: {
      id: uid("att_"),
      name: file.name,
      mimeType: file.type || undefined,
      size: file.size,
      kind: "text",
      text,
      truncated: truncated || undefined,
    },
  };
}

async function readPdfAttachment(
  file: File,
  uid: (prefix?: string) => string
): Promise<ReadAttachmentResult> {
  const base64 = await fileToBase64(file);
  let res: Response;
  try {
    res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: base64, name: file.name }),
    });
  } catch {
    return {
      ok: false,
      error: `Could not reach the PDF extractor for ${file.name}.`,
    };
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: detail || `Could not extract text from ${file.name}.`,
    };
  }
  const json = (await res.json()) as {
    text?: string;
    pages?: number;
    truncated?: boolean;
  };
  const text = (json.text ?? "").trim();
  if (!text) {
    return {
      ok: false,
      error: `No extractable text in ${file.name} (it may be a scanned/image-only PDF).`,
    };
  }
  return {
    ok: true,
    attachment: {
      id: uid("att_"),
      name: file.name,
      mimeType: file.type || "application/pdf",
      size: file.size,
      kind: "pdf",
      text,
      pages: json.pages,
      truncated: json.truncated || undefined,
    },
  };
}

/** Reads a File as base64 (no data: prefix) via FileReader. Browser-only. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Builds the context block injected ahead of a message's prose for the model.
 * Each attachment is wrapped in a clearly-delimited fence with its filename and
 * type so the model can tell files apart and from the user's own text. Returns
 * null when there are no attachments. The combined text is capped.
 */
export function buildAttachmentContext(
  attachments: Attachment[] | undefined
): string | null {
  if (!attachments || attachments.length === 0) return null;

  const blocks: string[] = [];
  let used = 0;
  for (const a of attachments) {
    const remaining = MAX_TOTAL_ATTACHMENT_CHARS - used;
    if (remaining <= 0) break;
    let body = a.text;
    let truncatedHere = a.truncated ?? false;
    if (body.length > remaining) {
      body = body.slice(0, remaining);
      truncatedHere = true;
    }
    used += body.length;
    const meta =
      a.kind === "pdf"
        ? `PDF${a.pages ? `, ${a.pages} page${a.pages === 1 ? "" : "s"}` : ""}`
        : a.mimeType || "text";
    const note = truncatedHere ? " (truncated)" : "";
    blocks.push(
      `<<<FILE: ${a.name} [${meta}]${note}>>>\n${body}\n<<<END FILE: ${a.name}>>>`
    );
  }

  const header =
    attachments.length === 1
      ? "The user attached a file. Its contents are below; use it as context for their message."
      : `The user attached ${attachments.length} files. Their contents are below; use them as context for their message.`;

  return `${header}\n\n${blocks.join("\n\n")}`;
}

/**
 * The content string sent to the model for one message: the attachment context
 * (if any) prepended to the user's prose. Reapplied from persisted attachments
 * on every request, so the file context is present on each turn and survives a
 * reload — true direct context injection rather than a one-time paste.
 */
export function messageContentForModel(message: Message): string {
  const ctx = buildAttachmentContext(message.attachments);
  if (!ctx) return message.content;
  // Keep the user's actual prose last so it reads as the instruction acting on
  // the attached context above it.
  return message.content.trim()
    ? `${ctx}\n\n${message.content}`
    : ctx;
}
