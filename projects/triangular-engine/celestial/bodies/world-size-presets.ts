import { ICelestialBody, muForSurfaceGravity } from './celestial-body';
import {
  ITerrainBiomeDef,
  ITerrainDef,
  TerrainGeneratorDef,
} from '../surfaces/terrain-def';
import {
  FAR_MOON,
  HOME_MOON,
  HOME_PLANET,
  STATIONARY_TEST_MOON,
  SUN,
} from './stock-bodies';

/** `plans/world-size-presets.md` — discrete new-game size choice, not a slider. */
export type WorldSizeTier =
  | 'mini'
  | 'extra-small'
  | 'small'
  | 'medium'
  | 'large'
  | 'extra-large';

/** The playable bodies returned for a world-size tier. */
export type StockBodiesForTier = readonly [
  ICelestialBody,
  ICelestialBody,
  ICelestialBody,
  ICelestialBody,
  ICelestialBody,
];

export const DEFAULT_WORLD_SIZE_TIER: WorldSizeTier = 'medium';

const EARTH_RADIUS_M = 6_371_000;

/**
 * Earth-radius-fraction anchors (04_north-star-features.md §13's
 * 2026-07-30 refinement). `medium` is pinned to today's `HOME_PLANET` radius
 * rather than an independent fraction, so nothing existing shifts under
 * this. Proposed boundaries, not locked in — expect these to move once
 * Bruno flies each tier.
 */
export const WORLD_SIZE_TIER_RADIUS_M: Readonly<Record<WorldSizeTier, number>> =
  {
    mini: EARTH_RADIUS_M * 0.001,
    'extra-small': EARTH_RADIUS_M * 0.01,
    small: EARTH_RADIUS_M * 0.03,
    medium: HOME_PLANET.radiusM,
    large: EARTH_RADIUS_M * 0.3,
    'extra-large': EARTH_RADIUS_M,
  };

/** One row per tier, in size order — the shape a new-game picker iterates over. */
export interface IWorldSizeTierOption {
  id: WorldSizeTier;
  label: string;
  radiusM: number;
  /**
   * `false` until `plans/distant-body-visual-scale.md` ships: at ~6 km
   * radius, mini is optically invisible from any real travel distance with
   * today's plain true-scale sphere rendering, so it's excluded from the
   * new-game picker rather than offered as a size nobody can actually see.
   */
  selectable: boolean;
}

export const WORLD_SIZE_TIERS: readonly IWorldSizeTierOption[] = [
  {
    id: 'mini',
    label: 'Mini',
    radiusM: WORLD_SIZE_TIER_RADIUS_M.mini,
    selectable: false,
  },
  {
    id: 'extra-small',
    label: 'Extra Small',
    radiusM: WORLD_SIZE_TIER_RADIUS_M['extra-small'],
    selectable: true,
  },
  {
    id: 'small',
    label: 'Small',
    radiusM: WORLD_SIZE_TIER_RADIUS_M.small,
    selectable: true,
  },
  {
    id: 'medium',
    label: 'Medium',
    radiusM: WORLD_SIZE_TIER_RADIUS_M.medium,
    selectable: true,
  },
  {
    id: 'large',
    label: 'Large',
    radiusM: WORLD_SIZE_TIER_RADIUS_M.large,
    selectable: true,
  },
  {
    id: 'extra-large',
    label: 'Extra Large',
    radiusM: WORLD_SIZE_TIER_RADIUS_M['extra-large'],
    selectable: true,
  },
];

/**
 * Scales a stock body to a world-size tier. Surface gravity is re-derived
 * via `muForSurfaceGravity` from the body's own unscaled gravity, so it
 * never drifts (04_north-star-features.md §13's core trick); atmosphere
 * height and orbit distance scale with radius as a first-pass default (the
 * "not designed yet" open question in `plans/world-size-presets.md` —
 * tunable once Bruno flies a non-medium tier).
 *
 * Terrain amplitudes stay in absolute metres, while generator frequencies are
 * converted back to the same physical wavelengths as the medium world. This
 * keeps mountains, meadows, craters, and ocean basins recognisable at every
 * tier instead of making small worlds wrinkly and large worlds featureless.
 */
