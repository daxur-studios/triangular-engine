import type { CubeWarp } from './lod-domain';
import { DEFAULT_BAKE_K } from './lod-height-bake';
import type { BakeClient } from './lod-height-bake-client';
import { createTextureHeightSource, type TextureHeightSource } from './lod-height-texture';
import { parseCellPlanet } from './lod-height-terrain';

/**
 * A `triangular-engine/worldgen` cell planet as `<planetTerrain>` heights. The world is described, not passed: worldgen
 * is deterministic, so the worker that bakes the heights rebuilds the same world from these parameters.
 */
export interface CellPlanetHeightsOptions {
  /** The `seed` the game passed to `buildCellPlanetWorld` (or the `<planetView>` / map `seed` input). */
  readonly seed: number;
  /** The `cellCount` the game used (at least 12). */
  readonly cellCount: number;
  /** The `relaxationIterations` the game used. Default 2, the worldgen default. */
  readonly relaxationIterations?: number;
  /**
   * Metres per unit of canonical elevation. The height at a point is `(elevation - seaLevel) * heightScaleM`, so the sea
   * is 0 and basins are negative. For a relief of about 1.5 % of the radius, `0.015 * radius` is a start.
   */
  readonly heightScaleM: number;
  /** The `<planetTerrain>` radius in metres: the bake is made for this body and is rejected by another radius. */
  readonly radius: number;
  /** Cube warp; must equal the terrain's `warp` input. Default `'equal-angle'`, like the component. */
  readonly warp?: CubeWarp;
  /** Texture size exponent: `2^bakeK` texel cells per cube-face side. Default 10 (1,025 x 1,025 texels per face, 24 MB). */
  readonly bakeK?: number;
}

/**
 * Bakes the heights of a cell planet in the worker of `bake` ({@link createBakeClient}) and returns them as a height
 * source for `<planetTerrain [heights]>`. Heights are in metres above the sphere with the sea at 0 (see
 * {@link CellPlanetHeightsOptions.heightScaleM}); the CPU twin used by the selector and by gameplay reads the same texels.
 *
 * ```ts
 * // height-bake.worker.ts: serveBakeRequests(self);
 * const bake = createBakeClient(() => new Worker(new URL('./height-bake.worker', import.meta.url), { type: 'module' }));
 * heights = await cellPlanetHeights(bake, { seed: 7, cellCount: 1500, heightScaleM: 4_000, radius: 600_000 });
 * // template: <planetTerrain [radius]="600_000" [heights]="heights()" />
 * ```
 *
 * **The parameters must match the ones the game used for `buildCellPlanetWorld`**: a different `seed`, `cellCount` or
 * `relaxationIterations` is a different planet. Only those three are described; a world built with a non-default
 * `jitter`, `plateCount`, `worldProfileKind` or `terrain` config is not reproduced.
 *
 * Sphere only: a cell planet has no plane form, so passing the result to `<flatTerrain>` throws. Dispose the source
 * when you replace it (`heights.dispose()`).
 *
 * Rejects when the parameters are invalid (`seed` a non-negative integer, `cellCount` an integer of at least 12,
 * `heightScaleM` positive and finite) or when the bake fails.
 */
export async function cellPlanetHeights(bake: BakeClient, options: CellPlanetHeightsOptions): Promise<TextureHeightSource> {
  const planet = parseCellPlanet({
    seed: options.seed,
    cellCount: options.cellCount,
    relaxationIterations: options.relaxationIterations ?? 2,
    heightScaleM: options.heightScaleM,
  });
  if (!Number.isFinite(options.radius) || options.radius <= 0) throw new Error(`Cell planet radius must be positive: ${options.radius}`);
  const { baked } = await bake(
    'cell-planet',
    { kind: 'sphere', warp: options.warp ?? 'equal-angle', sizeM: options.radius, k: options.bakeK ?? DEFAULT_BAKE_K },
    planet,
  );
  return createTextureHeightSource('cell-planet', baked);
}
