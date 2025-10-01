import { Component, input, inject, effect } from '@angular/core';
import { PlaneGeometry, BufferGeometry, Float32BufferAttribute } from 'three';
import {
  BufferGeometryComponent,
  provideBufferGeometryComponent,
} from './geometry.component';
import { LoaderService } from '../../services/loader.service';

/**
 * Create Three.js geometry from a black and white image.
 */
@Component({
  selector: 'heightMapGeometry',
  standalone: true,
  imports: [],
  template: `<ng-content></ng-content>`,
  providers: [provideBufferGeometryComponent(HeightMapGeometryComponent)],
})
export class HeightMapGeometryComponent extends BufferGeometryComponent {
  readonly #loaderService = inject(LoaderService);

  /** The path to the black and white image height map image loaded by TextureLoader.*/
  readonly map = input.required<string>();
  /** Whether to cache the loaded height map in LoaderService for future use. */
  readonly cache = input<boolean>(false);

  /**
   * Example sampleCount = 512 mean a 512×512 grid of height values.
   * The number of points used to reconstruct the terrain from the heightmap data.
   */
  readonly sampleCount = input.required<number>();
  /** The width of the height map in world units. eg 10 = 10 meters */
  readonly width = input<number>();
  /** The height of the height map in world units. eg 10 = 10 meters */
  readonly height = input<number>();
  /** Maximum depth/height displacement in world units. If not provided, defaults to 10% of the average of width and height. */
  readonly depth = input<number>();

  constructor() {
    super();
    this.#initGeometry();
  }

  #initGeometry() {
    effect(() => {
      const map = this.map();
      const sampleCount = this.sampleCount();
      const width = this.width();
      const height = this.height();
      const depth = this.depth();

      if (map && sampleCount && width !== undefined && height !== undefined) {
        // Auto-calculate depth if not provided (10% of average dimension)
        const computedDepth = depth ?? ((width + height) / 2) * 0.1;
        this.#createHeightMapGeometry(
          map,
          sampleCount,
          width,
          height,
          computedDepth,
        );
      }
    });
  }

  async #createHeightMapGeometry(
    map: string,
    sampleCount: number,
    width: number,
    height: number,
    depth: number,
  ) {
    try {
      // Load the texture
      const texture = await this.#loaderService.loadAndCacheTexture(map);

      // Create canvas and sample the texture
      const canvas = document.createElement('canvas');
      canvas.width = sampleCount;
      canvas.height = sampleCount;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw the texture scaled to our sample count
      const image = texture.image;
      if (image && image.complete && image.width > 0 && image.height > 0) {
        ctx.drawImage(image, 0, 0, sampleCount, sampleCount);
      } else {
        console.warn('HeightMapGeometry: Texture image not ready or missing', {
          image,
          complete: image?.complete,
          width: image?.width,
          height: image?.height,
        });
        return;
      }

      const imageData = ctx.getImageData(0, 0, sampleCount, sampleCount);
      const data = imageData.data;

      // Create a custom BufferGeometry for the height map
      const geometry = new BufferGeometry();

      // Create vertices for the height map grid
      const vertices: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i < sampleCount; i++) {
        for (let j = 0; j < sampleCount; j++) {
          // Calculate world position
          const x = (j / (sampleCount - 1)) * width - width / 2;
          const z = (i / (sampleCount - 1)) * height - height / 2;

          // Get height from texture data
          const pixelIndex = (i * sampleCount + j) * 4;
          const heightValue = data[pixelIndex] / 255.0;
          const y = heightValue * depth;

          // Calculate UV coordinates (0-1 range)
          const u = j / (sampleCount - 1);
          const v = 1.0 - i / (sampleCount - 1); // Flip V coordinate to correct orientation

          vertices.push(x, y, z);
          uvs.push(u, v);
        }
      }

      // Create indices for triangles
      for (let i = 0; i < sampleCount - 1; i++) {
        for (let j = 0; j < sampleCount - 1; j++) {
          const topLeft = i * sampleCount + j;
          const topRight = i * sampleCount + (j + 1);
          const bottomLeft = (i + 1) * sampleCount + j;
          const bottomRight = (i + 1) * sampleCount + (j + 1);

          // First triangle
          indices.push(topLeft, bottomLeft, topRight);
          // Second triangle
          indices.push(topRight, bottomLeft, bottomRight);
        }
      }

      // Set attributes
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(vertices, 3),
      );
      geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);

      // Calculate height variation for debugging
      let minHeight = Infinity,
        maxHeight = -Infinity;
      for (let i = 0; i < vertices.length; i += 3) {
        minHeight = Math.min(minHeight, vertices[i + 1]);
        maxHeight = Math.max(maxHeight, vertices[i + 1]);
      }

      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      this.geometry.set(geometry);
    } catch (error) {
      console.error('Failed to create height map geometry:', error);
    }
  }
}
