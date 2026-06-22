"use client";

/**
 * Client-side image helpers for the studio. Resizing happens entirely in the
 * browser on a <canvas> — no model or endpoint required — which is what makes
 * "upload an image and resize it" work even with nothing configured. (The
 * backend `upscaleImage` in imagegen.ts is the separate, model-backed
 * super-resolution path.)
 */

/** Load an image source (a data URI or URL) into a decoded HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Data URIs need no CORS; for remote URLs request anonymous so the canvas
    // doesn't taint (export will still fail for opaque cross-origin images).
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = src;
  });
}

/** Read a File into a `data:` URL. */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.readAsDataURL(file);
  });
}

/** The natural (intrinsic) pixel dimensions of an image source. */
export async function measureImage(
  src: string
): Promise<{ width: number; height: number }> {
  const img = await loadImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export interface ResizeResult {
  src: string;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Resize an image source to exact `width`×`height` and return it render-ready.
 * Uses high-quality smoothing. The output keeps the source's encoding when it's
 * a format the canvas can emit (PNG/JPEG/WebP); otherwise it falls back to PNG.
 */
export async function resizeImage(
  src: string,
  width: number,
  height: number,
  mimeType?: string
): Promise<ResizeResult> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const img = await loadImage(src);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const emittable = new Set(["image/png", "image/jpeg", "image/webp"]);
  const outType =
    mimeType && emittable.has(mimeType) ? mimeType : "image/png";
  // JPEG has no alpha; use a high quality. PNG/WebP ignore the quality arg.
  const out =
    outType === "image/jpeg"
      ? canvas.toDataURL(outType, 0.92)
      : canvas.toDataURL(outType);

  return { src: out, mimeType: outType, width: w, height: h };
}
