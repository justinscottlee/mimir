"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMimir, uid } from "@/lib/store";
import {
  EndpointLoad,
  loadAllModels,
  resolveEnabledModels,
  modelsForModality,
  resolveModelKey,
} from "@/lib/models";
import { GeneratedImage, ImageGenParams, ResolvedModel } from "@/lib/types";
import { generateImages, upscaleImage } from "@/lib/imagegen";
import { fileToDataURL, measureImage, resizeImage } from "@/lib/imageEdit";
import {
  ContextMenu,
  ContextMenuDelete,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenu,
} from "@/components/ContextMenu";
import ConfirmDelete from "@/components/ConfirmDelete";
import * as Icons from "@/components/icons";

/** Max reference images per generation; FLUX.2 allows more, but each adds VRAM. */
const MAX_REFERENCE_IMAGES = 4;

/** Trigger a browser download of an image source without leaving the page. */
function downloadImage(img: GeneratedImage) {
  const a = document.createElement("a");
  a.href = img.src;
  a.download = `${img.id}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The image studio: a sticky composer on the left (prompt + parameters + a
 * Generate button) and a gallery of results on the right. Generation hits the
 * OpenAI-compatible images endpoint via lib/imagegen.ts and streams results
 * into the store, so a generation started here survives tab switches (its
 * in-flight flag lives in `generatingStudios`). The composer's settings live on
 * the studio, so re-rolling or tweaking is one edit away.
 *
 * Beyond generation, the gallery accepts **uploaded** images (drag-and-drop or
 * the Upload button) so you can bring an image in just to resize it, and every
 * image can be **resized** client-side or **upscaled** on the backend. Both
 * edits preserve the pristine `original` (see the store's applyImageEdit), which
 * the UI surfaces with an "edited" badge plus view-original / revert controls.
 */
export default function ImageStudioView({ studioId }: { studioId: string }) {
  const studio = useMimir((s) => s.imageStudios[studioId]);
  const settings = useMimir((s) => s.settings);
  const generating = useMimir((s) => !!s.generatingStudios[studioId]);

  const setImageStudioModel = useMimir((s) => s.setImageStudioModel);
  const setImageStudioParams = useMimir((s) => s.setImageStudioParams);
  const setStudioGenerating = useMimir((s) => s.setStudioGenerating);
  const appendGeneratedImages = useMimir((s) => s.appendGeneratedImages);
  const applyImageEdit = useMimir((s) => s.applyImageEdit);
  const revertImageToOriginal = useMimir((s) => s.revertImageToOriginal);
  const deleteGeneratedImage = useMimir((s) => s.deleteGeneratedImage);
  const toggleImageFavorite = useMimir((s) => s.toggleImageFavorite);
  const clearImageStudioImages = useMimir((s) => s.clearImageStudioImages);

  const [loads, setLoads] = useState<EndpointLoad[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Lightbox can optionally open straight onto the original (View original).
  const [lightbox, setLightbox] = useState<{
    img: GeneratedImage;
    showOriginal: boolean;
  } | null>(null);
  // Images with an upscale in flight (transient UI state, keyed by image id).
  const [upscaling, setUpscaling] = useState<Set<string>>(new Set());
  // Images with a resize in flight (resize is fast but large images aren't).
  const [resizing, setResizing] = useState<Set<string>>(new Set());
  // Which image a dialog is open for (null = closed).
  const [upscaleTarget, setUpscaleTarget] = useState<GeneratedImage | null>(
    null
  );
  const [resizeTarget, setResizeTarget] = useState<GeneratedImage | null>(null);
  // Drag-and-drop upload overlay.
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const imageMenu = useContextMenu<GeneratedImage>();

  const abortRef = useRef<AbortController | null>(null);

  const models = useMemo(
    () =>
      modelsForModality(
        resolveEnabledModels(loads, settings.disabledModels),
        settings.endpoints,
        "image"
      ),
    [loads, settings.disabledModels, settings.endpoints]
  );

  // Load models from every endpoint (same pattern as the chat view).
  const endpointsKey = settings.endpoints.map((e) => e.id + e.url).join("|");
  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    loadAllModels(settings.endpoints).then((res) => {
      if (cancelled) return;
      setLoads(res);
      setLoadingModels(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointsKey]);

  // Pick a default model when the studio has none or its model went away.
  useEffect(() => {
    if (models.length === 0) return;
    const current = useMimir.getState().imageStudios[studioId];
    if (!current) return;
    const stillValid =
      current.model && models.some((m) => m.key === current.model);
    if (!stillValid) {
      const fallback =
        settings.defaultImageModel &&
        models.some((m) => m.key === settings.defaultImageModel)
          ? settings.defaultImageModel
          : models[0].key;
      setImageStudioModel(studioId, fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, studioId]);

  // Abort an in-flight request if the studio unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const params = studio?.params;
  const patch = useCallback(
    (p: Partial<ImageGenParams>) => setImageStudioParams(studioId, p),
    [setImageStudioParams, studioId]
  );

  // Reference images for FLUX.2 editing / image-guided generation. Reads live
  // state in the callbacks so rapid successive adds don't clobber each other.
  const referenceImages = params?.referenceImages ?? [];
  const addReferenceImages = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const current =
        useMimir.getState().imageStudios[studioId]?.params.referenceImages ??
        [];
      const room = MAX_REFERENCE_IMAGES - current.length;
      if (room <= 0) return;
      const picked = Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, room);
      Promise.all(picked.map((f) => fileToDataURL(f)))
        .then((uris) => patch({ referenceImages: [...current, ...uris] }))
        .catch(() => {
          /* ignore unreadable files */
        });
    },
    [patch, studioId]
  );
  const removeReferenceImage = useCallback(
    (idx: number) => {
      const current =
        useMimir.getState().imageStudios[studioId]?.params.referenceImages ??
        [];
      const next = current.filter((_, i) => i !== idx);
      patch({ referenceImages: next.length ? next : undefined });
    },
    [patch, studioId]
  );

  const run = useCallback(async () => {
    const current = useMimir.getState().imageStudios[studioId];
    if (!current) return;
    const resolved = resolveModelKey(current.model, settings);
    if (!resolved) {
      setError("Select a model first.");
      return;
    }
    if (!current.params.prompt.trim()) {
      setError("Enter a prompt to generate.");
      return;
    }
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setStudioGenerating(studioId, true);
    try {
      const results = await generateImages({
        endpoint: resolved.url,
        apiKey: resolved.apiKey,
        model: resolved.modelId,
        params: current.params,
        signal: controller.signal,
      });
      const now = Date.now();
      const images: GeneratedImage[] = results.map((r, i) => ({
        id: uid("gimg_"),
        src: r.src,
        mimeType: r.mimeType,
        prompt: r.revisedPrompt ?? current.params.prompt,
        negativePrompt: current.params.negativePrompt || undefined,
        width: current.params.width,
        height: current.params.height,
        steps: current.params.steps,
        cfgScale: current.params.cfgScale,
        sampler: current.params.sampler,
        seed: current.params.seed,
        model: current.model,
        source: "generated",
        createdAt: now + i,
      }));
      appendGeneratedImages(studioId, images);
    } catch (e) {
      // An aborted request is a user action, not an error to surface.
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message || "Generation failed.");
      }
    } finally {
      abortRef.current = null;
      setStudioGenerating(studioId, false);
    }
  }, [studioId, settings, setStudioGenerating, appendGeneratedImages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStudioGenerating(studioId, false);
  }, [studioId, setStudioGenerating]);

  // Copy a result's settings back into the composer to iterate on it.
  const reuse = useCallback(
    (img: GeneratedImage) => {
      patch({
        prompt: img.prompt,
        negativePrompt: img.negativePrompt ?? "",
        width: img.width || params?.width || 1024,
        height: img.height || params?.height || 1024,
        steps: img.steps,
        cfgScale: img.cfgScale,
        sampler: img.sampler,
        seed: img.seed,
      });
    },
    [patch, params]
  );

  // ---- Upload ------------------------------------------------------------

  /**
   * Read picked/dropped image files, measure their natural size, and add them
   * to the gallery as uploads. No endpoint needed — these come in purely so
   * they can be resized (or upscaled later).
   */
  const addUploadedImages = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const picked = Array.from(files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (picked.length === 0) return;
      setError(null);
      try {
        const now = Date.now();
        const built = await Promise.all(
          picked.map(async (f, i) => {
            const src = await fileToDataURL(f);
            const { width, height } = await measureImage(src);
            const image: GeneratedImage = {
              id: uid("gimg_"),
              src,
              mimeType: f.type || "image/*",
              prompt: f.name || "Uploaded image",
              width,
              height,
              source: "upload",
              createdAt: now + i,
            };
            return image;
          })
        );
        appendGeneratedImages(studioId, built);
      } catch {
        setError("Couldn't read one or more images.");
      }
    },
    [studioId, appendGeneratedImages]
  );

  // ---- Resize (client-side) ---------------------------------------------

  const resize = useCallback(
    async (img: GeneratedImage, width: number, height: number) => {
      // Sample from the pristine original when present so repeated resizes
      // don't compound softening; the output replaces the current pixels.
      const source = img.original ?? img;
      setError(null);
      setResizing((s) => new Set(s).add(img.id));
      try {
        const result = await resizeImage(
          source.src,
          width,
          height,
          source.mimeType
        );
        applyImageEdit(studioId, img.id, {
          src: result.src,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
        });
      } catch (e) {
        setError((e as Error).message || "Resize failed.");
      } finally {
        setResizing((s) => {
          const n = new Set(s);
          n.delete(img.id);
          return n;
        });
      }
    },
    [studioId, applyImageEdit]
  );

  // ---- Upscale (backend Real-ESRGAN) ------------------------------------

  const upscale = useCallback(
    async (img: GeneratedImage, scale: number) => {
      const resolved = resolveModelKey(img.model ?? studio?.model, settings);
      if (!resolved) {
        setError("No endpoint available to upscale with.");
        return;
      }
      const w = Math.round((img.width || 1024) * scale);
      const h = Math.round((img.height || 1024) * scale);
      setError(null);
      setUpscaling((s) => new Set(s).add(img.id));
      try {
        const result = await upscaleImage({
          endpoint: resolved.url,
          apiKey: resolved.apiKey,
          imageSrc: img.src,
          width: w,
          height: h,
        });
        applyImageEdit(studioId, img.id, {
          src: result.src,
          mimeType: result.mimeType,
          width: w,
          height: h,
        });
      } catch (e) {
        setError((e as Error).message || "Upscale failed.");
      } finally {
        setUpscaling((s) => {
          const n = new Set(s);
          n.delete(img.id);
          return n;
        });
      }
    },
    [studioId, studio, settings, applyImageEdit]
  );

  if (!studio) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 text-sm text-parchment-600">
        Studio not found.
      </div>
    );
  }

  const noEndpoints = settings.endpoints.length === 0;
  const gallery = [...studio.images].reverse(); // newest first

  function onGalleryDragEnter(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    dragDepth.current += 1;
    setDragOver(true);
  }
  function onGalleryDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }
  function onGalleryDrop(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    void addUploadedImages(e.dataTransfer.files);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-950 md:flex-row">
      {/* Composer */}
      <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto border-b border-ink-700 p-4 md:w-80 md:border-b-0 md:border-r">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Model
          </label>
          <ModelSelect
            models={models}
            value={studio.model}
            onChange={(key) => setImageStudioModel(studioId, key)}
            placeholder={
              loadingModels
                ? "loading models…"
                : noEndpoints
                  ? "no endpoints configured"
                  : "no models available"
            }
          />
          <p className="mt-1 text-[11px] leading-snug text-parchment-600">
            Pick an image-generation model served by one of your endpoints.
          </p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Prompt
          </label>
          <textarea
            value={params?.prompt ?? ""}
            onChange={(e) => patch({ prompt: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!generating) void run();
              }
            }}
            rows={4}
            placeholder="A lighthouse at dusk, dramatic clouds, oil painting…"
            className="w-full resize-y rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Reference images
          </label>
          <div className="flex flex-wrap gap-2">
            {referenceImages.map((src, i) => (
              <div
                key={i}
                className="group relative h-16 w-16 overflow-hidden rounded-md border border-ink-700 bg-ink-850"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`reference ${i + 1}`}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeReferenceImage(i)}
                  aria-label="Remove reference image"
                  className="absolute right-0.5 top-0.5 rounded bg-ink-950/80 p-0.5 text-parchment-300 opacity-0 transition-opacity hover:text-parchment-100 group-hover:opacity-100"
                >
                  <Icons.IconClose className="h-3 w-3" />
                </button>
              </div>
            ))}
            {referenceImages.length < MAX_REFERENCE_IMAGES && (
              <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-ink-700 bg-ink-850 text-parchment-600 transition-colors hover:border-bronze-600 hover:text-parchment-300">
                <Icons.IconUpload className="h-4 w-4" />
                <span className="text-[9px]">Add</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addReferenceImages(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-parchment-600">
            {referenceImages.length > 0
              ? "The prompt edits or draws from these. Each one adds VRAM."
              : "Optional — add an image and the prompt edits or composes from it."}
          </p>
        </div>

        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Negative prompt
          </label>
          <textarea
            value={params?.negativePrompt ?? ""}
            onChange={(e) => patch({ negativePrompt: e.target.value })}
            rows={2}
            placeholder="blurry, low quality, extra fingers…"
            className="w-full resize-y rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-sm text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
          />
        </div>

        {/* Size */}
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Size
          </label>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {SIZE_PRESETS.map((p) => {
              const active = params?.width === p.w && params?.height === p.h;
              return (
                <button
                  key={p.label}
                  onClick={() => patch({ width: p.w, height: p.h })}
                  className={[
                    "rounded border px-2 py-1 text-[11px] transition-colors",
                    active
                      ? "border-bronze-500 bg-bronze-500/15 text-bronze-200"
                      : "border-ink-700 text-parchment-400 hover:bg-ink-800 hover:text-parchment-100",
                  ].join(" ")}
                  title={`${p.w}×${p.h}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <NumField
              label="W"
              value={params?.width ?? 1024}
              min={64}
              max={4096}
              step={64}
              onChange={(v) => patch({ width: v })}
            />
            <span className="text-parchment-600">×</span>
            <NumField
              label="H"
              value={params?.height ?? 1024}
              min={64}
              max={4096}
              step={64}
              onChange={(v) => patch({ height: v })}
            />
          </div>
        </div>

        {/* Steps / CFG */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
              Steps
            </label>
            <NumField
              value={params?.steps ?? 30}
              min={1}
              max={150}
              step={1}
              onChange={(v) => patch({ steps: v })}
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
              CFG scale
            </label>
            <NumField
              value={params?.cfgScale ?? 7}
              min={0}
              max={30}
              step={0.5}
              onChange={(v) => patch({ cfgScale: v })}
            />
          </div>
        </div>

        {/* Sampler / batch */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
              Sampler
            </label>
            <input
              value={params?.sampler ?? ""}
              onChange={(e) => patch({ sampler: e.target.value })}
              placeholder="euler_a"
              className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
              Batch
            </label>
            <NumField
              value={params?.batchSize ?? 1}
              min={1}
              max={8}
              step={1}
              onChange={(v) => patch({ batchSize: v })}
            />
          </div>
        </div>

        {/* Seed */}
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
            Seed
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={params?.seed ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                patch({ seed: v === "" ? undefined : Number(v) });
              }}
              placeholder="random"
              className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-bronze-600 focus:outline-none"
            />
            <button
              onClick={() => patch({ seed: Math.floor(Math.random() * 2 ** 31) })}
              title="Random seed"
              className="rounded-md border border-ink-700 p-1.5 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconRefresh className="h-4 w-4" />
            </button>
            {params?.seed !== undefined && (
              <button
                onClick={() => patch({ seed: undefined })}
                title="Clear (use random)"
                className="rounded-md border border-ink-700 p-1.5 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
              >
                <Icons.IconClose className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-signal-err/40 bg-signal-err/10 px-2.5 py-2 text-xs text-signal-err">
            {error}
          </p>
        )}

        <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-ink-700 bg-ink-900/95 px-4 py-3 backdrop-blur">
          {generating ? (
            <button
              onClick={stop}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm font-medium text-parchment-100 transition-colors hover:bg-ink-800"
            >
              <Icons.IconStop className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button
              onClick={() => void run()}
              disabled={!studio.model || !params?.prompt.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-bronze-500 px-4 py-2.5 text-sm font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icons.IconSpark className="h-4 w-4" />
              {referenceImages.length > 0
                ? params && params.batchSize > 1
                  ? `Edit ${params.batchSize}`
                  : "Edit"
                : params && params.batchSize > 1
                  ? `Generate ${params.batchSize}`
                  : "Generate"}
            </button>
          )}
        </div>
      </aside>

      {/* Gallery */}
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={onGalleryDragEnter}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={onGalleryDragLeave}
        onDrop={onGalleryDrop}
      >
        <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-4 py-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-parchment-600">
            {studio.images.length} image
            {studio.images.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-1.5">
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addUploadedImages(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <button
              onClick={() => uploadInputRef.current?.click()}
              className="flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-xs text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
              title="Upload images to resize or upscale"
            >
              <Icons.IconUpload className="h-3.5 w-3.5" /> Upload
            </button>
            {studio.images.length > 0 && (
              <ConfirmDelete
                label="Clear all images"
                message="Clear all images?"
                stopPropagation={false}
                onConfirm={() => clearImageStudioImages(studioId)}
              />
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {gallery.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              {generating ? (
                <>
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-ink-700 border-t-bronze-500" />
                  <p className="text-sm text-parchment-600">Generating…</p>
                </>
              ) : (
                <>
                  <Icons.IconImage className="h-10 w-10 text-ink-700" />
                  <p className="max-w-xs text-sm text-parchment-600">
                    No images yet. Write a prompt and hit Generate{" "}
                    <kbd className="font-mono text-[10px]">⌘↵</kbd>, or{" "}
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      className="text-bronze-300 underline-offset-2 hover:underline"
                    >
                      upload an image
                    </button>{" "}
                    to resize.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {generating && (
                <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-ink-700 bg-ink-900">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink-700 border-t-bronze-500" />
                </div>
              )}
              {gallery.map((img) => (
                <GalleryTile
                  key={img.id}
                  img={img}
                  upscaling={upscaling.has(img.id)}
                  resizing={resizing.has(img.id)}
                  onOpen={() => setLightbox({ img, showOriginal: false })}
                  onFavorite={() => toggleImageFavorite(studioId, img.id)}
                  onResize={() => setResizeTarget(img)}
                  onDownload={() => downloadImage(img)}
                  onDelete={() => deleteGeneratedImage(studioId, img.id)}
                  onMenu={(e) => imageMenu.openMenu(e, img)}
                />
              ))}
            </div>
          )}
        </div>

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink-950/80 p-4">
            <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-bronze-500/70 px-8 py-6 text-bronze-200">
              <Icons.IconUpload className="h-8 w-8" />
              <span className="text-sm font-medium">Drop images to add</span>
            </div>
          </div>
        )}
      </section>

      {lightbox && (
        <Lightbox
          img={lightbox.img}
          startOnOriginal={lightbox.showOriginal}
          onResize={() => {
            setResizeTarget(lightbox.img);
            setLightbox(null);
          }}
          onRevert={
            lightbox.img.original
              ? () => {
                  revertImageToOriginal(studioId, lightbox.img.id);
                  setLightbox(null);
                }
              : undefined
          }
          onClose={() => setLightbox(null)}
        />
      )}

      {upscaleTarget && (
        <UpscaleDialog
          img={upscaleTarget}
          onConfirm={(scale) => {
            void upscale(upscaleTarget, scale);
            setUpscaleTarget(null);
          }}
          onClose={() => setUpscaleTarget(null)}
        />
      )}

      {resizeTarget && (
        <ResizeDialog
          img={resizeTarget}
          onConfirm={(w, h) => {
            void resize(resizeTarget, w, h);
            setResizeTarget(null);
          }}
          onClose={() => setResizeTarget(null)}
        />
      )}

      {imageMenu.menu && (
        <ImageContextMenu
          x={imageMenu.menu.x}
          y={imageMenu.menu.y}
          img={imageMenu.menu.data}
          canUpscale={!noEndpoints}
          onClose={imageMenu.closeMenu}
          onOpen={() =>
            setLightbox({ img: imageMenu.menu!.data, showOriginal: false })
          }
          onFavorite={() =>
            toggleImageFavorite(studioId, imageMenu.menu!.data.id)
          }
          onReuse={() => reuse(imageMenu.menu!.data)}
          onResize={() => setResizeTarget(imageMenu.menu!.data)}
          onUpscale={() => setUpscaleTarget(imageMenu.menu!.data)}
          onViewOriginal={() =>
            setLightbox({ img: imageMenu.menu!.data, showOriginal: true })
          }
          onRevert={() =>
            revertImageToOriginal(studioId, imageMenu.menu!.data.id)
          }
          onDownload={() => downloadImage(imageMenu.menu!.data)}
          onDelete={() =>
            deleteGeneratedImage(studioId, imageMenu.menu!.data.id)
          }
        />
      )}
    </div>
  );
}

/* ------------------------------ subcomponents ----------------------------- */

const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "512²", w: 512, h: 512 },
  { label: "768²", w: 768, h: 768 },
  { label: "1024²", w: 1024, h: 1024 },
  { label: "Portrait", w: 1024, h: 1536 },
  { label: "Landscape", w: 1536, h: 1024 },
];

function NumField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 focus-within:border-bronze-600">
      {label && (
        <span className="font-mono text-[10px] text-parchment-600">{label}</span>
      )}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(clamp(v));
        }}
        className="w-full min-w-0 bg-transparent font-mono text-xs text-parchment-100 focus:outline-none"
      />
    </div>
  );
}

