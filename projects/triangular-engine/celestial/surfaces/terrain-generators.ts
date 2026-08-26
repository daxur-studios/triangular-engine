/**
 * Compilers for the generator kinds beyond the original `fractal-noise-3d`.
 * Internal to `celestial` — not re-exported from `public-api.ts`. Only the
 * def types (`terrain-def.ts`) and the sampler query surface
 * (`surface-sampler.ts`) are public; `surface-query.ts` is the sole caller
 * of these compilers.
 */
import {
  ICanyonTerrainGeneratorDef,
  IContinentalTerrainGeneratorDef,
  ICraterFieldTerrainGeneratorDef,
  IDuneTerrainGeneratorDef,
  IRidgedFractalTerrainGeneratorDef,
  ITerraceFractalTerrainGeneratorDef,
} from './terrain-def';
import {
  assertDomainWarpParameters,
  assertFinite,
  assertNoiseParameters,
  canyonDrop,
  compileMask,
  domainWarp3d,
  duneWave,
  fractalNoise3d,
  hashLattice,
  ICompiledGenerator,
  ridgedFractalNoise3d,
  smoothstep,
  terraceStep,
} from './terrain-noise';

export function compileContinentalGenerator(
  definition: IContinentalTerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  assertNoiseParameters(definition);
  assertFinite('seaLevelThreshold', definition.seaLevelThreshold);
  assertFinite('transitionWidth', definition.transitionWidth);
  assertFinite('oceanDepthM', definition.oceanDepthM);
  assertFinite('landHeightM', definition.landHeightM);
  if (definition.seaLevelThreshold <= -1 || definition.seaLevelThreshold >= 1) {
    throw new RangeError('Continental seaLevelThreshold must be in (-1, 1).');
  }
  if (definition.transitionWidth <= 0) {
    throw new RangeError(
      'Continental transitionWidth must be greater than zero.',
    );
  }
  if (definition.oceanDepthM <= 0 || definition.landHeightM <= 0) {
    throw new RangeError(
      'Continental oceanDepthM and landHeightM must be greater than zero.',
    );
  }
  if (definition.coastVariation) {
    assertNoiseParameters(definition.coastVariation);
    assertFinite(
      'continental coastVariation strength',
      definition.coastVariation.strength,
    );
    if (
      definition.coastVariation.strength < 0 ||
      definition.coastVariation.strength >= 1
    ) {
      throw new RangeError(
        'Continental coastVariation strength must be in [0, 1).',
      );
    }
  }
  if (definition.warp) {
    assertDomainWarpParameters(definition.warp);
  }

  const generatorSeed = seed + (definition.seedOffset ?? 0);
  const coastVariationSeed = definition.coastVariation
    ? seed + (definition.coastVariation.seedOffset ?? 10_000)
    : 0;
  const mask = definition.mask ? compileMask(definition.mask, seed) : undefined;
  return {
    sample: (x, y, z) => {
      let sx = x;
      let sy = y;
      let sz = z;
      if (definition.warp) {
        [sx, sy, sz] = domainWarp3d(x, y, z, definition.warp, generatorSeed);
      }
      const continentalness = fractalNoise3d(
        sx,
        sy,
        sz,
        definition,
        generatorSeed,
      );
      const coastVariation = definition.coastVariation
        ? fractalNoise3d(
            sx,
            sy,
            sz,
            definition.coastVariation,
            coastVariationSeed,
          )
        : 0;
      const localTransitionWidth =
        definition.transitionWidth *
        (1 + coastVariation * (definition.coastVariation?.strength ?? 0));
      const signedDistance =
        (continentalness - definition.seaLevelThreshold) / localTransitionWidth;
      const shapedDistance = smoothstep(
        0,
        1,
        Math.min(1, Math.abs(signedDistance)),
      );
      const elevationM =
        signedDistance < 0
          ? -definition.oceanDepthM * shapedDistance
          : definition.landHeightM * shapedDistance;
      return elevationM * (mask?.sample(x, y, z) ?? 1);
    },
  };
}

