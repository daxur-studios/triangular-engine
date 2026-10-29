import { Component, DestroyRef, computed, inject, input } from '@angular/core';
import type { NodeMaterial } from 'three/webgpu';
import { EngineService } from 'triangular-engine';
import {
  TERRAIN_DEFAULTS, createHeightSource, type GroundSample, type HeightSource, type LodView, type PatchCells, type Vec3,
} from 'triangular-engine/lod-surface/core';
import { attachLodTerrain } from './attach-lod-terrain';

/**
 * The 3D ground of a bounded square, with level of detail: the same terrain as `<planetTerrain>` on a plane, for games that
 * are not on a planet.
 *
 * ```html
 * <flatTerrain [size]="100_000" [heights]="heights" />
 * ```
 *
 * The square lies in the XZ plane, centred on the scene origin, with +Y up, so it spans `[-size / 2, size / 2]` on both
 * axes. Everything else works as on {@link PlanetTerrainComponent}: view-independent selection from the active camera in
 * `beforeRender$`, one draw call, a `PerspectiveCamera` whose near and far planes you set, WebGPU only.
 */
@Component({
  standalone: true,
  selector: 'flatTerrain',
  template: '',
})
export class FlatTerrainComponent {
  private readonly engine = inject(EngineService);
  private readonly flat = createHeightSource('flat', 'plane');

  /** Side of the square in metres. */
  readonly size = input.required<number>();
  /**
   * Heights in metres above the plane. Default: flat. An analytic source (`createHeightSource(id, 'plane')`) or a baked
   * one (`bakeInWorker` or `runBake`, then `createTextureHeightSource`) made for this size.
   */
  readonly heights = input<HeightSource | undefined>(undefined);
  /** Detail noise below the height texture's texel, amplitude as a share of the texel; 0 is off. Default 0.04. */
  readonly detailNoise = input<number>(TERRAIN_DEFAULTS.detailNoise);
  /** Texels per side the noise is sized by. Default: the baked heights' own texture, else 1,024. */
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
          domain: { kind: 'plane', sizeM: this.size(), warp: 'equal-angle' },
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

  /**
   * The ground under `position` (a point in the scene frame, e.g. a character's feet): height, ground point, normal and
   * altitude, from the CPU twin with detail noise. `undefined` until the terrain exists. Pass `out` to allocate nothing.
   */
  groundAt(position: Vec3, out?: GroundSample): GroundSample | undefined {
    return this.terrain()?.groundAt(position, out);
  }
}
