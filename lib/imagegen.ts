import { ImageGenParams } from "./types";

/**
 * Image generation goes through the same /api/llama/* proxy as chat, so the
 * browser only ever talks to Mimir and CORS / auth are handled server-side.
 * The target is the OpenAI-compatible images endpoint:
 *
 *   POST /v1/images/generations
 *     { model, prompt, n, size, response_format, ...extensions }
 *   -> { created, data: [{ b64_json } | { url }], ... }
 *
 * We request `response_format: "b64_json"` so results are self-contained (no
 * second fetch, survive offline, and persist as a data URI). Servers that only
 * return URLs are handled too. The non-standard knobs (negative_prompt, steps,
 * cfg_scale, sampler, seed) are sent only when set; OpenAI-strict endpoints
 * ignore unknown fields, while local SD/Flux servers honor them.
 */

function headers(endpoint: string, apiKey?: string): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "x-llama-base": endpoint,
  };
  if (apiKey) h["x-llama-key"] = apiKey;
  return h;
}

export interface ImageGenRequest {
  endpoint: string;
  /** Bearer token for hosted APIs; omitted for local servers. */
  apiKey?: string;
  model: string;
  params: ImageGenParams;
  signal?: AbortSignal;
}

/** A single produced image, render-ready. */
export interface GeneratedImageResult {
  /** A `data:image/...;base64,…` URI, or a remote URL. */
  src: string;
  mimeType: string;
  /** Some backends return the prompt they actually used. */
  revisedPrompt?: string;
}

/** Builds the request body, including extensions only when meaningfully set. */
function buildBody(model: string, p: ImageGenParams) {
  const body: Record<string, unknown> = {
    model,
    prompt: p.prompt,
    n: Math.max(1, Math.min(p.batchSize || 1, 8)),
    size: `${p.width}x${p.height}`,
    response_format: "b64_json",
  };
  if (p.negativePrompt && p.negativePrompt.trim()) {
    body.negative_prompt = p.negativePrompt.trim();
  }
  if (typeof p.steps === "number") body.steps = p.steps;
  if (typeof p.cfgScale === "number") body.cfg_scale = p.cfgScale;
  if (p.sampler && p.sampler.trim()) body.sampler = p.sampler.trim();
  if (typeof p.seed === "number" && !Number.isNaN(p.seed)) body.seed = p.seed;
  if (p.referenceImages && p.referenceImages.length) {
    // FLUX.2 editing: reference image(s) the prompt edits / composes from. The
    // backend accepts a single data URI or an array (one entry per reference).
    body.image = p.referenceImages;
  }
  return body;
}

/**
 * Requests one batch of images and returns them render-ready. Throws with a
 * useful message on a non-2xx response so the studio can surface it.
 */
export async function generateImages({
                                       endpoint,
                                       apiKey,
                                       model,
                                       params,
                                       signal,
                                     }: ImageGenRequest): Promise<GeneratedImageResult[]> {
  const res = await fetch("/api/llama/v1/images/generations", {
    method: "POST",
    headers: headers(endpoint, apiKey),
    signal,
    body: JSON.stringify(buildBody(model, params)),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    // Surface the provider's error message when it's JSON.
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? j?.error ?? j?.message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(
      `Image endpoint responded ${res.status}${detail ? `: ${detail}` : ""}`
    );
  }

  const json = (await res.json()) as {
    data?: Array<{
      b64_json?: string;
      url?: string;
      revised_prompt?: string;
    }>;
  };

  const items = json.data ?? [];
  if (items.length === 0) {
    throw new Error("Image endpoint returned no images.");
  }

  return items.map((d) => {
    if (d.b64_json) {
      // We can't always know the encoded type; PNG is the common default and
      // browsers sniff regardless, so the declared type is informational.
      const mimeType = "image/png";
      return {
        src: `data:${mimeType};base64,${d.b64_json}`,
        mimeType,
        revisedPrompt: d.revised_prompt,
      };
    }
    return {
      src: d.url ?? "",
      mimeType: "image/*",
      revisedPrompt: d.revised_prompt,
    };
  });
}

export interface UpscaleRequest {
  endpoint: string;
  apiKey?: string;
  /** Source image: a `data:` URI or a URL. */
  imageSrc: string;
  /** Exact target dimensions (the backend resizes to these after upscaling). */
  width: number;
  height: number;
  signal?: AbortSignal;
}

/**
 * Sends an image to the backend's /v1/images/upscale endpoint (Real-ESRGAN on
 * the GPU) and returns the upscaled result render-ready. Same proxy + error
 * handling as generateImages.
 */
export async function upscaleImage({
                                     endpoint,
                                     apiKey,
                                     imageSrc,
                                     width,
                                     height,
                                     signal,
                                   }: UpscaleRequest): Promise<GeneratedImageResult> {
  const res = await fetch("/api/llama/v1/images/upscale", {
    method: "POST",
    headers: headers(endpoint, apiKey),
    signal,
    body: JSON.stringify({
      image: imageSrc,
      width,
      height,
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? j?.error ?? j?.message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(
      `Upscale endpoint responded ${res.status}${detail ? `: ${detail}` : ""}`
    );
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const d = (json.data ?? [])[0];
  if (!d) throw new Error("Upscale endpoint returned no image.");
  if (d.b64_json) {
    return { src: `data:image/png;base64,${d.b64_json}`, mimeType: "image/png" };
  }
  return { src: d.url ?? "", mimeType: "image/*" };
}