function ModelSelect({
  models,
  value,
  onChange,
  placeholder,
}: {
  models: ResolvedModel[];
  value?: string;
  onChange: (key: string) => void;
  placeholder: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: ResolvedModel[] }>();
    for (const m of models) {
      if (!map.has(m.endpointId)) {
        map.set(m.endpointId, { name: m.endpointName, items: [] });
      }
      map.get(m.endpointId)!.items.push(m);
    }
    return [...map.values()];
  }, [models]);

  if (models.length === 0) {
    return (
      <div className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 font-mono text-xs text-parchment-600">
        {placeholder}
      </div>
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 font-mono text-xs text-parchment-100 focus:border-bronze-600 focus:outline-none"
    >
      {groups.length === 1
        ? groups[0].items.map((m) => (
            <option key={m.key} value={m.key}>
              {m.modelId}
            </option>
          ))
        : groups.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.items.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.modelId}
                </option>
              ))}
            </optgroup>
          ))}
    </select>
  );
}

function GalleryTile({
  img,
  onOpen,
  onFavorite,
  onResize,
  onDownload,
  onDelete,
  onMenu,
  upscaling,
  resizing,
}: {
  img: GeneratedImage;
  onOpen: () => void;
  onFavorite: () => void;
  onResize: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onMenu: (e: React.MouseEvent) => void;
  upscaling?: boolean;
  resizing?: boolean;
}) {
  const busy = upscaling || resizing;
  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
      onContextMenu={onMenu}
    >
      <button
        onClick={onOpen}
        className="block w-full"
        title={img.prompt}
        aria-label="Open image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.src}
          alt={img.prompt}
          loading="lazy"
          className="aspect-square w-full bg-ink-850 object-cover"
        />
      </button>

      {/* Top-left status badges */}
      <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
        {img.favorite && (
          <span className="rounded-full bg-ink-950/70 p-1 text-bronze-300">
            <Icons.IconPin className="h-3 w-3" />
          </span>
        )}
        {img.source === "upload" && (
          <span className="rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-parchment-300">
            Uploaded
          </span>
        )}
        {img.original && (
          <span
            className="flex items-center gap-1 rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-teal-300"
            title={`Edited from ${img.original.width}×${img.original.height}`}
          >
            <Icons.IconLayers className="h-3 w-3" /> Edited
          </span>
        )}
      </div>

      {/* Busy spinner overlay (resize/upscale in flight) */}
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink-950/50">
          <span className="block h-6 w-6 animate-spin rounded-full border-2 border-ink-700 border-t-bronze-500" />
        </div>
      )}

      {/* Hover toolbar */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 bg-gradient-to-t from-ink-950/90 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <TileBtn
          title={img.favorite ? "Unfavorite" : "Favorite"}
          onClick={onFavorite}
          active={img.favorite}
        >
          <Icons.IconPin className="h-3.5 w-3.5" />
        </TileBtn>
        <TileBtn title="Resize…" onClick={onResize}>
          <Icons.IconResize className="h-3.5 w-3.5" />
        </TileBtn>
        <TileBtn title="Download" onClick={onDownload}>
          <Icons.IconDownload className="h-3.5 w-3.5" />
        </TileBtn>
        <TileBtn title="More…" onClick={() => {}} asMenu onMenu={onMenu}>
          <Icons.IconSliders className="h-3.5 w-3.5" />
        </TileBtn>
        <span onClick={(e) => e.stopPropagation()}>
          <ConfirmDelete
            label="Delete image"
            message="Delete?"
            className="text-parchment-100"
            onConfirm={onDelete}
          />
        </span>
      </div>
    </div>
  );
}

