/**
 * Surface material layers shared by plane and planetary terrain renderers.
 *
 * These are deliberately semantic layers rather than texture slots. A caller
 * can turn the weights into vertex attributes, a material tile, a texture
 * array lookup, or procedural shader inputs without changing the terrain
 * sampler contract.
 */
export const TERRAIN_MATERIAL_LAYERS = [
  'water',
  'sand',
  'grass',
  'rock',
  'snow',
] as const;

export type TerrainMaterialLayer = (typeof TERRAIN_MATERIAL_LAYERS)[number];

export const TERRAIN_MATERIAL_LAYER_COUNT = TERRAIN_MATERIAL_LAYERS.length;

export type TerrainMaterialWeights = Record<TerrainMaterialLayer, number>;

/** Inputs that can be supplied by any canonical terrain/world sampler. */
export interface ITerrainMaterialQuery {
  readonly elevationM: number;
  readonly seaLevelM: number;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  /** 0 is flat, 1 is vertical relative to the domain's undeformed surface. */
  readonly slope01: number;
  /** Optional normalized ecology signals. Missing values use neutral defaults. */
  readonly moisture01?: number;
  readonly temperature01?: number;
  /** Explicit cold-surface coverage, such as an ice cap or glacier biome. */
  readonly snowIce01?: number;
  /** Explicit dry-surface signal, such as a desert or steppe biome. */
  readonly arid01?: number;
  readonly ridge01?: number;
  readonly river01?: number;
  readonly wetness01?: number;
}

/**
 * Material masks remain separate from weights so rivers, ridges and edits can
 * affect a shader or texture baker without being forced into a colour choice.
 */
export interface ITerrainMaterialSample {
  readonly weights: TerrainMaterialWeights;
  readonly wetness01: number;
  readonly ridge01: number;
  readonly river01: number;
  /** Dry-surface coverage retained for renderer-specific desert variation. */
  readonly arid01: number;
  readonly snow01: number;
  readonly shore01: number;
  readonly seabed01: number;
}

export interface ITerrainMaterialOptions {
  /** Elevation above which snow is possible when temperature is neutral. */
  readonly snowlineM?: number;
  /** Width of the transition around the snowline. */
  readonly snowlineBlendM?: number;
  /** Extra rock coverage caused by steep terrain. */
  readonly cliffRockStrength?: number;
  /** Extra wetness contributed by a river mask. */
  readonly riverWetnessStrength?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function normalizeWeights(weights: TerrainMaterialWeights): TerrainMaterialWeights {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return { water: 0, sand: 0, grass: 1, rock: 0, snow: 0 };
  }
  return {
    water: weights.water / total,
    sand: weights.sand / total,
    grass: weights.grass / total,
    rock: weights.rock / total,
    snow: weights.snow / total,
  };
}

/**
 * Produces a stable first-pass material sample from canonical terrain signals.
 *
 * This is intentionally a pure CPU function. It is useful for mesh vertex
 * attributes and tile baking today, and its rules can be mirrored in a shader
 * later. Worldgen-specific biome names should be converted to continuous
 * signals by an adapter rather than added to this terrain entry point.
 */
