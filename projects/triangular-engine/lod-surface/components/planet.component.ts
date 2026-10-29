import {
  Component, DestroyRef, EnvironmentInjector, afterNextRender, computed, effect, forwardRef, inject, input, signal, untracked, type Signal,
} from '@angular/core';
import { EngineService, PLANET_CONTEXT, type PlanetContext } from 'triangular-engine';
import {
  cellPlanetHeights, resolveCellPlanetWorld, runBake, seaAlignedGlobeRadius,
  type BakeClient, type CellPlanetHeightsOptions, type CellPlanetSource, type HeightSource, type TextureHeightSource, type Vec3,
} from 'triangular-engine/lod-surface/core';
import {
  createPlanetMorphUniforms, setPlanetMapExtent, setPlanetProjectionCentre, type IPlanetMorphUniforms,
} from 'triangular-engine/planet-material';

/**
 * A cell planet for {@link PlanetComponent.world}: {@link CellPlanetHeightsOptions} without the `radius` (the planet's own is
 * used) and without `warp` (the planet bakes with the terrain's default, `'equal-angle'`, so leave `<planetTerrain [warp]>` alone).
 * The `seed`, `cellCount` and `relaxationIterations` must match the ones the game used for `buildCellPlanetWorld`.
 */
export type PlanetWorld = Omit<CellPlanetHeightsOptions, 'radius' | 'warp'>;

/** The map projections the planet's morph can use. */
export type PlanetProjection = 'equal-earth' | 'equirectangular';

/** Where the map is centred: a longitude and latitude in degrees on the planet's body frame (longitude 0 is +Z, latitude 0 the equator). */
export interface PlanetProjectionCentre {
  readonly lonDeg: number;
  readonly latDeg: number;
}

/** The sun the terrain used before `<planet>` existed: a late-afternoon sun, normalised. */
const DEFAULT_SUN = [0.4, 0.8, 0.45] as const;

