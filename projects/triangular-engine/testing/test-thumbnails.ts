import type { TestCaseThumbnails } from './test-contracts';

/** A thumbnail hook that has not answered by now is given up on; the case keeps its measurement and a limitation. */
export const THUMBNAIL_TIMEOUT_MS = 10_000;
/** One thumbnail is a helper for the reader, not a screenshot: larger ones are dropped. */
export const MAX_THUMBNAIL_BYTES = 64 * 1024;
/** All thumbnails of one run together. */
export const MAX_RUN_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** Frames per case (a looped thumbnail). */
export const MAX_CASE_THUMBNAILS = 4;

/** One image in the result POST (`thumbnailUploads`); the receiver stores it and puts only the file name in the result. */
export interface TestThumbnailUpload {
  readonly case: string;
  readonly repetition: number;
  readonly index: number;
  /** `image/webp`, `image/png` or `image/jpeg`. */
  readonly type: string;
  /** Base64 of the image bytes. */
  readonly data: string;
}

export interface KeptThumbnails {
  readonly images: readonly Blob[];
  readonly bytes: number;
  /** Why images were dropped, for the case's limitations. */
  readonly notes: readonly string[];
}

/** Applies the per-image, per-case and per-run limits to what an adapter returned; `usedBytes` is the run's total so far. */
export function keepThumbnails(images: readonly Blob[], usedBytes = 0): KeptThumbnails {
  const kept: Blob[] = [];
  const notes: string[] = [];
  let bytes = 0;
  for (const image of images) {
    if (!(image instanceof Blob) || image.size === 0) notes.push('Thumbnail dropped: not an image');
    else if (kept.length >= MAX_CASE_THUMBNAILS) notes.push(`Thumbnail dropped: more than ${MAX_CASE_THUMBNAILS} per case`);
    else if (image.size > MAX_THUMBNAIL_BYTES) notes.push(`Thumbnail dropped: ${Math.round(image.size / 1024)} KB is over ${MAX_THUMBNAIL_BYTES / 1024} KB`);
    else if (usedBytes + bytes + image.size > MAX_RUN_THUMBNAIL_BYTES) notes.push(`Thumbnail dropped: the run's ${MAX_RUN_THUMBNAIL_BYTES / 1024 / 1024} MB of thumbnails is used up`);
    else { kept.push(image); bytes += image.size; }
  }
  return { images: kept, bytes, notes };
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** The images of a run as the POST body entries the receiver reads. */
export async function encodeThumbnailUploads(entries: readonly TestCaseThumbnails[]): Promise<TestThumbnailUpload[]> {
  const out: TestThumbnailUpload[] = [];
  for (const entry of entries) {
    for (const [index, image] of entry.images.entries()) {
      out.push({ case: entry.scenarioId, repetition: entry.repetition, index, type: image.type || 'image/webp', data: await toBase64(image) });
    }
  }
  return out;
}