export function compileRidgedFractalGenerator(
  definition: IRidgedFractalTerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  assertNoiseParameters(definition);
  assertFinite('amplitudeM', definition.amplitudeM);
  if (definition.amplitudeM < 0) {
    throw new RangeError('Terrain amplitudeM cannot be negative.');
  }
  assertFinite('ridgeExponent', definition.ridgeExponent);
  if (definition.ridgeExponent < 1) {
    throw new RangeError('Terrain ridgeExponent must be >= 1.');
  }
  if (definition.warp) {
    assertDomainWarpParameters(definition.warp);
  }
  const generatorSeed = seed + (definition.seedOffset ?? 0);
  const mask = definition.mask ? compileMask(definition.mask, seed) : undefined;
  return {
    sample: (x, y, z) => {
      let sx = x;
      let sy = y;
      let sz = z;
      if (definition.warp) {
        [sx, sy, sz] = domainWarp3d(x, y, z, definition.warp, generatorSeed);
      }
      const elevationM =
        ridgedFractalNoise3d(sx, sy, sz, definition, generatorSeed) *
        definition.amplitudeM;
      return elevationM * (mask?.sample(x, y, z) ?? 1);
    },
  };
}

export function compileTerraceFractalGenerator(
  definition: ITerraceFractalTerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  assertNoiseParameters(definition);
  assertFinite('amplitudeM', definition.amplitudeM);
  if (definition.amplitudeM < 0) {
    throw new RangeError('Terrain amplitudeM cannot be negative.');
  }
  if (
    !Number.isInteger(definition.terraceCount) ||
    definition.terraceCount < 1
  ) {
    throw new RangeError('Terrace count must be a positive integer.');
  }
  if (definition.stepSharpness !== undefined) {
    assertFinite('stepSharpness', definition.stepSharpness);
    if (definition.stepSharpness < 0 || definition.stepSharpness > 1) {
      throw new RangeError('Terrace stepSharpness must be in [0, 1].');
    }
  }
  if (definition.warp) {
    assertDomainWarpParameters(definition.warp);
  }
  const generatorSeed = seed + (definition.seedOffset ?? 0);
  const mask = definition.mask ? compileMask(definition.mask, seed) : undefined;
  const sharpness = definition.stepSharpness ?? 0.85;
  return {
    sample: (x, y, z) => {
      let sx = x;
      let sy = y;
      let sz = z;
      if (definition.warp) {
        [sx, sy, sz] = domainWarp3d(x, y, z, definition.warp, generatorSeed);
      }
      const rawNoise =
        (fractalNoise3d(sx, sy, sz, definition, generatorSeed) + 1) * 0.5;
      const terraced = terraceStep(
        rawNoise,
        definition.terraceCount,
        sharpness,
      );
      const elevationM = terraced * definition.amplitudeM;
      return elevationM * (mask?.sample(x, y, z) ?? 1);
    },
  };
}

export function compileCanyonGenerator(
  definition: ICanyonTerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  assertNoiseParameters(definition);
  assertFinite('depthM', definition.depthM);
  if (definition.depthM < 0) {
    throw new RangeError('Canyon depthM cannot be negative.');
  }
  if (definition.canyonWidth !== undefined) {
    assertFinite('canyonWidth', definition.canyonWidth);
    if (definition.canyonWidth <= 0 || definition.canyonWidth > 1) {
      throw new RangeError('Canyon canyonWidth must be in (0, 1].');
    }
  }
  if (definition.wallSteepness !== undefined) {
    assertFinite('wallSteepness', definition.wallSteepness);
    if (definition.wallSteepness < 1) {
      throw new RangeError('Canyon wallSteepness must be >= 1.');
    }
  }
  if (definition.warp) {
    assertDomainWarpParameters(definition.warp);
  }
  const generatorSeed = seed + (definition.seedOffset ?? 0);
  const mask = definition.mask ? compileMask(definition.mask, seed) : undefined;
  const width = definition.canyonWidth ?? 0.35;
  const steepness = definition.wallSteepness ?? 3.0;
  return {
    sample: (x, y, z) => {
      let sx = x;
      let sy = y;
      let sz = z;
      if (definition.warp) {
        [sx, sy, sz] = domainWarp3d(x, y, z, definition.warp, generatorSeed);
      }
      const ridge = ridgedFractalNoise3d(
        sx,
        sy,
        sz,
        { ...definition, ridgeExponent: 1.5 },
        generatorSeed,
      );
      const incision = canyonDrop(1 - ridge, width, steepness);
      const elevationM = -incision * definition.depthM;
      return elevationM * (mask?.sample(x, y, z) ?? 1);
    },
  };
}

