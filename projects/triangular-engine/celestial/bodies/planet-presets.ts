import { ICelestialBody, muForSurfaceGravity } from './celestial-body';
import { ITerrainBiomeDef, ITerrainDef } from '../surfaces/terrain-def';
import { HOME_PLANET, SUN } from './stock-bodies';

// ============================================================================
// 1. ALPINE / MOUNTAINOUS WORLD (Montis)
// ============================================================================

const ALPINE_PLANET_RADIUS_M = 600_000;
const ALPINE_PLANET_MU_M3_PER_S2 = muForSurfaceGravity(
  ALPINE_PLANET_RADIUS_M,
  9.81,
);

const ALPINE_BIOMES: ITerrainBiomeDef[] = [
  {
    id: 'alpine-highlands',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.55,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 220,
      lowerThreshold: -0.06,
      upperThreshold: 0.06,
    },
    generators: [
      {
        kind: 'ridged-fractal-3d',
        amplitudeM: 11_500,
        frequency: 6.0,
        octaves: 6,
        lacunarity: 2.1,
        persistence: 0.52,
        ridgeExponent: 3.8,
        seedOffset: 230,
      },
    ],
    visual: {
      colorRgb: [0.32, 0.34, 0.38],
      highColorRgb: [0.98, 0.98, 1.0],
    },
  },
  {
    id: 'foothills-valleys',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.55,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 720,
      lowerThreshold: -0.06,
      upperThreshold: 0.06,
    },
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 450,
        frequency: 14,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 730,
      },
    ],
    visual: {
      colorRgb: [0.18, 0.38, 0.2],
      highColorRgb: [0.45, 0.48, 0.35],
    },
  },
];

const ALPINE_TERRAIN: ITerrainDef = {
  seed: 0xa191_2026,
  minElevationM: -6_000,
  maxElevationM: 16_000,
  generators: [
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 4_500,
      frequency: 0.75,
      octaves: 4,
      lacunarity: 2,
      persistence: 0.5,
    },
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 350,
      frequency: 110,
      octaves: 4,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 920,
    },
  ],
  biomes: ALPINE_BIOMES,
  visual: {
    colorRgb: [0.18, 0.38, 0.2],
    highColorRgb: [0.98, 0.98, 1.0],
  },
  ocean: {
    seaLevelM: 0,
    shallowColorRgb: [0.12, 0.55, 0.65],
    deepColorRgb: [0.03, 0.12, 0.28],
    depthFalloffM: 1_200,
  },
};

export const ALPINE_PLANET: ICelestialBody = {
  id: 'alpine-planet',
  kind: 'planet',
  radiusM: ALPINE_PLANET_RADIUS_M,
  muM3PerS2: ALPINE_PLANET_MU_M3_PER_S2,
  parentBodyId: SUN.id,
  orbit: {
    semiMajorAxisM: 14_800_000_000,
    eccentricity: 0.01,
    inclinationRad: 0.02,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochUt: 0,
  },
  rotationPeriodS: 86_400,
  axialTiltRad: (24.0 * Math.PI) / 180,
  windScaleMPerS: 20,
  atmosphere: {
    seaLevelDensityKgM3: 1.225,
    scaleHeightM: 4_500,
    topAltitudeM: 65_000,
    visual: {
      colorRgb: [0.25, 0.65, 0.95],
      horizonColorRgb: [0.85, 0.6, 0.45],
      intensity: 1.0,
    },
  },
  terrain: ALPINE_TERRAIN,
};

// ============================================================================
// 2. CANYON / RIFT WORLD (Valles)
// ============================================================================

const CANYON_PLANET_RADIUS_M = 480_000;
const CANYON_PLANET_MU_M3_PER_S2 = muForSurfaceGravity(
  CANYON_PLANET_RADIUS_M,
  6.5,
);

const CANYON_BIOMES: ITerrainBiomeDef[] = [
  {
    id: 'rift-canyons',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.6,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 310,
      lowerThreshold: -0.08,
      upperThreshold: 0.08,
    },
    generators: [
      {
        kind: 'ridged-fractal-3d',
        amplitudeM: 9_500,
        frequency: 3.8,
        octaves: 6,
        lacunarity: 2.1,
        persistence: 0.55,
        ridgeExponent: 4.5,
        seedOffset: 320,
      },
    ],
    visual: {
      colorRgb: [0.58, 0.26, 0.16],
      highColorRgb: [0.82, 0.62, 0.4],
    },
  },
  {
    id: 'high-mesas',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.6,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 810,
      lowerThreshold: -0.08,
      upperThreshold: 0.08,
    },
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 4_500,
        frequency: 2.2,
        octaves: 4,
        lacunarity: 2.2,
        persistence: 0.5,
        seedOffset: 820,
      },
    ],
    visual: {
      colorRgb: [0.72, 0.48, 0.28],
      highColorRgb: [0.9, 0.82, 0.65],
    },
  },
];

