import { InjectionToken } from '@angular/core';

/** Options passed to an image compression implementation. */
export interface ImageCompressionOptions {
  readonly maxSizeMB?: number;
  readonly maxWidthOrHeight?: number;
  readonly initialQuality?: number;
  readonly fileType?: string;
  readonly useWebWorker?: boolean;
  readonly onProgress?: (progress: number) => void;
}

/** A caller-provided image compression implementation. */
export type ImageCompressionFunction = (
  file: File,
  options: ImageCompressionOptions,
) => Promise<File>;

/** Optional image compression integration used by ScreenshotService. */
export const IMAGE_COMPRESSION_FUNCTION = new InjectionToken<
  ImageCompressionFunction | undefined
>('TRIANGULAR_ENGINE_IMAGE_COMPRESSION_FUNCTION', {
  providedIn: 'root',
  factory: () => undefined,
});
