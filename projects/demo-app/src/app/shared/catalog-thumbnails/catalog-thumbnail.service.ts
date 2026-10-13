import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import Dexie, { type Table } from 'dexie';
import { EngineService, ScreenshotService } from 'triangular-engine';

/** Browser-local previews are independent of scene titles and catalog ordering. */
const DATABASE_NAME = 'triangular-demo-thumbnails';
/** Schema version for the route-keyed image store. */
const DATABASE_VERSION = 1;
/** Keep previews small enough for a catalog with many scenes. */
const THUMBNAIL_WIDTH = 480;
/** WebP quality balances recognizable scene detail and browser storage size. */
const THUMBNAIL_QUALITY = 0.82;
/** Reject unrendered, black or transparent frames instead of persisting them. */
const VISIBLE_CHANNEL_THRESHOLD = 16;
/** A few lit pixels are enough for small distant objects against a dark sky. */
const MINIMUM_VISIBLE_PIXELS = 16;
/** RGBA buffers store four channels per pixel. */
const PIXEL_CHANNELS = 4;

interface ThumbnailRecord {
  route: string;
  dataUrl: string;
  capturedAt: number;
}

/**
 * Shares persisted scene previews between demo and spike catalogs.
 *
 * A blocked browser database leaves the captured preview usable for this session.
 */
@Injectable({ providedIn: 'root' })
export class CatalogThumbnailService {
  private readonly screenshot = inject(ScreenshotService);
  private readonly database = new Dexie(DATABASE_NAME);
  private readonly images: Table<ThumbnailRecord, string>;
  private readonly previews = signal<Readonly<Record<string, string>>>({});
  readonly sources = this.previews.asReadonly();
  readonly loaded: Promise<void>;

  constructor() {
    this.database.version(DATABASE_VERSION).stores({ images: 'route' });
    this.images = this.database.table('images');
    this.loaded = this.loadImages();
    inject(DestroyRef).onDestroy(() => this.database.close());
  }

  /** Capture an explicit rendered engine, avoiding an unused root injector instance. */
  async capture(route: string, engine: EngineService): Promise<boolean> {
    if (!engine.canvas.isConnected || engine.width < 2 || engine.height < 2) {
      throw new Error('Wait for the scene to render before capturing a preview.');
    }
    const blob = await this.screenshot.capture({ engine, format: 'image/webp' });
    const bitmap = await createImageBitmap(blob);
    let dataUrl: string;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(THUMBNAIL_WIDTH, bitmap.width);
      canvas.height = Math.max(1, Math.round(canvas.width * bitmap.height / bitmap.width));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('The browser could not create a thumbnail.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visiblePixels = 0;
      for (let offset = 0; offset < pixels.length; offset += PIXEL_CHANNELS) {
        if (pixels[offset + 3] > 0 && Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > VISIBLE_CHANNEL_THRESHOLD) {
          visiblePixels++;
          if (visiblePixels >= MINIMUM_VISIBLE_PIXELS) break;
        }
      }
      if (visiblePixels < MINIMUM_VISIBLE_PIXELS) throw new Error('The scene preview is empty. Try capturing again once it has loaded.');
      dataUrl = canvas.toDataURL('image/webp', THUMBNAIL_QUALITY);
    } finally {
      bitmap.close();
    }
    this.previews.update((images) => ({ ...images, [route]: dataUrl }));
    try {
      await this.images.put({ route, dataUrl, capturedAt: Date.now() });
      return true;
    } catch {
      return false;
    }
  }

  /** Discard a broken cached image so its card can show the static fallback. */
  forget(route: string): void {
    this.previews.update((images) => {
      const copy = { ...images };
      delete copy[route];
      return copy;
    });
    void this.images.delete(route).catch(() => undefined);
  }

  private async loadImages(): Promise<void> {
    try {
      const rows = await this.images.toArray();
      const stored = Object.fromEntries(rows.filter((row) => row.dataUrl.startsWith('data:image/')).map((row) => [row.route, row.dataUrl]));
      this.previews.update((images) => ({ ...stored, ...images }));
    } catch {
      // Capture and the catalog remain usable when browser storage is unavailable.
    }
  }
}