const CANYON_TERRAIN: ITerrainDef = {
  seed: 0xca40_2026,
  minElevationM: -8_500,
  maxElevationM: 11_000,
  generators: [
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 4_800,
      frequency: 0.8,
      octaves: 4,
      lacunarity: 2,
      persistence: 0.5,
    },
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 350,
      frequency: 90,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 940,
    },
  ],
  biomes: CANYON_BIOMES,
  visual: {
    colorRgb: [0.65, 0.35, 0.22],
    highColorRgb: [0.88, 0.72, 0.55],
  },
  // Arid dry world with no global oceans
};

export const CANYON_PLANET: ICelestialBody = {
  id: 'canyon-planet',
  kind: 'planet',
  radiusM: CANYON_PLANET_RADIUS_M,
  muM3PerS2: CANYON_PLANET_MU_M3_PER_S2,
  parentBodyId: SUN.id,
  orbit: {
    semiMajorAxisM: 19_500_000_000,
    eccentricity: 0.04,
    inclinationRad: 0.03,
    longitudeOfAscendingNodeRad: 0.5,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0.8,
    epochUt: 0,
  },
  rotationPeriodS: 92_000,
  axialTiltRad: (15.0 * Math.PI) / 180,
  windScaleMPerS: 25,
  atmosphere: {
    seaLevelDensityKgM3: 0.65,
    scaleHeightM: 6_000,
    topAltitudeM: 45_000,
    visual: {
      colorRgb: [0.85, 0.55, 0.35],
      horizonColorRgb: [0.95, 0.4, 0.2],
      intensity: 0.85,
    },
  },
  terrain: CANYON_TERRAIN,
};

// ============================================================================
// 3. ARCHIPELAGO / OCEANIC WORLD (Oceania)
// ============================================================================

const ARCHIPELAGO_PLANET_RADIUS_M = 520_000;
const ARCHIPELAGO_PLANET_MU_M3_PER_S2 = muForSurfaceGravity(
  ARCHIPELAGO_PLANET_RADIUS_M,
  8.8,
);

const ARCHIPELAGO_BIOMES: ITerrainBiomeDef[] = [
  {
    id: 'island-chains',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.7,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 410,
      lowerThreshold: -0.04,
      upperThreshold: 0.08,
    },
    generators: [
      {
        kind: 'ridged-fractal-3d',
        amplitudeM: 4_200,
        frequency: 9.0,
        octaves: 5,
        lacunarity: 2,
        persistence: 0.5,
        ridgeExponent: 3.2,
        seedOffset: 420,
      },
    ],
    visual: {
      colorRgb: [0.15, 0.6, 0.22],
      highColorRgb: [0.45, 0.42, 0.38],
    },
  },
  {
    id: 'coral-atolls',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.7,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 910,
      lowerThreshold: -0.04,
      upperThreshold: 0.08,
    },
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 2_200,
        frequency: 16.0,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 930,
      },
    ],
    visual: {
      colorRgb: [0.92, 0.9, 0.8],
      highColorRgb: [0.2, 0.65, 0.3],
    },
  },
];

const ARCHIPELAGO_TERRAIN: ITerrainDef = {
  seed: 0x0cea_2026,
  minElevationM: -5_500,
  maxElevationM: 4_000,
  generators: [
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 3_500,
      frequency: 0.65,
      octaves: 4,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 100,
    },
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 180,
      frequency: 120,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 960,
    },
  ],
  biomes: ARCHIPELAGO_BIOMES,
  visual: {
    colorRgb: [0.18, 0.58, 0.22],
    highColorRgb: [0.92, 0.9, 0.8],
  },
  ocean: {
    seaLevelM: 0,
    shallowColorRgb: [0.06, 0.68, 0.75],
    deepColorRgb: [0.01, 0.04, 0.18],
    depthFalloffM: 800,
  },
};

