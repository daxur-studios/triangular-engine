import type { Provider } from '@angular/core';
import imageCompression from 'browser-image-compression';
import {
  IMAGE_COMPRESSION_FUNCTION,
  ScreenshotService,
  type ImageCompressionFunction,
} from 'triangular-engine';

/** The browser-image-compression implementation used by the optional adapter. */
export const browserImageCompression: ImageCompressionFunction = (file, options) =>
  imageCompression(file, options);

/** Enables ScreenshotService compression for the current Angular injector. */
export function provideBrowserImageCompression(): Provider[] {
  return [
    {
      provide: IMAGE_COMPRESSION_FUNCTION,
      useValue: browserImageCompression,
    },
    {
      provide: ScreenshotService,
      useClass: ScreenshotService,
    },
  ];
}
