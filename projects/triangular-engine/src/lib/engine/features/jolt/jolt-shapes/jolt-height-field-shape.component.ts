import { Component, effect, inject, input, signal } from '@angular/core';
import Jolt from 'jolt-physics/wasm-compat';

import {
  JoltShapeComponent,
  provideShapeComponent,
} from './jolt-shape.component';
import { Texture, Vector3Tuple } from 'three';
import { LoaderService } from '../../../services/loader.service';

interface IHeightFieldParams {
  map: string | Texture;
  sampleCount: number;

  materials?: Jolt.PhysicsMaterialList;

  scale?: Vector3Tuple;
  offset?: Vector3Tuple;
  blockSize?: number;

  // New user-friendly inputs
  width: number;
  height: number;
  depth: number;
}

@Component({
  selector: 'jolt-height-field-shape',
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideShapeComponent(JoltHeightFieldShapeComponent)],
})
export class JoltHeightFieldShapeComponent extends JoltShapeComponent<Jolt.HeightFieldShape> {
  readonly #loaderService = inject(LoaderService);

  /**
   * The path to the black and white image height map image loaded by TextureLoader.
   */
  readonly map = input.required<string | Texture>();

  /**
   * MAX: 4096
   *
   * Example sampleCount = 512 mean a 512×512 grid of height values.
   * The number of points used to reconstruct the terrain from the heightmap data.
   */
  readonly sampleCount = input.required<number>();

  readonly scale = input<Vector3Tuple>();
  /**
   * Controls the offset of the heightmap in world units.
   * When width/height are provided, offset is auto-calculated to center the height field.
   * When using manual scale, you can provide custom offset positioning.
   */
  readonly offset = input<Vector3Tuple>();

  /**
   * mBlockSize controls the size of the internal "chunks" or blocks the heightfield is split into for broadphase collision detection and spatial queries.
   *
   * In other words:
   *
   * A heightfield might be very large (e.g. 4096×4096 samples).
   *
   * Instead of treating it as one huge collider (which would be slow to query and collide with), Jolt splits it into blocks.
   *
   * The choice of mBlockSize affects performance and memory usage:
   *
   * | mBlockSize Value   | Pros                                                                 | Cons                                                        |
   * |--------------------|----------------------------------------------------------------------|-------------------------------------------------------------|
   * | Small (e.g. 8, 16) | More precise culling — faster collision queries for small regions.   | More blocks = more memory and slightly more overhead.        |
   * | Large (e.g. 32, 64)| Fewer blocks = less overhead.                                        | Broader culling = slightly less efficient for local queries. |
   */
  readonly blockSize = input<number>();

  readonly materials = input<Jolt.PhysicsMaterialList>();

  /**
   * Width of the height field in world units (meters).
   * When provided with height, scale will be auto-calculated as [width/(sampleCount-1), depth, height/(sampleCount-1)]
   * where depth defaults to 10% of the average of width and height.
   */
  readonly width = input.required<number>();

  /**
   * Height of the height field in world units (meters).
   * When provided with width, scale will be auto-calculated as [width/(sampleCount-1), depth, height/(sampleCount-1)]
   * where depth defaults to 10% of the average of width and height.
   */
  readonly height = input.required<number>();

  /**
   * Maximum depth/height displacement in world units.
   * Used for the Y component of scale when width/height are provided.
   */
  readonly depth = input.required<number>();

  // Internal state for height data
  readonly #heights = signal<Float32Array | null>(null);

  constructor() {
    super();

    this.#initAsync();
  }

  async #initAsync() {
    await this.physicsService.metaDataPromise;