export const ARCHIPELAGO_PLANET: ICelestialBody = {
  id: 'archipelago-planet',
  kind: 'planet',
  radiusM: ARCHIPELAGO_PLANET_RADIUS_M,
  muM3PerS2: ARCHIPELAGO_PLANET_MU_M3_PER_S2,
  parentBodyId: SUN.id,
  orbit: {
    semiMajorAxisM: 11_200_000_000,
    eccentricity: 0.01,
    inclinationRad: 0.01,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 2.1,
    epochUt: 0,
  },
  rotationPeriodS: 78_000,
  axialTiltRad: (12.0 * Math.PI) / 180,
  windScaleMPerS: 18,
  atmosphere: {
    seaLevelDensityKgM3: 1.35,
    scaleHeightM: 5_200,
    topAltitudeM: 68_000,
    visual: {
      colorRgb: [0.2, 0.65, 0.92],
      horizonColorRgb: [0.9, 0.55, 0.3],
      intensity: 1.1,
    },
  },
  terrain: ARCHIPELAGO_TERRAIN,
};

// ============================================================================
// 4. BARREN CRATERED MOON (Luna)
// ============================================================================

const CRATERED_MOON_RADIUS_M = 200_000;
const CRATERED_MOON_MU_M3_PER_S2 = muForSurfaceGravity(
  CRATERED_MOON_RADIUS_M,
  1.63,
);

const CRATERED_MOON_BIOMES: ITerrainBiomeDef[] = [
  {
    id: 'cratered-highlands',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.5,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 150,
      lowerThreshold: -0.05,
      upperThreshold: 0.05,
    },
    generators: [
      {
        kind: 'crater-field-3d',
        cellFrequency: 16,
        craterProbability: 0.8,
        minRadiusCells: 0.1,
        maxRadiusCells: 0.45,
        depthM: 800,
        rimHeightM: 200,
        seedOffset: 160,
      },
    ],
    visual: {
      colorRgb: [0.6, 0.62, 0.68],
      highColorRgb: [0.82, 0.85, 0.9],
    },
  },
  {
    id: 'basaltic-maria',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 0.5,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 650,
      lowerThreshold: -0.05,
      upperThreshold: 0.05,
    },
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 120,
        frequency: 8,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 660,
      },
    ],
    visual: {
      colorRgb: [0.18, 0.19, 0.21],
      highColorRgb: [0.32, 0.33, 0.36],
    },
  },
];

const CRATERED_MOON_TERRAIN: ITerrainDef = {
  seed: 0x100a_2026,
  minElevationM: -4_500,
  maxElevationM: 6_000,
  generators: [
    {
      kind: 'crater-field-3d',
      cellFrequency: 4,
      craterProbability: 0.5,
      minRadiusCells: 0.15,
      maxRadiusCells: 0.45,
      depthM: 2_200,
      rimHeightM: 500,
      seedOffset: 10,
    },
    {
      kind: 'crater-field-3d',
      cellFrequency: 12,
      craterProbability: 0.65,
      minRadiusCells: 0.12,
      maxRadiusCells: 0.42,
      depthM: 950,
      rimHeightM: 220,
      seedOffset: 20,
    },
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 350,
      frequency: 60,
      octaves: 4,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 970,
    },
  ],
  biomes: CRATERED_MOON_BIOMES,
  visual: {
    colorRgb: [0.34, 0.36, 0.4],
    highColorRgb: [0.8, 0.82, 0.88],
  },
};

export const CRATERED_MOON: ICelestialBody = {
  id: 'cratered-moon',
  kind: 'moon',
  radiusM: CRATERED_MOON_RADIUS_M,
  muM3PerS2: CRATERED_MOON_MU_M3_PER_S2,
  parentBodyId: HOME_PLANET.id,
  orbit: {
    semiMajorAxisM: 16_000_000,
    eccentricity: 0.02,
    inclinationRad: 0.05,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochUt: 0,
  },
  rotationPeriodS: 138_000,
  terrain: CRATERED_MOON_TERRAIN,
};

// ============================================================================
// ALL PRESETS REGISTRY
// ============================================================================

export const PLANET_PRESETS: readonly ICelestialBody[] = [
  HOME_PLANET,
  ALPINE_PLANET,
  CANYON_PLANET,
  ARCHIPELAGO_PLANET,
  CRATERED_MOON,
];
