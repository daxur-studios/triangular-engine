import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  NearestFilter,
  NearestMipMapNearestFilter,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

import type { IOctahedralImpostorAtlas } from './create-octahedral-impostor-atlas';
import type { ImageCompressionFunction } from 'triangular-engine';

export interface ICompressOctahedralImpostorAtlasOptions {
  /** Target maximum size in MB for albedo compression. @default 1 */
  readonly maxSizeMB?: number;
  /** Max width/height. Defaults to current atlas dimension. */
  readonly maxWidthOrHeight?: number;
  /** Initial quality factor (0 to 1). @default 0.8 */
  readonly quality?: number;
  /** Target MIME type for albedo compression. @default 'image/webp' */
  readonly fileType?: string;
  /**
   * Whether to compress normal/depth or keep it lossless.
   * Note: Lossy compression on normalDepth introduces normal distortion and depth banding.
   * @default 'lossless'
   */
  readonly normalDepthMode?: 'lossless' | 'lossy';
  /** Custom quality for normalDepth if lossy mode is enabled. @default 0.95 */
  readonly normalDepthQuality?: number;
  /** Progress callback from the configured image compression implementation (0 - 100). */
  readonly onProgress?: (progress: number) => void;
  /** Compression implementation supplied by `triangular-engine/image-compression`. */
  readonly imageCompression?: ImageCompressionFunction;
}

export interface IOctahedralImpostorCompressionStats {
  /** Raw uncompressed GPU memory footprint in bytes (width * height * 4 * 2 textures). */
  readonly rawGpuSizeBytes: number;
  /** Size of uncompressed/raw PNG export of albedo in bytes. */
  readonly rawAlbedoPngSizeBytes: number;
  /** Size of uncompressed/raw PNG export of normalDepth in bytes. */
  readonly rawNormalDepthPngSizeBytes: number;
  /** Total raw PNG file size in bytes. */
  readonly totalRawPngSizeBytes: number;
  /** Size of compressed albedo file in bytes. */
  readonly compressedAlbedoSizeBytes: number;
  /** Size of normalDepth file in bytes. */
  readonly compressedNormalDepthSizeBytes: number;
  /** Total compressed size in bytes (compressed albedo + normalDepth). */
  readonly totalCompressedSizeBytes: number;
  /** Compression ratio vs raw PNG size (percentage reduction: e.g. 85.5 means 85.5% smaller). */
  readonly pngSavingsPercent: number;
  /** Compression ratio vs uncompressed raw GPU memory (percentage reduction). */
  readonly gpuSavingsPercent: number;
  /** Total compression duration in milliseconds. */
  readonly durationMs: number;
}

export interface ICompressedOctahedralImpostorAtlas {
  /** The compressed albedo Texture (uploaded to GPU, LinearSRGBColorSpace, mipmapped). */
  readonly albedo: Texture;
  /** The compressed/optimized normalDepth Texture (uploaded to GPU, LinearSRGBColorSpace, nearest filtering). */
  readonly normalDepth: Texture;
  /** File / Blob of the compressed albedo texture. */
  readonly albedoBlob: File;
  /** File / Blob of the normalDepth texture. */
  readonly normalDepthBlob: File;
  /** Performance & size statistics. */
  readonly stats: IOctahedralImpostorCompressionStats;
  /** Dispose the created textures. */
  readonly dispose: () => void;
}

const ATLAS_TEXTURE_INDEX: { readonly albedo: 0; readonly normalDepth: 1 } = {
  albedo: 0,
  normalDepth: 1,
};

/**
 * Compresses a baked octahedral impostor atlas using a caller-provided image
 * compression implementation.
 *
 * Reads back both albedo and normal/depth textures from the GPU WebGLRenderTarget,
 * compresses albedo to a lightweight web format (e.g. WebP / JPEG), handles
 * normal/depth (lossless PNG by default or lossy for comparison), and constructs
 * new Three.js Textures ready for runtime or caching to IndexedDB / Dexie.
 */
