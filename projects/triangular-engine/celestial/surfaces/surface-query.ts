import { ICelestialBody } from '../bodies/celestial-body';
import {
  Vec3d,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from '../math/vec3';
import {
  IFractalNoiseTerrainGeneratorDef,
  ILocalFlattenCircleModifierDef,
  ILocalFlattenRectModifierDef,
  ILocalFlattenTerrainModifierDef,
  ITerrainBiomeDef,
  ITerrainDef,
  TerrainGeneratorDef,
} from './terrain-def';
import {
  compileContinentalGenerator,
  compileCraterFieldGenerator,
  compileRidgedFractalGenerator,
} from './terrain-generators';
import {
  assertFinite,
  assertNoiseParameters,
  compileMask,
  fractalNoise3d,
  ICompiledGenerator,
} from './terrain-noise';
import {
  IBiomeSample,
  ISurfaceSample,
  ISurfaceSampler,
} from './surface-sampler';

const NO_TERRAIN_ELEVATION_M = 0;
/** Below this raw mask-weight total, all weight falls to the first biome. */
const BIOME_WEIGHT_FALLBACK_THRESHOLD = 1e-6;
/** Sentinel dominant-biome index for a biome-less body in the batch path,
 * where `-1` cannot be represented in a `Uint16Array`. */
const NO_BIOME_BATCH_INDEX = 0xffff;

interface ICompiledLocalFlattenCircle {
  kind: 'circle';
  directionBodyFixed: Vec3d;
  radiusM: number;
  blendRadiusM: number;
  elevationM: number;
}

interface ICompiledLocalFlattenRect {
  kind: 'rect';
  directionBodyFixed: Vec3d;
  forwardBodyFixed: Vec3d;
  rightBodyFixed: Vec3d;
  halfLengthM: number;
  halfWidthM: number;
  blendRadiusM: number;
  elevationM: number;
}

type ICompiledLocalFlatten =
  | ICompiledLocalFlattenCircle
  | ICompiledLocalFlattenRect;

function compileFractalNoiseGenerator(
  definition: IFractalNoiseTerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  assertNoiseParameters(definition);
  assertFinite('amplitudeM', definition.amplitudeM);
  if (definition.amplitudeM < 0) {
    throw new RangeError('Terrain amplitudeM cannot be negative.');
  }
  const generatorSeed = seed + (definition.seedOffset ?? 0);
  const mask = definition.mask ? compileMask(definition.mask, seed) : undefined;
  return {
    sample: (x, y, z) => {
      const elevationM =
        fractalNoise3d(x, y, z, definition, generatorSeed) *
        definition.amplitudeM;
      return elevationM * (mask?.sample(x, y, z) ?? 1);
    },
  };
}

function compileGeneratorDef(
  definition: TerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  switch (definition.kind) {
    case 'fractal-noise-3d':
      return compileFractalNoiseGenerator(definition, seed);
    case 'ridged-fractal-3d':
      return compileRidgedFractalGenerator(definition, seed);
    case 'continental-3d':
      return compileContinentalGenerator(definition, seed);
    case 'crater-field-3d':
      return compileCraterFieldGenerator(definition, seed);
  }
}

/** Sums one def's generator stack into a single layer, as the spec requires. */
function compileGeneratorStack(
  generators: readonly TerrainGeneratorDef[],
  seed: number,
): ICompiledGenerator {
  const compiled = generators.map((generator) =>
    compileGeneratorDef(generator, seed),
  );
  return {
    sample: (x, y, z) => {
      let elevationM = 0;
      for (const generator of compiled) elevationM += generator.sample(x, y, z);
      return elevationM;
    },
  };
}

function validateBiomes(biomes: readonly ITerrainBiomeDef[] | undefined): void {
  if (!biomes) return;
  const seenIds = new Set<string>();
  for (const biome of biomes) {
    if (biome.id.length === 0) {
      throw new RangeError('Biome id must be non-empty.');
    }
    if (seenIds.has(biome.id)) {
      throw new RangeError(`Duplicate biome id: ${biome.id}`);
    }
    seenIds.add(biome.id);
  }
}

function assertLocalFlattenCommon(
  definition: ILocalFlattenTerrainModifierDef,
  terrain: ITerrainDef,
): void {
  assertFinite('localFlatten blendRadiusM', definition.blendRadiusM);
  assertFinite('localFlatten elevationM', definition.elevationM);
  if (definition.blendRadiusM <= 0) {
    throw new RangeError(
      'localFlatten blendRadiusM must be greater than zero.',
    );
  }
  if (
    definition.elevationM < terrain.minElevationM ||
    definition.elevationM > terrain.maxElevationM
  ) {
    throw new RangeError(
      'localFlatten elevationM must be within the terrain elevation bounds.',
    );
  }
}

function compileLocalFlattenCircle(
  definition: ILocalFlattenCircleModifierDef,
  terrain: ITerrainDef,
): ICompiledLocalFlattenCircle {
  assertLocalFlattenCommon(definition, terrain);
  assertFinite('localFlatten radiusM', definition.radiusM);
  if (definition.radiusM <= 0) {
    throw new RangeError('localFlatten radiusM must be greater than zero.');
  }
  return {
    kind: 'circle',
    directionBodyFixed: normalizedComponents(definition.directionBodyFixed),
    radiusM: definition.radiusM,
    blendRadiusM: definition.blendRadiusM,
    elevationM: definition.elevationM,
  };
}

function compileLocalFlattenRect(
  definition: ILocalFlattenRectModifierDef,
  terrain: ITerrainDef,
): ICompiledLocalFlattenRect {
  assertLocalFlattenCommon(definition, terrain);
  assertFinite('localFlatten halfLengthM', definition.halfLengthM);
  assertFinite('localFlatten halfWidthM', definition.halfWidthM);
  if (definition.halfLengthM <= 0) {
    throw new RangeError('localFlatten halfLengthM must be greater than zero.');
  }
  if (definition.halfWidthM <= 0) {
    throw new RangeError('localFlatten halfWidthM must be greater than zero.');
  }
  const up = normalizedComponents(definition.directionBodyFixed);
  const rawForward = normalizedComponents(definition.forwardBodyFixed);
  const tangentForward = vec3Sub(
    rawForward,
    vec3Scale(up, vec3Dot(rawForward, up)),
  );
  const tangentForwardLength = vec3Length(tangentForward);
  if (tangentForwardLength < 1e-9) {
    throw new RangeError(
      'localFlatten forwardBodyFixed must not be parallel to directionBodyFixed.',
    );
  }
  const forward = vec3Normalize(tangentForward);
  const right = vec3Cross(up, forward);
  return {
    kind: 'rect',
    directionBodyFixed: up,
    forwardBodyFixed: forward,
    rightBodyFixed: right,
    halfLengthM: definition.halfLengthM,
    halfWidthM: definition.halfWidthM,
    blendRadiusM: definition.blendRadiusM,
    elevationM: definition.elevationM,
  };
}

function compileLocalFlatten(
  definition: ILocalFlattenTerrainModifierDef,
  terrain: ITerrainDef,
): ICompiledLocalFlatten {
  switch (definition.kind) {
    case 'circle':
      return compileLocalFlattenCircle(definition, terrain);
    case 'rect':
      return compileLocalFlattenRect(definition, terrain);
  }
}

function validateTerrain(definition: ITerrainDef): void {
  assertFinite('terrain seed', definition.seed);
  assertFinite('minElevationM', definition.minElevationM);
  assertFinite('maxElevationM', definition.maxElevationM);
  if (definition.minElevationM > definition.maxElevationM) {
    throw new RangeError('minElevationM cannot exceed maxElevationM.');
  }
  validateBiomes(definition.biomes);
}

function normalizedComponents(direction: Vec3d): Vec3d {
  const [x, y, z] = direction;
  if (![x, y, z].every(Number.isFinite)) {
    throw new RangeError('Surface direction components must be finite.');
  }
  const length = Math.hypot(x, y, z);
  if (length === 0) {
    throw new RangeError('Surface direction must be non-zero.');
  }
  return [x / length, y / length, z / length];
}

interface ICompiledBiome {
  mask: ICompiledGenerator;
  layer: ICompiledGenerator;
}

/** Raw-mask-weighted, normalized biome weights and their argmax index. */
function computeBiomeWeights(
  biomes: readonly ICompiledBiome[],
  x: number,
  y: number,
  z: number,
): { weights: number[]; dominantIndex: number } {
  if (biomes.length === 0) return { weights: [], dominantIndex: -1 };

  const rawWeights = biomes.map((biome) => biome.mask.sample(x, y, z));
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const weights =
    total < BIOME_WEIGHT_FALLBACK_THRESHOLD
      ? rawWeights.map((_, index) => (index === 0 ? 1 : 0))
      : rawWeights.map((weight) => weight / total);

  let dominantIndex = 0;
  for (let index = 1; index < weights.length; index += 1) {
    if (weights[index] > weights[dominantIndex]) dominantIndex = index;
  }
  return { weights, dominantIndex };
}

/** Compiles a body's serializable terrain stack for repeated scalar or batch use. */
export function createSurfaceSampler(body: ICelestialBody): ISurfaceSampler {
  const terrain = body.terrain;
  if (!terrain) {
    return createCompiledSampler(
      compileGeneratorStack([], 0),
      [],
      [],
      body.radiusM,
      NO_TERRAIN_ELEVATION_M,
      NO_TERRAIN_ELEVATION_M,
    );
  }
  validateTerrain(terrain);
  const globalLayer = compileGeneratorStack(terrain.generators, terrain.seed);
  const compiledBiomes: ICompiledBiome[] = (terrain.biomes ?? []).map(
    (biome) => ({
      mask: compileMask(biome.mask, terrain.seed),
      layer: compileGeneratorStack(biome.generators, terrain.seed),
    }),
  );
  const localFlatten = (terrain.localFlatten ?? []).map((definition) =>
    compileLocalFlatten(definition, terrain),
  );
  return createCompiledSampler(
    globalLayer,
    compiledBiomes,
    localFlatten,
    body.radiusM,
    terrain.minElevationM,
    terrain.maxElevationM,
  );
}

/**
 * Distance, in meters, from `[x, y, z]` to the nearest edge of a compiled
 * flatten shape's exactly-flat interior — zero (or negative) inside it.
 * Circle: exact great-circle distance minus the radius. Rect: Euclidean
 * distance to the box in the local tangent plane at `directionBodyFixed`,
 * a chord-for-arc approximation that's accurate for footprint-scale shapes
 * (error is negligible relative to a planet's radius).
 */
function localFlattenExcessM(
  flatten: ICompiledLocalFlatten,
  x: number,
  y: number,
  z: number,
  bodyRadiusM: number,
): number {
  if (flatten.kind === 'circle') {
    const dot = Math.max(
      -1,
      Math.min(
        1,
        x * flatten.directionBodyFixed[0] +
          y * flatten.directionBodyFixed[1] +
          z * flatten.directionBodyFixed[2],
      ),
    );
    return Math.acos(dot) * bodyRadiusM - flatten.radiusM;
  }
  const dx = (x - flatten.directionBodyFixed[0]) * bodyRadiusM;
  const dy = (y - flatten.directionBodyFixed[1]) * bodyRadiusM;
  const dz = (z - flatten.directionBodyFixed[2]) * bodyRadiusM;
  const forwardM =
    dx * flatten.forwardBodyFixed[0] +
    dy * flatten.forwardBodyFixed[1] +
    dz * flatten.forwardBodyFixed[2];
  const rightM =
    dx * flatten.rightBodyFixed[0] +
    dy * flatten.rightBodyFixed[1] +
    dz * flatten.rightBodyFixed[2];
  const excessForwardM = Math.max(0, Math.abs(forwardM) - flatten.halfLengthM);
  const excessRightM = Math.max(0, Math.abs(rightM) - flatten.halfWidthM);
  return Math.hypot(excessForwardM, excessRightM);
}

function createCompiledSampler(
  globalLayer: ICompiledGenerator,
  biomes: readonly ICompiledBiome[],
  localFlatten: readonly ICompiledLocalFlatten[],
  bodyRadiusM: number,
  minElevationM: number,
  maxElevationM: number,
): ISurfaceSampler {
  const sampleElevation = (direction: Vec3d): number => {
    const [x, y, z] = normalizedComponents(direction);
    let elevationM = globalLayer.sample(x, y, z);
    if (biomes.length > 0) {
      const { weights } = computeBiomeWeights(biomes, x, y, z);
      for (let index = 0; index < biomes.length; index += 1) {
        if (weights[index] === 0) continue;
        elevationM += weights[index] * biomes[index].layer.sample(x, y, z);
      }
    }
    elevationM = Math.max(minElevationM, Math.min(maxElevationM, elevationM));
    for (const flatten of localFlatten) {
      const excessM = localFlattenExcessM(flatten, x, y, z, bodyRadiusM);
      if (excessM <= 0) {
        elevationM = flatten.elevationM;
        continue;
      }
      if (excessM >= flatten.blendRadiusM) continue;
      const blendT = excessM / flatten.blendRadiusM;
      const generatedWeight = blendT * blendT * (3 - 2 * blendT);
      elevationM =
        flatten.elevationM * (1 - generatedWeight) +
        elevationM * generatedWeight;
    }
    return elevationM;
  };

  const sampleBiomeAt = (direction: Vec3d): IBiomeSample => {
    const [x, y, z] = normalizedComponents(direction);
    const { weights, dominantIndex } = computeBiomeWeights(biomes, x, y, z);
    return { dominantBiomeIndex: dominantIndex, weights };
  };

  return {
    minElevationM,
    maxElevationM,
    sample: (direction) => ({ elevationM: sampleElevation(direction) }),
    sampleBatch: (directions, elevationsM) => {
      if (directions.length % 3 !== 0) {
        throw new RangeError(
          'Packed surface directions must contain xyz triples.',
        );
      }
      const sampleCount = directions.length / 3;
      const output = elevationsM ?? new Float64Array(sampleCount);
      if (output.length !== sampleCount) {
        throw new RangeError(
          'Surface elevation output length must equal direction count.',
        );
      }
      for (let index = 0; index < sampleCount; index += 1) {
        const offset = index * 3;
        output[index] = sampleElevation([
          directions[offset],
          directions[offset + 1],
          directions[offset + 2],
        ]);
      }
      return output;
    },
    sampleBiome: sampleBiomeAt,
    sampleDominantBiomeBatch: (directions, dominantBiomeIndices) => {
      if (directions.length % 3 !== 0) {
        throw new RangeError(
          'Packed surface directions must contain xyz triples.',
        );
      }
      const sampleCount = directions.length / 3;
      const output = dominantBiomeIndices ?? new Uint16Array(sampleCount);
      if (output.length !== sampleCount) {
        throw new RangeError(
          'Dominant biome output length must equal direction count.',
        );
      }
      for (let index = 0; index < sampleCount; index += 1) {
        const offset = index * 3;
        const [x, y, z] = normalizedComponents([
          directions[offset],
          directions[offset + 1],
          directions[offset + 2],
        ]);
        const { dominantIndex } = computeBiomeWeights(biomes, x, y, z);
        output[index] =
          dominantIndex < 0 ? NO_BIOME_BATCH_INDEX : dominantIndex;
      }
      return output;
    },
  };
}

/** Convenience query for one-off altimeter and landing checks. */
export function sampleSurface(
  body: ICelestialBody,
  bodyFixedDirection: Vec3d,
): ISurfaceSample {
  return createSurfaceSampler(body).sample(bodyFixedDirection);
}

/** Returns datum radius plus the shared surface elevation at a direction. */
export function surfaceRadiusM(
  body: ICelestialBody,
  bodyFixedDirection: Vec3d,
): number {
  return body.radiusM + sampleSurface(body, bodyFixedDirection).elevationM;
}

/** Golden-angle increment for an even, deterministic Fibonacci-sphere sweep. */
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

/**
 * Dev-time data-quality signal, not a contract: the fraction of a
 * deterministic direction sweep whose elevation lands exactly on the
 * authored `minElevationM`/`maxElevationM` clamp bound. Heavy saturation
 * means the authored bounds are too tight for what the generators actually
 * produce, distorting the terrain rather than merely capping rare extremes.
 */
export function estimateTerrainElevationSaturation(
  body: ICelestialBody,
  sampleCount: number,
): number {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError(
      'estimateTerrainElevationSaturation sampleCount must be a positive integer.',
    );
  }
  const sampler = createSurfaceSampler(body);
  let saturatedCount = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const t = (index + 0.5) / sampleCount;
    const inclination = Math.acos(1 - 2 * t);
    const azimuth = GOLDEN_ANGLE_RAD * index;
    const direction: Vec3d = [
      Math.sin(inclination) * Math.cos(azimuth),
      Math.sin(inclination) * Math.sin(azimuth),
      Math.cos(inclination),
    ];
    const elevationM = sampler.sample(direction).elevationM;
    if (
      elevationM <= sampler.minElevationM ||
      elevationM >= sampler.maxElevationM
    ) {
      saturatedCount += 1;
    }
  }
  return saturatedCount / sampleCount;
}

/** Analytic altitude above the shared terrain surface, without a raycast. */
export function altitudeAboveTerrainM(
  body: ICelestialBody,
  bodyFixedPositionM: Vec3d,
): number {
  const radiusM = vec3Length(bodyFixedPositionM);
  return radiusM - surfaceRadiusM(body, bodyFixedPositionM);
}
