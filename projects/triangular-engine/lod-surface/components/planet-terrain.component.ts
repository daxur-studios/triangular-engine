import { Component, DestroyRef, computed, inject, input } from '@angular/core';
import type { NodeMaterial } from 'three/webgpu';
import { EngineService } from 'triangular-engine';
import {
  TERRAIN_DEFAULTS, createHeightSource, type CubeWarp, type HeightSource, type LodView, type PatchCells, type Vec3,
} from 'triangular-engine/lod-surface/core';
import { attachLodTerrain } from './attach-lod-terrain';

/**
 * The 3D ground of a sphere, with level of detail: a cube-sphere of quadtree leaves selected on the CPU from the active
 * camera and drawn in one instanced draw call, with cracks closed by edge folding.
 *
 * ```html
 * <planetTerrain [radius]="600_000" [heights]="heights" [detailNoise]="0.04" />
 * ```
 *
 * The planet's centre is the scene origin. Selection every frame (in the engine's `beforeRender$`) does not depend on the
 * view direction: only which selected leaves are drawn does. The camera must be a `PerspectiveCamera`; its near and far
 * planes are yours to set (a reversed depth buffer, `webGpuRendererParameters: { reversedDepthBuffer: true }`, covers a 2 cm
 * near plane and an orbit view together). Needs `preferredRenderer: 'webgpu'`; on any other renderer it stays hidden.
 *
 * Inputs are read when they change: changing `radius`, `warp`, `heights`, `patchCells`, `leafCap`, `material` or switching
 * the noise on or off rebuilds the mesh; the other inputs only update it. Telemetry (leaves, drawn leaves, selection time,
 * triangles) is on {@link PlanetTerrainComponent.terrain}.
 */
@Component({
  standalone: true,
  selector: 'planetTerrain',
  template: '',
})
export class PlanetTerrainComponent {
  private readonly engine = inject(EngineService);
  private readonly flat = createHeightSource('flat', 'sphere');

  /** The sphere's radius in metres. */
  readonly radius = input.required<number>();
  /**
   * Heights in metres above the sphere. Default: flat. An analytic source (`createHeightSource(id, 'sphere')`) or a baked
   * one (`bakeInWorker` or `runBake`, then `createTextureHeightSource`) made for this radius and `warp`.
   */
  readonly heights = input<HeightSource | undefined>(undefined);
  /** Detail noise below the height texture's texel, amplitude as a share of the texel; 0 is off. Default 0.04. */
  readonly detailNoise = input<number>(TERRAIN_DEFAULTS.detailNoise);
  /** Texels per face side the noise is sized by. Default: the baked heights' own texture, else 1,024. */
  readonly detailCells = input<number | undefined>(undefined);
  /** The most leaves selected. Default 4,096. */
  readonly leafCap = input<number>(TERRAIN_DEFAULTS.leafCap);
  /** Target cell size on screen in pixels (the pixel floor of 2 px applies). Default 4. */
  readonly cellPixels = input<number>(TERRAIN_DEFAULTS.cellPixels);
  /** Grid cells per leaf side: 16, 32 or 64. Default 16. */
  readonly patchCells = input<PatchCells>(TERRAIN_DEFAULTS.patchCells);
  /** Split/merge hysteresis ratio. Default 0.15; 0 is a single threshold. */
  readonly hysteresis = input<number>(TERRAIN_DEFAULTS.hysteresis);
  /** Draw only the selected leaves inside the camera's frustum. Default on. */
  readonly cull = input(true);
  /** `'equal-angle'` (default) or `'none'` cube warp. Baked heights must have been made with the same one. */
  readonly warp = input<CubeWarp>('equal-angle');
  /** A node material to draw with; the terrain sets its `positionNode`. Default: the debug material (level colours, sun lighting). You dispose it. */
  readonly material = input<NodeMaterial | undefined>(undefined);
  /** Direction to the sun in the scene frame, for the default material. */
  readonly sunDirection = input<Vec3 | readonly [number, number, number]>([0.4, 0.8, 0.45]);
  /** Default material colouring: one colour per level, or grey. */
  readonly view = input<LodView>('lod');
  /** Sun lighting on the default material. */
  readonly lighting = input(true);
  /** Patch outlines on the default material. */
  readonly bounds = input(true);
  /** Wireframe drawing. */
  readonly wireframe = input(false);

  /** The terrain once the inputs are set: its selector, stats and surface for anything this wrapper doesn't cover. */
  readonly terrain = attachLodTerrain(
    this.engine,
    inject(DestroyRef),
    computed(() => {
      const detailCells = this.detailCells();
      const material = this.material();
      return {
        settings: {
          domain: { kind: 'sphere', sizeM: this.radius(), warp: this.warp() },
          heights: this.heights() ?? this.flat,
          detailNoise: this.detailNoise(),
          ...(detailCells === undefined ? {} : { detailCells }),
          leafCap: this.leafCap(),
          cellPixels: this.cellPixels(),
          patchCells: this.patchCells(),
          hysteresis: this.hysteresis(),
          cull: this.cull(),
          ...(material ? { material } : {}),
        },
        sunDirection: this.sunDirection(),
        view: this.view(),
        lighting: this.lighting(),
        bounds: this.bounds(),
        wireframe: this.wireframe(),
      };
    }),
  );
}