function normaliseSun(direction: Vec3 | readonly [number, number, number]): readonly [number, number, number] {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  // A zero or non-finite direction would make NaNs in every shader; fall back to the default instead.
  if (!Number.isFinite(length) || length === 0) return normaliseSun(DEFAULT_SUN);
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function clampMorph(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function sameWorld(a: PlanetWorld | undefined, b: PlanetWorld | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.seed === b.seed && a.cellCount === b.cellCount && a.relaxationIterations === b.relaxationIterations
    && a.heightScaleM === b.heightScaleM && a.bakeK === b.bakeK;
}

/** The default `bake`: runs the bake on the calling thread, after yielding once so the page can paint first. */
const inlineBake: BakeClient = async (source, layout, planet) => {
  await new Promise<void>((resolve) => setTimeout(resolve));
  const began = performance.now();
  const output = runBake(source, layout, planet);
  return { ...output, roundTripMs: performance.now() - began };
};

/**
 * One planet shared by the layers drawn on it: its radius, the sun, the globe-to-map morph and, optionally, a cell-planet
 * world. Children read these in place of their own inputs, so they are written once. Preview (Plan 059, step G5).
 *
 * ```html
 * <planet [radius]="600_000" [sunDirection]="sun" [world]="{ seed: 7, cellCount: 1500, heightScaleM: 9_000 }" [bake]="bake">
 *   <planetTerrain />
 *   <planetAtmosphere preset="earth" [surfaces]="[...]" />
 * </planet>
 * ```
 *
 * It draws nothing and is not an `Object3D`. The planet's centre is the scene origin (there is no `centre` input). It
 * provides {@link PLANET_CONTEXT}, which `<planetTerrain>` and `<planetAtmosphere>` inject optionally; a child's own input
 * always wins, and both keep working with no `<planet>` around them.
 *
 * **Morph.** `morph` (0 globe, 1 flat map), `projection` and `projectionCentre` are written into one set of morph
 * uniforms ({@link morphUniforms}); `morphUniform` is its `uMorph`, which the atmosphere follows. The terrain does not bend
 * yet (step G6): while `morph` is above 0 it keeps drawing the sphere and says so once on `engine.error$` (phase `morph`).
 *
 * **World.** With `world` set, the planet bakes the heights ({@link heights}), and `<planetTerrain>` inside it draws them
 * with a `TerrainPlanetMaterial` painted from the same world ({@link cellPlanet}), unless it is given its own `heights` or
 * `material`. Until the bake resolves `heights()` is undefined and the terrain is flat. The bake runs on the calling
 * thread unless you pass a worker-backed `bake`.
 */
@Component({
  standalone: true,
  selector: 'planet',
  template: '<ng-content />',
  providers: [{ provide: PLANET_CONTEXT, useExisting: forwardRef(() => PlanetComponent) }],
})
export class PlanetComponent implements PlanetContext {
  private readonly engine = inject(EngineService);
  private readonly injector = inject(EnvironmentInjector);

  /** The planet's radius in metres (sea level). */
  readonly radius = input.required<number>();
  /**
   * Direction to the sun in the scene frame (the planet's centre is the scene origin). Any length: the value read from
   * {@link sunDirection} is normalised. Default `[0.4, 0.8, 0.45]`, the terrain's own default.
   */
  readonly sunDirection = input<readonly [number, number, number], Vec3 | readonly [number, number, number]>(
    normaliseSun(DEFAULT_SUN),
    { transform: normaliseSun },
  );
  /** 0 is the globe, 1 is the flat map; values outside are clamped. Default 0. */
  readonly morph = input<number, number>(0, { transform: clampMorph });
  /** The map projection the morph flattens to. Default `'equal-earth'`. */
  readonly projection = input<PlanetProjection>('equal-earth');
  /** Centre the map on a longitude and latitude (degrees, planet body frame), or `null` for the baked centre. Default `null`. */
  readonly projectionCentre = input<PlanetProjectionCentre | null>(null);
  /**
   * A cell planet (`triangular-engine/worldgen`) to draw: the planet bakes its heights and `<planetTerrain>` inside it uses
   * them and the planet's colours. Optional; without it the terrain is flat unless it is given `heights`.
   */
  readonly world = input<PlanetWorld | undefined>(undefined);
  /**
   * How `world`'s heights are baked. Default: on the calling thread, which blocks the page for the length of the bake
   * (seconds at large `cellCount`). For a real game pass a worker-backed client:
   * `createBakeClient(() => new Worker(new URL('./height-bake.worker', import.meta.url), { type: 'module' }))`.
   */
  readonly bake = input<BakeClient | undefined>(undefined);

  /**
   * The one set of morph uniforms every layer shares, written from `morph`, `projection`, `projectionCentre` and `radius`
   * (the map extent). Owned by the planet; the globe-to-map morph (step G6) reads it.
   */
  readonly morphUniforms: IPlanetMorphUniforms = createPlanetMorphUniforms();
  /** The shared morph uniform, `morphUniforms.uMorph`: the same object for the planet's life. */
  readonly morphUniform: { value: number } = this.morphUniforms.uMorph;

  private readonly worldDescription = computed(() => this.world(), { equal: sameWorld });
  private readonly bakedHeights = signal<TextureHeightSource | undefined>(undefined);
  private bakeSerial = 0;
  private current: TextureHeightSource | undefined;
  private readonly retiring = new Set<TextureHeightSource>();
  private destroyed = false;

  /**
   * The baked heights of `world` for the planet's `radius`, for `<planetTerrain [heights]>`: undefined without a `world`
   * and until its bake resolves (so the terrain is flat meanwhile and rebuilds when this lands). The planet owns the
   * source and frees its texture when it is replaced and on destroy.
   */
  readonly heights: Signal<HeightSource | undefined> = computed(() => {
    const source = this.bakedHeights();
    // A bake is only offered for the radius it was made for, even in the moment before the effect that restarts the bake runs.
    return source && source.baked.layout.sizeM === this.radius() ? source : undefined;
  });

  /** `world` as the description `TerrainPlanetMaterial`'s `cellPlanet` takes; undefined without a `world`. */
  readonly cellPlanet: Signal<CellPlanetSource | undefined> = computed(() => {
    const world = this.worldDescription();
    if (!world) return undefined;
    return {
      seed: world.seed,
      cellCount: world.cellCount,
      ...(world.relaxationIterations === undefined ? {} : { relaxationIterations: world.relaxationIterations }),
    };
  });

  /**
   * The radius to draw a separate morph globe at so its sea meets the terrain's (`seaAlignedGlobeRadius`): `radius` less the
   * world's sea level times `heightScaleM`. Undefined without a `world`. Reading it builds the world on the calling thread
   * (once per description; the terrain's material shares it).
   */
  readonly seaAlignedGlobeRadius: Signal<number | undefined> = computed(() => {
    const world = this.worldDescription();
    const source = this.cellPlanet();
    if (!world || !source) return undefined;
    return seaAlignedGlobeRadius(this.radius(), resolveCellPlanetWorld(source), world.heightScaleM);
  });

  constructor() {
    effect(() => {
      this.morphUniforms.uMorph.value = this.morph();
    });
    effect(() => {
      this.morphUniforms.uProjectionType.value = this.projection() === 'equal-earth' ? 1 : 0;
    });
    effect(() => {
      setPlanetProjectionCentre(this.morphUniforms, this.projectionCentre());
    });
    effect(() => {
      setPlanetMapExtent(this.morphUniforms, this.radius());
    });

    effect(() => {
      const world = this.worldDescription();
      const radius = this.radius();
      const bake = this.bake() ?? inlineBake;
      untracked(() => this.startBake(world, radius, bake));
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.bakeSerial += 1;
      this.current?.dispose();
      for (const source of this.retiring) source.dispose();
      this.retiring.clear();
      this.current = undefined;
    });
  }

  private startBake(world: PlanetWorld | undefined, radius: number, bake: BakeClient): void {
    const serial = ++this.bakeSerial;
    // Heights made for another radius or world are no longer valid; the terrain goes flat until the new bake lands.
    this.retire(this.current);
    this.current = undefined;
    this.bakedHeights.set(undefined);
    if (!world) return;
    cellPlanetHeights(bake, { ...world, radius }).then(
      (source) => {
        if (serial !== this.bakeSerial || this.destroyed) {
          // A newer bake (or the end of the planet) overtook this one: the source was never shown.
          source.dispose();
          return;
        }
        this.current = source;
        this.bakedHeights.set(source);
      },
      (error: unknown) => {
        if (serial !== this.bakeSerial || this.destroyed) return;
        if (this.engine.error$) this.engine.error$.next({ phase: 'bake', error });
        else console.warn('[triangular-engine] planet height bake failed:', error);
      },
    );
  }

  /**
   * Frees a replaced source's GPU texture after the next render. The terrain still draws with it until its own effect swaps
   * the heights, which happens in the same change-detection pass, so disposing at once could re-upload the texture for a frame.
   */
  private retire(source: TextureHeightSource | undefined): void {
    if (!source) return;
    this.retiring.add(source);
    afterNextRender(() => {
      if (this.retiring.delete(source)) source.dispose();
    }, { injector: this.injector });
  }
}