export async function compressOctahedralImpostorAtlas(
  renderer: WebGLRenderer,
  atlas: IOctahedralImpostorAtlas,
  options?: ICompressOctahedralImpostorAtlasOptions,
): Promise<ICompressedOctahedralImpostorAtlas> {
  const startTime = performance.now();
  const width = atlas.renderTarget.width;
  const height = atlas.renderTarget.height;
  const rawGpuSizeBytes = width * height * 4 * 2; // RGBA 8-bit for both textures

  const albedoCanvas = extractCanvasFromRenderTarget(
    renderer,
    atlas.renderTarget,
    ATLAS_TEXTURE_INDEX.albedo,
  );
  const normalDepthCanvas = extractCanvasFromRenderTarget(
    renderer,
    atlas.renderTarget,
    ATLAS_TEXTURE_INDEX.normalDepth,
  );

  const rawAlbedoFile = await canvasToFile(albedoCanvas, 'image/png', 'albedo-raw.png');
  const rawNormalDepthFile = await canvasToFile(normalDepthCanvas, 'image/png', 'normal-depth-raw.png');

  const fileType = options?.fileType ?? 'image/webp';
  const quality = options?.quality ?? 0.8;
  const maxSizeMB = options?.maxSizeMB ?? 1;
  const maxWidthOrHeight = options?.maxWidthOrHeight ?? width;

  const imageCompression = options?.imageCompression;
  if (!imageCompression) {
    throw new Error(
      'compressOctahedralImpostorAtlas requires an image compression implementation. ' +
        'Install browser-image-compression and import browserImageCompression from ' +
        'triangular-engine/image-compression.',
    );
  }

  const compressedAlbedoFile = await imageCompression(rawAlbedoFile, {
    maxSizeMB,
    maxWidthOrHeight,
    initialQuality: quality,
    fileType,
    useWebWorker: true,
    onProgress: options?.onProgress,
  });

  let compressedNormalDepthFile: File;
  if (options?.normalDepthMode === 'lossy') {
    compressedNormalDepthFile = await imageCompression(rawNormalDepthFile, {
      maxSizeMB: Math.max(maxSizeMB, 2),
      maxWidthOrHeight,
      initialQuality: options?.normalDepthQuality ?? 0.95,
      fileType,
      useWebWorker: true,
    });
  } else {
    compressedNormalDepthFile = rawNormalDepthFile;
  }

  const [albedoTexture, normalDepthTexture] = await Promise.all([
    createTextureFromFile(compressedAlbedoFile, true),
    createTextureFromFile(compressedNormalDepthFile, false),
  ]);

  const rawAlbedoPngSizeBytes = rawAlbedoFile.size;
  const rawNormalDepthPngSizeBytes = rawNormalDepthFile.size;
  const totalRawPngSizeBytes = rawAlbedoPngSizeBytes + rawNormalDepthPngSizeBytes;
  const compressedAlbedoSizeBytes = compressedAlbedoFile.size;
  const compressedNormalDepthSizeBytes = compressedNormalDepthFile.size;
  const totalCompressedSizeBytes = compressedAlbedoSizeBytes + compressedNormalDepthSizeBytes;

  const pngSavingsPercent = totalRawPngSizeBytes > 0
    ? ((totalRawPngSizeBytes - totalCompressedSizeBytes) / totalRawPngSizeBytes) * 100
    : 0;

  const gpuSavingsPercent = rawGpuSizeBytes > 0
    ? ((rawGpuSizeBytes - totalCompressedSizeBytes) / rawGpuSizeBytes) * 100
    : 0;

  const durationMs = performance.now() - startTime;

  return {
    albedo: albedoTexture,
    normalDepth: normalDepthTexture,
    albedoBlob: compressedAlbedoFile,
    normalDepthBlob: compressedNormalDepthFile,
    stats: {
      rawGpuSizeBytes,
      rawAlbedoPngSizeBytes,
      rawNormalDepthPngSizeBytes,
      totalRawPngSizeBytes,
      compressedAlbedoSizeBytes,
      compressedNormalDepthSizeBytes,
      totalCompressedSizeBytes,
      pngSavingsPercent,
      gpuSavingsPercent,
      durationMs,
    },
    dispose: () => {
      albedoTexture.dispose();
      normalDepthTexture.dispose();
    },
  };
}

function extractCanvasFromRenderTarget(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  textureIndex: number,
): HTMLCanvasElement {
  const width = renderTarget.width;
  const height = renderTarget.height;
  const readBuffer = new Uint8Array(width * height * 4);

  renderer.readRenderTargetPixels(
    renderTarget,
    0,
    0,
    width,
    height,
    readBuffer,
    undefined,
    textureIndex,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('extractCanvasFromRenderTarget: 2D canvas context unavailable.');
  }

  const imageData = context.createImageData(width, height);
  const pixels = imageData.data;

  // WebGL readback is bottom-left origin; ImageData is top-left.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dest = (x + y * width) * 4;
      const src = (x + (height - y - 1) * width) * 4;
      pixels[dest] = readBuffer[src];
      pixels[dest + 1] = readBuffer[src + 1];
      pixels[dest + 2] = readBuffer[src + 2];
      pixels[dest + 3] = readBuffer[src + 3];
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToFile(
  canvas: HTMLCanvasElement,
  fileType: string,
  fileName: string,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(new File([blob], fileName, { type: fileType }));
      } else {
        reject(new Error(`Failed to convert canvas to blob with type ${fileType}`));
      }
    }, fileType);
  });
}

function createTextureFromFile(file: File | Blob, isAlbedo: boolean): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const texture = new CanvasTexture(img);
      texture.colorSpace = LinearSRGBColorSpace;
      if (isAlbedo) {
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = true;
      } else {
        texture.minFilter = NearestMipMapNearestFilter;
        texture.magFilter = NearestFilter;
        texture.generateMipmaps = true;
      }
      texture.needsUpdate = true;
      URL.revokeObjectURL(url);
      resolve(texture);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
