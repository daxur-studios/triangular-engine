import { Component, DestroyRef, computed, effect, inject, input, untracked, type Signal } from '@angular/core';
import type { NodeMaterial } from 'three/webgpu';
import { EngineService, PLANET_CONTEXT } from 'triangular-engine';
import {
  TERRAIN_DEFAULTS, createHeightSource, type GroundSample, type CubeWarp, type HeightSource, type LodView, type PatchCells, type Vec3,
} from 'triangular-engine/lod-surface/core';
import { TerrainPlanetMaterial } from '../terrain-planet-material';
import { attachLodTerrain } from './attach-lod-terrain';
import { PlanetComponent } from './planet.component';

/** The sun used when neither the terrain nor a `<planet>` gives one. */
const DEFAULT_SUN: Vec3 = [0.4, 0.8, 0.45];

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
 * Each new mesh (the first, and every rebuild) is compiled with `renderer.compileAsync` before it is drawn: the terrain stays
 * hidden, still selecting, until that finishes, so a new material does not stall the first frame. A failed compile is reported
 * on `engine.error$` (phase `compile`) and the terrain is shown anyway.
 *
 * **Inside `<planet>`.** `radius`, `sunDirection`, `heights` and `material` are optional there and read from the planet when
 * the terrain does not set them (a terrain input always wins): the planet's `radius` and `sunDirection`; its baked `heights`
 * when it has a `world` (flat until the bake lands, then the mesh is rebuilt); and, for that `world`, a
 * `TerrainPlanetMaterial` painted from the same cell planet, which the terrain makes, owns and disposes (on destroy and when
 * the world changes). A `material` you pass stays yours to dispose. With no radius from either, the terrain shows nothing and
 * says so once on `engine.error$` (phase `config`). While the planet's `morph` is above 0 the terrain still draws the sphere
 * (the bend arrives in step G6) and says so once on `engine.error$` (phase `morph`). Without a `<planet>` nothing changes.
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
  private readonly context = inject(PLANET_CONTEXT, { optional: true });
  private readonly planet = inject(PlanetComponent, { optional: true });

  /** The sphere's radius in metres. Required unless the terrain is inside a `<planet>`, whose radius is used. */
  readonly radius = input<number | undefined>(undefined);
  /**
   * Heights in metres above the sphere. Default: the enclosing `<planet>`'s baked `world` heights, else flat. An analytic source (`createHeightSource(id, 'sphere')`) or a baked
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
  /**
   * A node material to draw with; the terrain sets its `positionNode`. Default: the debug material (level colours, sun lighting).
   * You dispose it.
   *
   * To draw with the planet material, pass a `TerrainPlanetMaterial` (`new TerrainPlanetMaterial({ cellPlanet: world })`):
   * the terrain hands it its vertex nodes and sun itself, so there is nothing else to wire. It is lit by scene lights.
   *
   * Inside a `<planet>` with a `world`, leave it unset: the terrain then makes and owns a `TerrainPlanetMaterial` for that world.
   */
  readonly material = input<NodeMaterial | undefined>(undefined);
  /**
   * Direction to the sun in the scene frame, for the default material, and passed to a `TerrainPlanetMaterial` as its
   * `setSunDirection` (the scene's own light is still yours to place). Default: the enclosing `<planet>`'s, else `[0.4, 0.8, 0.45]`.
   */
  readonly sunDirection = input<Vec3 | readonly [number, number, number] | undefined>(undefined);
  /** Default material colouring: one colour per level, or grey. */
  readonly view = input<LodView>('lod');
  /** Sun lighting on the default material. */
  readonly lighting = input(true);
  /** Patch outlines on the default material. */
  readonly bounds = input(true);
  /** Wireframe drawing. */
  readonly wireframe = input(false);

  private readonly effectiveRadius = computed(() => this.radius() ?? this.context?.radius());
  /** The material made for the enclosing planet's world, kept to dispose it when it is replaced and on destroy. */
  private ownedMaterial: TerrainPlanetMaterial | undefined;
  private readonly groundMaterial = computed(() => {
    // Not pure: it makes and disposes a material. Only the terrain's effect reads it, and swaps the mesh to the returned
    // material in the same run, so the old one is never drawn after it is disposed.
    const cellPlanet = this.material() ? undefined : this.planet?.cellPlanet();
    return untracked(() => {
      this.ownedMaterial?.dispose();
      this.ownedMaterial = undefined;
      if (!cellPlanet) return undefined;
      try {
        this.ownedMaterial = new TerrainPlanetMaterial({ cellPlanet });
      } catch (error) {
        this.report('config', error);
      }
      return this.ownedMaterial;
    });
  });

  /**
   * The node material the ground is drawn with when it is a planet material: the `material` input if set, else the
   * `TerrainPlanetMaterial` the terrain made for the enclosing `<planet>`'s `world`. Undefined when the terrain draws its own
   * debug material (no `material`, no `world`), and while the terrain has no radius. Read it for
   * `<planetAtmosphere [surfaces]="[...]">` (a `TerrainPlanetMaterial` is a `PlanetSurfaceMaterial`, which the atmosphere
   * lights and hazes); the signal changes when the material is replaced. Reading it never disposes anything: the terrain still
   * owns its own material, and an own `material` stays yours.
   */
  readonly surface: Signal<NodeMaterial | undefined> = computed(() => {
    if (this.effectiveRadius() === undefined) return undefined;
    return this.material() ?? this.groundMaterial();
  });

  /** The terrain once the inputs are set: its selector, stats and surface for anything this wrapper doesn't cover. */
  readonly terrain = attachLodTerrain(
    this.engine,
    inject(DestroyRef),
    computed(() => {
      const radius = this.effectiveRadius();
      if (radius === undefined) return undefined;
      const detailCells = this.detailCells();
      // Read both, so the owned material is released as soon as an own `material` is set.
      const own = this.material();
      const owned = this.groundMaterial();
      const material = own ?? owned;
      return {
        settings: {
          domain: { kind: 'sphere', sizeM: radius, warp: this.warp() },
          heights: this.heights() ?? this.planet?.heights() ?? this.flat,
          detailNoise: this.detailNoise(),
          ...(detailCells === undefined ? {} : { detailCells }),
          leafCap: this.leafCap(),
          cellPixels: this.cellPixels(),
          patchCells: this.patchCells(),
          hysteresis: this.hysteresis(),
          cull: this.cull(),
          ...(material ? { material } : {}),
        },
        sunDirection: this.sunDirection() ?? this.context?.sunDirection() ?? DEFAULT_SUN,
        view: this.view(),
        lighting: this.lighting(),
        bounds: this.bounds(),
        wireframe: this.wireframe(),
      };
    }),
  );

  private reportedConfig = false;
  private reportedMorph = false;

  constructor() {
    effect(() => {
      const missing = this.effectiveRadius() === undefined;
      untracked(() => {
        if (missing && !this.reportedConfig) {
          this.reportedConfig = true;
          this.report('config', new Error('<planetTerrain> has no radius: set [radius] or put it inside a <planet [radius]>. Nothing is drawn.'));
        }
      });
    });
    effect(() => {
      const morph = this.context?.morph() ?? 0;
      untracked(() => {
        if (morph > 0 && !this.reportedMorph) {
          this.reportedMorph = true;
          this.report('morph', new Error("<planetTerrain> draws the sphere only: the planet's morph is above 0, but the terrain does not bend into the map until the globe-to-map morph (Plan 059, step G6)."));
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.ownedMaterial?.dispose();
      this.ownedMaterial = undefined;
    });
  }

  private report(phase: string, error: unknown): void {
    if (this.engine.error$) this.engine.error$.next({ phase, error });
    else console.warn(`[triangular-engine] <planetTerrain> ${phase}:`, error);
  }

  /**
   * The ground under `position` (a point in the scene frame, e.g. a character's feet): height, ground point, normal and
   * altitude, from the CPU twin with detail noise. `undefined` until the terrain exists. Pass `out` to allocate nothing.
   */
  groundAt(position: Vec3, out?: GroundSample): GroundSample | undefined {
    return this.terrain()?.groundAt(position, out);
  }
}
