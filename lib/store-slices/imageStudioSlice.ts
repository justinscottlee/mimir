import { StateCreator } from "zustand";
import type { MimirState } from "../store";
import { MAX_STUDIO_IMAGES } from "../defaults";
import { GeneratedImage, ImageGenParams } from "../types";

/**
 * Image-studio gallery + composer actions, lifted out of the main store as the
 * second extracted slice. Everything here is self-contained — it only reads and
 * writes `imageStudios` / `generatingStudios` — so it lifts cleanly, the same
 * test the organization slice met. The tab-coupled lifecycle actions
 * (new/open/delete/setTitle) stay in the main store next to the tab + discard +
 * sync machinery they depend on.
 *
 * `applyImageEdit` is the one place that captures an image's pristine
 * `original` before mutating its pixels, so resize and the model-backed upscale
 * share one "never lose the original" guarantee; `revertImageToOriginal`
 * restores it.
 */
export interface ImageStudioSlice {
  setImageStudioModel: (id: string, model: string) => void;
  /** Merge a partial composer-params patch into a studio. */
  setImageStudioParams: (id: string, patch: Partial<ImageGenParams>) => void;
  /** Mark a studio as actively generating (or not). */
  setStudioGenerating: (id: string, generating: boolean) => void;
  /** Append freshly generated/uploaded images (newest last); trims to cap. */
  appendGeneratedImages: (id: string, images: GeneratedImage[]) => void;
  /** Patch one generated image in place (small metadata edits). */
  updateGeneratedImage: (
    id: string,
    imageId: string,
    patch: Partial<GeneratedImage>
  ) => void;
  /**
   * Replace an image's pixels (resize / upscale), preserving the pristine
   * `original` the first time so it can be compared or reverted to.
   */
  applyImageEdit: (
    id: string,
    imageId: string,
    next: { src: string; width: number; height: number; mimeType?: string }
  ) => void;
  /** Restore an image's captured original, dropping the edit. */
  revertImageToOriginal: (id: string, imageId: string) => void;
  deleteGeneratedImage: (id: string, imageId: string) => void;
  toggleImageFavorite: (id: string, imageId: string) => void;
  clearImageStudioImages: (id: string) => void;
}

export const createImageStudioSlice: StateCreator<
  MimirState,
  [],
  [],
  ImageStudioSlice
> = (set) => ({
  setImageStudioModel: (id, model) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      return {
        imageStudios: { ...s.imageStudios, [id]: { ...studio, model } },
      };
    }),

  setImageStudioParams: (id, patch) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: { ...studio, params: { ...studio.params, ...patch } },
        },
      };
    }),

  setStudioGenerating: (id, generating) =>
    set((s) => {
      if (!!s.generatingStudios[id] === generating) return s;
      const next = { ...s.generatingStudios };
      if (generating) next[id] = true;
      else delete next[id];
      return { generatingStudios: next };
    }),

  appendGeneratedImages: (id, images) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio || images.length === 0) return s;
      // Newest last; trim the oldest beyond the cap (base64 images are heavy).
      const merged = [...studio.images, ...images];
      const trimmed =
        merged.length > MAX_STUDIO_IMAGES
          ? merged.slice(merged.length - MAX_STUDIO_IMAGES)
          : merged;
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: { ...studio, images: trimmed, updatedAt: Date.now() },
        },
      };
    }),

  updateGeneratedImage: (id, imageId, patch) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      const images = studio.images.map((img) =>
        img.id === imageId ? { ...img, ...patch } : img
      );
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: { ...studio, images, updatedAt: Date.now() },
        },
      };
    }),

  applyImageEdit: (id, imageId, next) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      const images = studio.images.map((img) => {
        if (img.id !== imageId) return img;
        // Capture the pristine original exactly once (the first edit).
        const original = img.original ?? {
          src: img.src,
          mimeType: img.mimeType,
          width: img.width,
          height: img.height,
        };
        return {
          ...img,
          src: next.src,
          width: next.width,
          height: next.height,
          mimeType: next.mimeType ?? img.mimeType,
          original,
        };
      });
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: { ...studio, images, updatedAt: Date.now() },
        },
      };
    }),

  revertImageToOriginal: (id, imageId) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      const images = studio.images.map((img) => {
        if (img.id !== imageId || !img.original) return img;
        const { original, ...rest } = img;
        return {
          ...rest,
          src: original.src,
          mimeType: original.mimeType,
          width: original.width,
          height: original.height,
        };
      });
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: { ...studio, images, updatedAt: Date.now() },
        },
      };
    }),

  deleteGeneratedImage: (id, imageId) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: {
            ...studio,
            images: studio.images.filter((img) => img.id !== imageId),
          },
        },
      };
    }),

  toggleImageFavorite: (id, imageId) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: {
            ...studio,
            images: studio.images.map((img) =>
              img.id === imageId ? { ...img, favorite: !img.favorite } : img
            ),
          },
        },
      };
    }),

  clearImageStudioImages: (id) =>
    set((s) => {
      const studio = s.imageStudios[id];
      if (!studio) return s;
      return {
        imageStudios: {
          ...s.imageStudios,
          [id]: { ...studio, images: [] },
        },
      };
    }),
});