function scaleTerrainFrequency(
  generator: TerrainGeneratorDef,
  inverseScale: number,
): TerrainGeneratorDef {
  const mask = generator.mask
    ? { ...generator.mask, frequency: generator.mask.frequency * inverseScale }
    : undefined;
  const warp =
    'warp' in generator && generator.warp
      ? {
          ...generator.warp,
          frequency: generator.warp.frequency * inverseScale,
        }
      : undefined;
  switch (generator.kind) {
    case 'crater-field-3d':
      return {
        ...generator,
        cellFrequency: generator.cellFrequency * inverseScale,
        mask,
      };
    case 'fractal-noise-3d':
    case 'ridged-fractal-3d':
    case 'terrace-fractal-3d':
    case 'canyon-3d':
    case 'dunes-3d':
      return {
        ...generator,
        frequency: generator.frequency * inverseScale,
        warp,
        mask,
      };
    case 'continental-3d':
      return {
        ...generator,
        frequency: generator.frequency * inverseScale,
        coastVariation: generator.coastVariation
          ? {
              ...generator.coastVariation,
              frequency: generator.coastVariation.frequency * inverseScale,
            }
          : undefined,
        warp,
        mask,
      };
  }
}

function scaleTerrainDefinition(
  terrain: ITerrainDef,
  scale: number,
): ITerrainDef {
  if (scale === 1) return terrain;
  const inverseScale = 1 / scale;
  const scaleBiome = (biome: ITerrainBiomeDef): ITerrainBiomeDef => ({
    ...biome,
    mask: { ...biome.mask, frequency: biome.mask.frequency * inverseScale },
    generators: biome.generators.map((generator) =>
      scaleTerrainFrequency(generator, inverseScale),
    ),
  });
  return {
    ...terrain,
    generators: terrain.generators.map((generator) =>
      scaleTerrainFrequency(generator, inverseScale),
    ),
    biomes: terrain.biomes?.map(scaleBiome),
  };
}

function scaleBody(
  body: ICelestialBody,
  scale: number,
  surfaceGravityMPerS2: number,
): ICelestialBody {
  const radiusM = body.radiusM * scale;
  return {
    ...body,
    radiusM,
    muM3PerS2: muForSurfaceGravity(radiusM, surfaceGravityMPerS2),
    terrain: body.terrain
      ? scaleTerrainDefinition(body.terrain, scale)
      : undefined,
    atmosphere: body.atmosphere
      ? {
          ...body.atmosphere,
          scaleHeightM: body.atmosphere.scaleHeightM * scale,
          topAltitudeM: body.atmosphere.topAltitudeM * scale,
        }
      : undefined,
    ringSystems: body.ringSystems?.map((rings) => ({
      ...rings,
      innerRadiusM: rings.innerRadiusM * scale,
      outerRadiusM: rings.outerRadiusM * scale,
    })),
    orbit: body.orbit
      ? { ...body.orbit, semiMajorAxisM: body.orbit.semiMajorAxisM * scale }
      : undefined,
    fixedPositionRelativeToParentM: body.fixedPositionRelativeToParentM
      ? [
          body.fixedPositionRelativeToParentM[0] * scale,
          body.fixedPositionRelativeToParentM[1] * scale,
          body.fixedPositionRelativeToParentM[2] * scale,
        ]
      : undefined,
  };
}

function surfaceGravityMPerS2(body: ICelestialBody): number {
  return body.muM3PerS2 / (body.radiusM * body.radiusM);
}