export function compileDuneGenerator(
  definition: IDuneTerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  assertNoiseParameters(definition);
  assertFinite('amplitudeM', definition.amplitudeM);
  if (definition.amplitudeM < 0) {
    throw new RangeError('Dune amplitudeM cannot be negative.');
  }
  if (definition.waveAsymmetry !== undefined) {
    assertFinite('waveAsymmetry', definition.waveAsymmetry);
    if (definition.waveAsymmetry < 0 || definition.waveAsymmetry >= 1) {
      throw new RangeError('Dune waveAsymmetry must be in [0, 1).');
    }
  }
  if (definition.warp) {
    assertDomainWarpParameters(definition.warp);
  }
  const generatorSeed = seed + (definition.seedOffset ?? 0);
  const mask = definition.mask ? compileMask(definition.mask, seed) : undefined;
  const asymmetry = definition.waveAsymmetry ?? 0.6;
  const wind = definition.windDirectionBodyFixed ?? [1, 0, 0];
  const windLen = Math.hypot(...wind);
  const wx = windLen > 0 ? wind[0] / windLen : 1;
  const wy = windLen > 0 ? wind[1] / windLen : 0;
  const wz = windLen > 0 ? wind[2] / windLen : 0;

  return {
    sample: (x, y, z) => {
      let sx = x;
      let sy = y;
      let sz = z;
      if (definition.warp) {
        [sx, sy, sz] = domainWarp3d(x, y, z, definition.warp, generatorSeed);
      }
      const windCoord = (sx * wx + sy * wy + sz * wz) * definition.frequency;
      const crossModulation =
        fractalNoise3d(sx, sy, sz, definition, generatorSeed) * 0.35;
      const wave = duneWave(windCoord + crossModulation, asymmetry);
      const elevationM = wave * definition.amplitudeM;
      return elevationM * (mask?.sample(x, y, z) ?? 1);
    },
  };
}

/** Fixed hash-channel offsets for the crater field's per-cell decisions. */
const CRATER_PRESENCE_CHANNEL = 0;
const CRATER_JITTER_X_CHANNEL = 1;
const CRATER_JITTER_Y_CHANNEL = 2;
const CRATER_JITTER_Z_CHANNEL = 3;
const CRATER_RADIUS_CHANNEL = 4;
/** Outer rim radius as a multiple of the crater's own radius. */
const OUTER_RIM_RADIUS_FACTOR = 1.5;

function craterHash01(
  cellX: number,
  cellY: number,
  cellZ: number,
  seed: number,
  channel: number,
): number {
  return (hashLattice(cellX, cellY, cellZ, seed + channel) + 1) / 2;
}

/**
 * C1-continuous radial profile: parabolic bowl to `x = 1`, a raised rim shaped
 * by the quartic bump `y^2*(1-y)^2` (`y = 2(x-1)`) to `x = 1.5`, then exactly
 * zero. Value and first derivative agree at both seams (verified by hand and
 * pinned by the continuity spec) so overlapping craters never introduce a
 * crease.
 */