function TileBtn({
  title,
  onClick,
  children,
  active,
  destructive,
  asMenu,
  onMenu,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  destructive?: boolean;
  /** When set, the button opens the context menu anchored to itself. */
  asMenu?: boolean;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        if (asMenu) onMenu?.(e);
        else onClick();
      }}
      className={[
        "rounded p-1 transition-colors hover:bg-ink-800",
        active
          ? "text-bronze-300"
          : destructive
            ? "text-parchment-300 hover:text-signal-err"
            : "text-parchment-300 hover:text-parchment-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function UpscaleGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M14 10l7-7" />
      <path d="M9 21H3v-6" />
      <path d="M10 14l-7 7" />
    </svg>
  );
}

/** Right-click / "more" menu for a gallery image. */
function ImageContextMenu({
  x,
  y,
  img,
  canUpscale,
  onClose,
  onOpen,
  onFavorite,
  onReuse,
  onResize,
  onUpscale,
  onViewOriginal,
  onRevert,
  onDownload,
  onDelete,
}: {
  x: number;
  y: number;
  img: GeneratedImage;
  canUpscale: boolean;
  onClose: () => void;
  onOpen: () => void;
  onFavorite: () => void;
  onReuse: () => void;
  onResize: () => void;
  onUpscale: () => void;
  onViewOriginal: () => void;
  onRevert: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <ContextMenu x={x} y={y} width={240} onClose={onClose}>
      <ContextMenuItem
        icon={<Icons.IconImage className="h-4 w-4" />}
        label="Open"
        onClick={run(onOpen)}
      />
      <ContextMenuItem
        icon={<Icons.IconPin className="h-4 w-4" />}
        label={img.favorite ? "Unfavorite" : "Favorite"}
        onClick={run(onFavorite)}
      />
      <ContextMenuItem
        icon={<Icons.IconRefresh className="h-4 w-4" />}
        label="Use these settings"
        onClick={run(onReuse)}
      />

      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<Icons.IconResize className="h-4 w-4" />}
        label="Resize…"
        onClick={run(onResize)}
      />
      <ContextMenuItem
        icon={<UpscaleGlyph className="h-4 w-4" />}
        label={canUpscale ? "Upscale…" : "Upscale (needs endpoint)"}
        disabled={!canUpscale}
        onClick={run(onUpscale)}
      />
      {img.original && (
        <>
          <ContextMenuItem
            icon={<Icons.IconLayers className="h-4 w-4" />}
            label="View original"
            onClick={run(onViewOriginal)}
          />
          <ContextMenuItem
            icon={<Icons.IconRevert className="h-4 w-4" />}
            label="Revert to original"
            onClick={run(onRevert)}
          />
        </>
      )}
      <ContextMenuItem
        icon={<Icons.IconDownload className="h-4 w-4" />}
        label="Download"
        onClick={run(onDownload)}
      />

      <ContextMenuSeparator />
      <ContextMenuDelete
        label="Delete image"
        confirmMessage="Delete image?"
        armed={confirmDelete}
        onArm={() => setConfirmDelete(true)}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={run(onDelete)}
      />
    </ContextMenu>
  );
}

