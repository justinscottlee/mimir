import { requireUser, jsonError } from "@/lib/server/session";
import { MAX_ATTACHMENT_TEXT_CHARS } from "@/lib/attachments";

export const dynamic = "force-dynamic";
// PDF parsing is CPU/IO heavy and uses Node APIs — force the Node runtime.
export const runtime = "nodejs";
// A large PDF can take a while; give it room beyond the default.
export const maxDuration = 60;

/**
 * Extracts plain text from an uploaded PDF, server-side, so the browser doesn't
 * need a PDF engine. Used by the chat file-attachment feature: text-like files
 * are decoded in the browser, but PDFs are posted here as base64 and the
 * extracted text comes back for direct context injection.
 *
 * Authenticated (same as every other state route) so the endpoint can't be used
 * as an open extraction service. The dependency (unpdf, which bundles a
 * Node-compatible pdfjs) is imported lazily so it only loads when a PDF is
 * actually attached.
 */

const MAX_PDF_BYTES = 12 * 1024 * 1024; // 12 MB cap on the uploaded PDF

interface ExtractBody {
  /** base64-encoded PDF bytes (no data: prefix). */
  data?: string;
  /** Original filename, for error messages only. */
  name?: string;
}

export async function POST(req: Request) {
  try {
    await requireUser(req);
    const body = (await req.json()) as ExtractBody;
    const b64 = typeof body.data === "string" ? body.data : "";
    if (!b64) {
      return Response.json({ error: "No PDF data provided." }, { status: 400 });
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, "base64");
    } catch {
      return Response.json({ error: "Malformed PDF data." }, { status: 400 });
    }
    if (bytes.length === 0) {
      return Response.json({ error: "Empty PDF." }, { status: 400 });
    }
    if (bytes.length > MAX_PDF_BYTES) {
      return Response.json(
        {
          error: `PDF is too large (${(bytes.length / 1024 / 1024).toFixed(
            1
          )} MB; limit ${MAX_PDF_BYTES / 1024 / 1024} MB).`,
        },
        { status: 413 }
      );
    }

    const { text, pages, truncated } = await extractPdfText(bytes);
    return Response.json({ text, pages, truncated });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Runs the PDF through unpdf and concatenates each page's text. unpdf bundles a
 * Node/serverless-compatible pdfjs build with clean ESM exports — no worker, no
 * DOM, and nothing to externalize in next.config — which makes it resolve the
 * same way under `next dev` and `next build`. The total is capped at
 * MAX_ATTACHMENT_TEXT_CHARS — the same cap the client applies to text files —
 * so one giant PDF can't blow up a request.
 */
async function extractPdfText(
  bytes: Buffer
): Promise<{ text: string; pages: number; truncated: boolean }> {
  // Imported here (not top-level) so the dependency only loads when a PDF is
  // actually processed.
  const { extractText, getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text: pageTexts } = await extractText(pdf, {
    mergePages: false,
  });

  const parts: string[] = [];
  let total = 0;
  let truncated = false;

  for (const raw of pageTexts) {
    if (total >= MAX_ATTACHMENT_TEXT_CHARS) {
      truncated = true;
      break;
    }
    const pageText = (raw ?? "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
    if (pageText) {
      parts.push(pageText);
      total += pageText.length;
    }
  }

  let text = parts.join("\n\n");
  if (text.length > MAX_ATTACHMENT_TEXT_CHARS) {
    text = text.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
    truncated = true;
  }

  return { text, pages: totalPages, truncated };
}