export function evaluateTerrainMaterial(
  query: ITerrainMaterialQuery,
  options: ITerrainMaterialOptions = {},
): ITerrainMaterialSample {
  const slope01 = clamp01(query.slope01);
  const moisture01 = clamp01(query.moisture01 ?? 0.5);
  const temperature01 = clamp01(query.temperature01 ?? 0.5);
  const snowIce01 = clamp01(query.snowIce01 ?? 0);
  const arid01 = clamp01(query.arid01 ?? 0);
  const ridge01 = clamp01(query.ridge01 ?? 0);
  const river01 = clamp01(query.river01 ?? 0);

  const elevationRange = Math.max(1, query.maxElevationM - query.minElevationM);
  const landRange = Math.max(1, query.maxElevationM - query.seaLevelM);
  const aboveSea01 = clamp01((query.elevationM - query.seaLevelM) / landRange);
  const belowSea01 = clamp01((query.seaLevelM - query.elevationM) / elevationRange);
  const shore01 = query.elevationM >= query.seaLevelM
    ? 1 - smoothstep(0, Math.max(1, landRange * 0.04), query.elevationM - query.seaLevelM)
    : 1 - smoothstep(0, Math.max(1, landRange * 0.04), query.seaLevelM - query.elevationM);
  const seabed01 = query.elevationM < query.seaLevelM
    ? smoothstep(0, Math.max(1, elevationRange * 0.18), query.seaLevelM - query.elevationM)
    : 0;

  const snowlineM = options.snowlineM ?? 4500;
  const snowlineBlendM = Math.max(1, options.snowlineBlendM ?? 700);
  const elevationSnow01 = smoothstep(
    snowlineM - snowlineBlendM,
    snowlineM + snowlineBlendM,
    query.elevationM,
  );
  // Cold climate can produce snow and ice below the elevation snowline. The explicit
  // snowIce01 signal is used for discrete worldgen results such as ice_cap/glacier and
  // wins over the continuous climate/elevation estimate.
  const coldClimate01 = 1 - smoothstep(0.12, 0.42, temperature01);
  const climateSnow01 = coldClimate01 * (0.55 + aboveSea01 * 0.45);
  const snow01 = clamp01(
    Math.max(
      snowIce01,
      climateSnow01,
      elevationSnow01 * (1 - temperature01 * 0.65),
    ),
  );
  const cliffRockStrength = options.cliffRockStrength ?? 0.9;
  const rock01 = clamp01(
    slope01 * cliffRockStrength + ridge01 * 0.45 + aboveSea01 * 0.12,
  );
  const wetness01 = clamp01(
    Math.max(query.wetness01 ?? 0, moisture01 * 0.22 + river01 * (options.riverWetnessStrength ?? 0.9)),
  );

  let weights: TerrainMaterialWeights;
  if (query.elevationM < query.seaLevelM) {
    const iceWater01 = snowIce01;
    const shallowSand = shore01 * 0.55 * (1 - iceWater01);
    const deepWater = belowSea01 * 0.85;
    weights = {
      water: deepWater * (1 - iceWater01),
      sand: shallowSand + (1 - belowSea01) * 0.15,
      grass: 0,
      rock: seabed01 * 0.35,
      snow: iceWater01,
    };
  } else {
    const riverBank = river01 * 0.3 + wetness01 * 0.1;
    // Arid biomes need to displace grass, not merely add sand on top of the
    // normal grass contribution. This keeps deserts visibly dry while still
    // allowing steppe and savanna to retain a partial grass cover.
    const grassCoverage = (1 - rock01) * (1 - snow01) * (0.7 + moisture01 * 0.3);
    const aridGrassSuppression = 1 - arid01 * 0.92;
    const dryGround = arid01 * (0.75 + (1 - moisture01) * 0.25);
    weights = {
      water: 0,
      sand: shore01 * 0.55 + riverBank + dryGround,
      grass: grassCoverage * aridGrassSuppression,
      rock: rock01 * (1 - snow01),
      snow: snow01,
    };
  }

  return {
    weights: normalizeWeights(weights),
    wetness01,
    ridge01,
    river01,
    arid01,
    snow01,
    shore01,
    seabed01,
  };
}

/** Packs weights in the stable TERRAIN_MATERIAL_LAYERS order for GPU upload. */
export function packTerrainMaterialWeights(
  sample: ITerrainMaterialSample,
  target = new Float32Array(TERRAIN_MATERIAL_LAYER_COUNT),
): Float32Array {
  if (target.length !== TERRAIN_MATERIAL_LAYER_COUNT) {
    throw new RangeError(
      `Terrain material weight target must contain ${TERRAIN_MATERIAL_LAYER_COUNT} values.`,
    );
  }
  for (let index = 0; index < TERRAIN_MATERIAL_LAYERS.length; index++) {
    target[index] = sample.weights[TERRAIN_MATERIAL_LAYERS[index]];
  }
  return target;
}