function craterElevationM(
  x: number,
  depthM: number,
  rimHeightM: number,
): number {
  if (x < 1) {
    const inner = 1 - x * x;
    return -depthM * inner * inner;
  }
  if (x < OUTER_RIM_RADIUS_FACTOR) {
    const y = 2 * (x - 1);
    const bump = y * y * (1 - y) * (1 - y);
    return rimHeightM * 16 * bump;
  }
  return 0;
}

export function compileCraterFieldGenerator(
  definition: ICraterFieldTerrainGeneratorDef,
  seed: number,
): ICompiledGenerator {
  assertFinite('cellFrequency', definition.cellFrequency);
  if (definition.cellFrequency <= 0) {
    throw new RangeError('Crater cellFrequency must be positive.');
  }
  assertFinite('craterProbability', definition.craterProbability);
  if (definition.craterProbability < 0 || definition.craterProbability > 1) {
    throw new RangeError('Crater craterProbability must be in [0, 1].');
  }
  assertFinite('minRadiusCells', definition.minRadiusCells);
  assertFinite('maxRadiusCells', definition.maxRadiusCells);
  if (definition.minRadiusCells <= 0 || definition.maxRadiusCells <= 0) {
    throw new RangeError('Crater radius bounds must be positive.');
  }
  if (definition.maxRadiusCells > 0.5) {
    throw new RangeError('Crater maxRadiusCells cannot exceed 0.5 cell.');
  }
  if (definition.minRadiusCells > definition.maxRadiusCells) {
    throw new RangeError('Crater minRadiusCells cannot exceed maxRadiusCells.');
  }
  assertFinite('depthM', definition.depthM);
  assertFinite('rimHeightM', definition.rimHeightM);
  if (definition.depthM < 0 || definition.rimHeightM < 0) {
    throw new RangeError('Crater depthM and rimHeightM cannot be negative.');
  }

  const generatorSeed = seed + (definition.seedOffset ?? 0);
  const {
    cellFrequency,
    craterProbability,
    minRadiusCells,
    maxRadiusCells,
    depthM,
    rimHeightM,
  } = definition;
  const mask = definition.mask ? compileMask(definition.mask, seed) : undefined;

  return {
    sample: (x, y, z) => {
      const px = x * cellFrequency;
      const py = y * cellFrequency;
      const pz = z * cellFrequency;
      const baseX = Math.floor(px);
      const baseY = Math.floor(py);
      const baseZ = Math.floor(pz);

      let elevationM = 0;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const cellX = baseX + dx;
            const cellY = baseY + dy;
            const cellZ = baseZ + dz;
            const presence = craterHash01(
              cellX,
              cellY,
              cellZ,
              generatorSeed,
              CRATER_PRESENCE_CHANNEL,
            );
            if (presence >= craterProbability) continue;

            const centerX =
              cellX +
              craterHash01(
                cellX,
                cellY,
                cellZ,
                generatorSeed,
                CRATER_JITTER_X_CHANNEL,
              );
            const centerY =
              cellY +
              craterHash01(
                cellX,
                cellY,
                cellZ,
                generatorSeed,
                CRATER_JITTER_Y_CHANNEL,
              );
            const centerZ =
              cellZ +
              craterHash01(
                cellX,
                cellY,
                cellZ,
                generatorSeed,
                CRATER_JITTER_Z_CHANNEL,
              );
            const radiusHash = craterHash01(
              cellX,
              cellY,
              cellZ,
              generatorSeed,
              CRATER_RADIUS_CHANNEL,
            );
            const radiusCells =
              minRadiusCells + radiusHash * (maxRadiusCells - minRadiusCells);

            const distanceCells = Math.hypot(
              px - centerX,
              py - centerY,
              pz - centerZ,
            );
            const unit = distanceCells / radiusCells;
            if (unit >= OUTER_RIM_RADIUS_FACTOR) continue;
            elevationM += craterElevationM(unit, depthM, rimHeightM);
          }
        }
      }
      return elevationM * (mask?.sample(x, y, z) ?? 1);
    },
  };
}