    this.#initInputs();
  }

  #initInputs() {
    effect(
      async () => {
        const map = this.map();
        const sampleCount = this.sampleCount();
        const scale = this.scale();
        const offset = this.offset();
        const blockSize = this.blockSize();
        const width = this.width();
        const height = this.height();
        const depth = this.depth();

        const materials = this.materials();

        if (map && sampleCount) {
          try {
            // Load the heightmap image and convert to height data
            await this.#loadHeightmapImage(map, sampleCount);

            // Auto-calculate scale and offset if width/height are provided
            let computedScale = scale;
            let computedOffset = offset;
            let appliedDepth = depth;
            if (width !== undefined && height !== undefined) {
              const xScale = width / (sampleCount - 1);
              const zScale = height / (sampleCount - 1);
              // Auto-calculate depth if not provided (10% of average dimension)
              appliedDepth = depth ?? ((width + height) / 2) * 0.1;
              computedScale = [xScale, appliedDepth, zScale];

              // Auto-calculate offset to center the height field (Jolt height fields have origin at corner)
              if (!computedOffset) {
                computedOffset = [-width / 2, 0, -height / 2];
              }
            }

            this.updateShape({
              materials,
              map,
              sampleCount,
              scale: computedScale,
              offset: computedOffset,
              blockSize,
              width,
              height,
              depth: appliedDepth,
            });
          } catch (error) {
            console.error('Failed to load heightmap:', error);
          }
        }
      },
      {
        injector: this.injector,
      },
    );
  }

  async #loadHeightmapImage(
    imagePath: string | Texture,
    sampleCount: number,
  ): Promise<void> {
    try {
      // Load the texture using the LoaderService
      let texture: Texture;
      if (typeof imagePath === 'string') {
        texture = await this.#loaderService.loadAndCacheTexture(imagePath);
      } else {
        texture = imagePath;
      }

      // Convert texture to height data
      const heights = await this.#textureToHeightData(texture, sampleCount);
      this.#heights.set(heights);
    } catch (error) {
      console.error('Failed to load heightmap texture:', error);
      throw error;
    }
  }

  #textureToHeightData(
    texture: Texture,
    sampleCount: number,
  ): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      try {
        // Create canvas and draw the texture
        const canvas = document.createElement('canvas');
        canvas.width = sampleCount;
        canvas.height = sampleCount;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context not available'));
          return;
        }

        // Create a temporary canvas texture to draw the image data
        const image = texture.image;
        if (!image) {
          reject(new Error('Texture image not available'));
          return;
        }

        // Ensure image is loaded
        if (image instanceof HTMLImageElement && !image.complete) {
          reject(new Error('Image not fully loaded'));
          return;
        }

        try {
          // Draw and scale the image to match sample grid
          ctx.drawImage(image, 0, 0, sampleCount, sampleCount);
          const imageData = ctx.getImageData(0, 0, sampleCount, sampleCount);

          const totalSamples = sampleCount * sampleCount;
          const heights = new Float32Array(totalSamples);

          for (let i = 0; i < totalSamples; i++) {
            const r = imageData.data[i * 4 + 0]; // Red channel (height)
            const g = imageData.data[i * 4 + 1]; // Green channel
            const b = imageData.data[i * 4 + 2]; // Blue channel
            const a = imageData.data[i * 4 + 3]; // Alpha channel

            if (a === 0) {
              // Transparent pixels become holes (no collision)
              heights[i] = (
                Jolt as any
              ).HeightFieldShapeConstantValues.cNoCollisionValue;
            } else {
              // Use the red channel for height (0-255 -> 0-1 range)
              // You can also combine RGB channels for more precision if needed
              heights[i] = r / 255.0;
            }
          }

          resolve(heights);
        } catch (drawError) {
          reject(new Error(`Failed to draw image to canvas: ${drawError}`));
        }
      } catch (error) {
        reject(new Error(`Failed to convert texture to height data: ${error}`));
      }
    });
  }

  override createShape(params: IHeightFieldParams): Jolt.HeightFieldShape {
    return this.updateShape(params);
  }

  override updateShape(params: IHeightFieldParams): Jolt.HeightFieldShape {
    this.disposeShape();

    const {
      map,
      sampleCount,

      materials,
      scale,
      offset,
      blockSize,

      // New parameters (used for documentation/logging)
      width,
      height,
      depth,
    } = params;

    if (!Number.isInteger(sampleCount) || sampleCount < 2) {
      throw new Error(
        'JoltHeightFieldShape: sampleCount must be an integer greater than or equal to 2',
      );
    }

    if (sampleCount > 4096) {
      throw new Error(
        'JoltHeightFieldShape: sampleCount cannot exceed 4096 (Jolt physics limitation)',
      );
    }

    const heights = this.#heights();
    if (!heights) {
      throw new Error(
        'JoltHeightFieldShape: Height data not available. Make sure the heightmap image is loaded first.',
      );
    }

    const totalSamples = sampleCount * sampleCount;
    if (heights.length !== totalSamples) {
      throw new Error(
        `JoltHeightFieldShape: heights length (${heights.length}) must equal sampleCount^2 (${totalSamples})`,
      );
    }

    // Validate blockSize if provided
    if (
      typeof blockSize === 'number' &&
      (blockSize < 2 || blockSize > sampleCount)
    ) {
      throw new Error(
        `JoltHeightFieldShape: blockSize must be between 2 and sampleCount (${sampleCount}), got ${blockSize}`,
      );
    }

    const settings = new Jolt.HeightFieldShapeSettings();
    settings.mSampleCount = sampleCount;

    if (scale) {
      settings.mScale.Set(scale[0], scale[1], scale[2]);
    }

    if (offset) {
      settings.mOffset.Set(offset[0], offset[1], offset[2]);
    }

    if (typeof blockSize === 'number') {
      settings.mBlockSize = blockSize;
    }

    settings.mHeightSamples.resize(totalSamples);

    const heightBuffer = new Float32Array(
      Jolt.HEAPF32.buffer,
      Jolt.getPointer(settings.mHeightSamples.data()),
      totalSamples,
    );
    heightBuffer.set(heights);

    if (materials) {
      settings.mMaterials = materials;
    }

    const shape = settings.Create().Get() as Jolt.HeightFieldShape;
    Jolt.destroy(settings);

    this.shape$.next(shape);
    shape.AddRef();

    return shape;
  }

  override disposeShape(): void {
    const shape = this.shape$.value;
    shape?.Release();
    this.shape$.next(undefined);
  }
}