const SUN_SURFACE_GRAVITY_M_PER_S2 = surfaceGravityMPerS2(SUN);
const HOME_PLANET_SURFACE_GRAVITY_M_PER_S2 = surfaceGravityMPerS2(HOME_PLANET);
const HOME_MOON_SURFACE_GRAVITY_M_PER_S2 = surfaceGravityMPerS2(HOME_MOON);
const FAR_MOON_SURFACE_GRAVITY_M_PER_S2 = surfaceGravityMPerS2(FAR_MOON);
const STATIONARY_TEST_MOON_SURFACE_GRAVITY_M_PER_S2 =
  surfaceGravityMPerS2(STATIONARY_TEST_MOON);

/**
 * The stock system (`SUN` + `HOME_PLANET` + `HOME_MOON` + `FAR_MOON` + `STATIONARY_TEST_MOON`) scaled to a world-size
 * tier (`plans/world-size-presets.md`). `medium` is an exact pass-through of
 * today's bodies — every other tier scales radius, orbit distance, and
 * atmosphere height by the same factor while holding each body's own surface
 * gravity constant. Terrain relief is left absolute (see `scaleBody`).
 */
export function createStockBodiesForTier(
  tier: WorldSizeTier = 'medium',
): StockBodiesForTier {
  if (tier === 'medium')
    return [SUN, HOME_PLANET, HOME_MOON, FAR_MOON, STATIONARY_TEST_MOON];
  const scale = WORLD_SIZE_TIER_RADIUS_M[tier] / HOME_PLANET.radiusM;
  return [
    scaleBody(SUN, scale, SUN_SURFACE_GRAVITY_M_PER_S2),
    scaleBody(HOME_PLANET, scale, HOME_PLANET_SURFACE_GRAVITY_M_PER_S2),
    scaleBody(HOME_MOON, scale, HOME_MOON_SURFACE_GRAVITY_M_PER_S2),
    scaleBody(FAR_MOON, scale, FAR_MOON_SURFACE_GRAVITY_M_PER_S2),
    scaleBody(
      STATIONARY_TEST_MOON,
      scale,
      STATIONARY_TEST_MOON_SURFACE_GRAVITY_M_PER_S2,
    ),
  ];
}

/** Convenient helper to get stock system bodies for a given tier (defaults to medium). */
export function getStockBodies(
  tier: WorldSizeTier = 'medium',
): readonly ICelestialBody[] {
  return createStockBodiesForTier(tier);
}

/** Convenient helper to get the central star for a given tier (defaults to medium). */
export function getSun(tier: WorldSizeTier = 'medium'): ICelestialBody {
  return createStockBodiesForTier(tier)[0];
}

/** Convenient helper to get the home planet for a given tier (defaults to medium). */
export function getHomePlanet(tier: WorldSizeTier = 'medium'): ICelestialBody {
  return createStockBodiesForTier(tier)[1];
}

/** Convenient helper to get the home moon for a given tier (defaults to medium). */
export function getHomeMoon(tier: WorldSizeTier = 'medium'): ICelestialBody {
  return createStockBodiesForTier(tier)[2];
}

/** Convenient helper to get the far outer moon for a given tier (defaults to medium). */
export function getFarMoon(tier: WorldSizeTier = 'medium'): ICelestialBody {
  return createStockBodiesForTier(tier)[3];
}

/**
 * Gets the diagnostic stationary moon at the selected world's scale.
 *
 * Keeping this out of the playable-body tuple prevents debug fixtures from
 * becoming part of the game's navigable stock system by accident.
 */
export function getStationaryTestMoon(
  tier: WorldSizeTier = 'medium',
): ICelestialBody {
  const scale = WORLD_SIZE_TIER_RADIUS_M[tier] / HOME_PLANET.radiusM;
  return tier === 'medium'
    ? STATIONARY_TEST_MOON
    : scaleBody(
        STATIONARY_TEST_MOON,
        scale,
        surfaceGravityMPerS2(STATIONARY_TEST_MOON),
      );
}