function ResizeDialog({
  img,
  onConfirm,
  onClose,
}: {
  img: GeneratedImage;
  onConfirm: (width: number, height: number) => void;
  onClose: () => void;
}) {
  const baseW = img.width || 1024;
  const baseH = img.height || 1024;
  const aspect = baseW / baseH;
  const [lock, setLock] = useState(true);
  const [w, setW] = useState(baseW);
  const [h, setH] = useState(baseH);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clamp = (n: number) => Math.max(1, Math.min(8192, Math.round(n)));
  const setWidth = (v: number) => {
    const nw = clamp(v);
    setW(nw);
    if (lock) setH(clamp(nw / aspect));
  };
  const setHeight = (v: number) => {
    const nh = clamp(v);
    setH(nh);
    if (lock) setW(clamp(nh * aspect));
  };
  const applyScale = (pct: number) => {
    setW(clamp(baseW * pct));
    setH(clamp(baseH * pct));
  };

  const valid = w >= 1 && h >= 1 && (w !== baseW || h !== baseH);
  const presets = [0.25, 0.5, 0.75, 2];
  const hasOriginal = !!img.original;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
          <span className="text-sm font-medium text-parchment-200">
            Resize image
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
          >
            <Icons.IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="font-mono text-[11px] text-parchment-600">
            Current {baseW} × {baseH}
            {hasOriginal && (
              <>
                {" · "}
                <button
                  onClick={() => {
                    setW(img.original!.width);
                    setH(img.original!.height);
                  }}
                  className="text-teal-300 underline-offset-2 hover:underline"
                  title={`Original ${img.original!.width}×${img.original!.height}`}
                >
                  reset to original
                </button>
              </>
            )}
          </div>

          <div className="flex gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => applyScale(p)}
                className="flex-1 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-parchment-300 transition-colors hover:bg-ink-800"
              >
                {p * 100}%
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <NumField
              label="W"
              value={w}
              min={1}
              max={8192}
              step={1}
              onChange={setWidth}
            />
            <span className="text-parchment-600">×</span>
            <NumField
              label="H"
              value={h}
              min={1}
              max={8192}
              step={1}
              onChange={setHeight}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-parchment-300">
            <input
              type="checkbox"
              checked={lock}
              onChange={(e) => {
                const on = e.target.checked;
                setLock(on);
                if (on) setH(clamp(w / aspect));
              }}
              className="h-3.5 w-3.5 accent-bronze-500"
            />
            Lock aspect ratio
          </label>

          <div className="rounded-md bg-ink-850 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
              Result
            </div>
            <div className="font-mono text-sm text-parchment-100">
              {w} × {h}
            </div>
            <div className="font-mono text-[10px] text-parchment-600">
              {((w * h) / 1_000_000).toFixed(1)} MP ·{" "}
              {Math.round((w / baseW) * 100)}%
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-parchment-600">
            Resizing happens in your browser; no model needed. The original is
            kept so you can revert.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-3 py-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-parchment-400 transition-colors hover:text-parchment-100"
          >
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(w, h)}
            className="rounded-md bg-bronze-500 px-3 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Resize
          </button>
        </div>
      </div>
    </div>
  );
}

function UpscaleDialog({
  img,
  onConfirm,
  onClose,
}: {
  img: GeneratedImage;
  onConfirm: (scale: number) => void;
  onClose: () => void;
}) {
  const w = img.width || 1024;
  const h = img.height || 1024;
  const [scale, setScale] = useState(2);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clamp = (n: number) => Math.max(1, Math.min(8, n));
  const valid = Number.isFinite(scale) && scale >= 1;
  const outW = Math.round(w * scale);
  const outH = Math.round(h * scale);
  const presets = [1.5, 2, 3, 4];

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
          <span className="text-sm font-medium text-parchment-200">
            Upscale image
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
          >
            <Icons.IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="font-mono text-[11px] text-parchment-600">
            Source {w} × {h}
          </div>

          <div className="flex gap-1.5">
            {presets.map((s) => (
              <button
                key={s}
                onClick={() => setScale(s)}
                className={[
                  "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
                  scale === s
                    ? "border-bronze-500 bg-bronze-500/15 text-bronze-200"
                    : "border-ink-700 bg-ink-850 text-parchment-300 hover:bg-ink-800",
                ].join(" ")}
              >
                {s}×
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
              Custom factor
            </span>
            <input
              type="number"
              min={1}
              max={8}
              step={0.25}
              value={scale}
              onChange={(e) => setScale(clamp(Number(e.target.value) || 1))}
              className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-sm text-parchment-100 focus:border-bronze-600 focus:outline-none"
            />
          </label>

          <div className="rounded-md bg-ink-850 px-3 py-2 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-parchment-600">
              Result
            </div>
            <div className="font-mono text-sm text-parchment-100">
              {outW} × {outH}
            </div>
            <div className="font-mono text-[10px] text-parchment-600">
              {((outW * outH) / 1_000_000).toFixed(1)} MP
            </div>
          </div>

          {scale > 4 && (
            <p className="text-[11px] leading-relaxed text-parchment-600">
              Above 4× goes beyond the model&apos;s native scale, so the extra
              size is interpolated — expect softer detail.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-3 py-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-parchment-400 transition-colors hover:text-parchment-100"
          >
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm(scale)}
            className="rounded-md bg-bronze-500 px-3 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-bronze-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Upscale
          </button>
        </div>
      </div>
    </div>
  );
}

function Lightbox({
  img,
  startOnOriginal,
  onResize,
  onRevert,
  onClose,
}: {
  img: GeneratedImage;
  startOnOriginal?: boolean;
  onResize: () => void;
  onRevert?: () => void;
  onClose: () => void;
}) {
  const hasOriginal = !!img.original;
  const [showOriginal, setShowOriginal] = useState(
    !!startOnOriginal && hasOriginal
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const view =
    showOriginal && img.original
      ? {
          src: img.original.src,
          width: img.original.width,
          height: img.original.height,
        }
      : { src: img.src, width: img.width, height: img.height };

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-3 py-2">
          <span className="min-w-0 truncate font-mono text-[11px] text-parchment-600">
            {view.width}×{view.height}
            {img.seed !== undefined ? ` · seed ${img.seed}` : ""}
            {img.source === "upload" ? " · uploaded" : ""}
            {img.model ? ` · ${img.model.split("::").pop()}` : ""}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {hasOriginal && (
              <div className="mr-1 flex overflow-hidden rounded-md border border-ink-700">
                <button
                  onClick={() => setShowOriginal(false)}
                  className={[
                    "px-2 py-1 text-[11px] transition-colors",
                    !showOriginal
                      ? "bg-bronze-500/20 text-bronze-200"
                      : "text-parchment-400 hover:bg-ink-800",
                  ].join(" ")}
                >
                  Current
                </button>
                <button
                  onClick={() => setShowOriginal(true)}
                  className={[
                    "px-2 py-1 text-[11px] transition-colors",
                    showOriginal
                      ? "bg-bronze-500/20 text-bronze-200"
                      : "text-parchment-400 hover:bg-ink-800",
                  ].join(" ")}
                >
                  Original
                </button>
              </div>
            )}
            {hasOriginal && onRevert && (
              <button
                onClick={onRevert}
                title="Revert to original"
                aria-label="Revert to original"
                className="rounded p-1.5 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
              >
                <Icons.IconRevert className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onResize}
              title="Resize"
              aria-label="Resize"
              className="rounded p-1.5 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconResize className="h-4 w-4" />
            </button>
            <a
              href={view.src}
              download={`${img.id}.png`}
              title="Download"
              className="rounded p-1.5 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconDownload className="h-4 w-4" />
            </a>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1.5 text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-100"
            >
              <Icons.IconClose className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-ink-950 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={view.src}
            alt={img.prompt}
            className="mx-auto max-h-[60vh] w-auto rounded"
          />
        </div>
        {img.prompt && (
          <div className="max-h-28 overflow-y-auto border-t border-ink-700 px-3 py-2 text-xs leading-relaxed text-parchment-300">
            {img.prompt}
            {img.negativePrompt && (
              <span className="mt-1 block text-parchment-600">
                Negative: {img.negativePrompt}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
