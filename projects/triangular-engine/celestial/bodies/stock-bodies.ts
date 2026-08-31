import { ILaunchSite } from '../frames/launch-site';
import { ICelestialBody, muForSurfaceGravity } from './celestial-body';
import { createSurfaceSampler } from '../surfaces/surface-query';
import {
  ILocalFlattenTerrainModifierDef,
  ITerrainBiomeDef,
  ITerrainDef,
} from '../surfaces/terrain-def';

const HOME_PLANET_RADIUS_M = 600_000;
const HOME_PLANET_MU_M3_PER_S2 = muForSurfaceGravity(
  HOME_PLANET_RADIUS_M,
  9.81,
);
/**
 * Authored from `coastalSitesFor(HOME_PLANET)`: low-latitude for efficient
 * launches, on flat land about 1.1 km south of a compact deep-water coast.
 */
const HOME_BASE_LATITUDE_DEG = 13.382037142436814;
const HOME_BASE_LONGITUDE_DEG = -176.9920359740523;
const HOME_BASE_LATITUDE_RAD = (HOME_BASE_LATITUDE_DEG * Math.PI) / 180;
const HOME_BASE_LONGITUDE_RAD = (HOME_BASE_LONGITUDE_DEG * Math.PI) / 180;
const HOME_PAD_DIRECTION_BODY_FIXED: [number, number, number] = [
  Math.cos(HOME_BASE_LATITUDE_RAD) * Math.cos(HOME_BASE_LONGITUDE_RAD),
  Math.sin(HOME_BASE_LATITUDE_RAD),
  Math.cos(HOME_BASE_LATITUDE_RAD) * Math.sin(HOME_BASE_LONGITUDE_RAD),
];
/** Degrees inland/south of the pad, leaving separation for colliders and port space. */
const HOME_RUNWAY_LATITUDE_DEG = HOME_BASE_LATITUDE_DEG - 0.03;
const HOME_RUNWAY_LATITUDE_RAD = (HOME_RUNWAY_LATITUDE_DEG * Math.PI) / 180;
const HOME_RUNWAY_LONGITUDE_DEG = HOME_BASE_LONGITUDE_DEG;
const HOME_RUNWAY_LONGITUDE_RAD = (HOME_RUNWAY_LONGITUDE_DEG * Math.PI) / 180;
const HOME_RUNWAY_DIRECTION_BODY_FIXED: [number, number, number] = [
  Math.cos(HOME_RUNWAY_LATITUDE_RAD) * Math.cos(HOME_RUNWAY_LONGITUDE_RAD),
  Math.sin(HOME_RUNWAY_LATITUDE_RAD),
  Math.cos(HOME_RUNWAY_LATITUDE_RAD) * Math.sin(HOME_RUNWAY_LONGITUDE_RAD),
];

/**
 * Stable coastal access authored by the deterministic shoreline finder. Port
 * placement can follow the centre-to-shore direction without searching the
 * planet again at runtime.
 */
export const HOME_BASE_COASTAL_ACCESS = {
  centerDirectionBodyFixed: HOME_PAD_DIRECTION_BODY_FIXED,
  shoreDirectionBodyFixed: [
    -0.9711595957236789, 0.23305468962409132, -0.0503443271684003,
  ] as [number, number, number],
  waterDirectionBodyFixed: [
    -0.9710524870571896, 0.23354695549528773, -0.05012870394224026,
  ] as [number, number, number],
  shoreDistanceM: 1_076.1554974797072,
  waterDistanceM: 1_405,
  shallowWaterWidthM: 328.8445025202928,
} as const;

/**
 * Kerbin-scale so a low orbit is reachable in a short flight instead of a
 * real-Earth hour-plus burn: radius 600 km, `muM3PerS2` derived so surface
 * gravity (`mu / radius²`) equals the `9.81` this scene's uniform-gravity
 * predecessor (`parts-vessel-controller.component.ts`) used — same launch
 * feel, now falling off with altitude. Atmosphere follows the same
 * ballpark (sea-level density, 70 km top) that A0's "rockets work" bar
 * expects.
 */
/**
 * Two provinces blended by normalized mask weight (`computeBiomeWeights`):
 * broad rolling plains and ridged highlands, colored for the map-view baked
 * globe (`plans/planet-surface-texture.md`). Shared frequency/threshold
 * shape follows the worlds `VARIED_TERRAIN_SHOWCASE_BODY` precedent so
 * provinces read as continents, not noise-on-noise.
 */
const HOME_PLANET_CONTINENT_FIELD = {
  frequency: 0.72,
  octaves: 5,
  lacunarity: 2.1,
  persistence: 0.48,
  seaLevelThreshold: 0.25,
} as const;
const HOME_PLANET_LAND_MASK = {
  kind: 'noise-mask-3d' as const,
  frequency: HOME_PLANET_CONTINENT_FIELD.frequency,
  octaves: HOME_PLANET_CONTINENT_FIELD.octaves,
  lacunarity: HOME_PLANET_CONTINENT_FIELD.lacunarity,
  persistence: HOME_PLANET_CONTINENT_FIELD.persistence,
  lowerThreshold: HOME_PLANET_CONTINENT_FIELD.seaLevelThreshold - 0.03,
  upperThreshold: HOME_PLANET_CONTINENT_FIELD.seaLevelThreshold + 0.01,
};

const HOME_PLANET_BIOMES: ITerrainBiomeDef[] = [
  {
    id: 'alpine-ridges',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 1.2,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 500,
      lowerThreshold: 0.04,
      upperThreshold: 0.22,
    },
    generators: [
      {
        kind: 'ridged-fractal-3d',
        amplitudeM: 7_800,
        frequency: 7.0,
        octaves: 6,
        lacunarity: 2.15,
        persistence: 0.52,
        ridgeExponent: 3.2,
        seedOffset: 510,
        mask: HOME_PLANET_LAND_MASK,
      },
      {
        kind: 'ridged-fractal-3d',
        amplitudeM: 600,
        frequency: 30,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
        ridgeExponent: 2.0,
        seedOffset: 520,
        mask: HOME_PLANET_LAND_MASK,
      },
    ],
    visual: {
      colorRgb: [0.28, 0.30, 0.34],
      highColorRgb: [0.96, 0.97, 1.0],
    },
  },
  {
    id: 'rolling-hills',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 1.4,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 300,
      lowerThreshold: -0.02,
      upperThreshold: 0.20,
    },
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 95,
        frequency: 16,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 310,
        mask: HOME_PLANET_LAND_MASK,
      },
    ],
    visual: {
      colorRgb: [0.32, 0.48, 0.22],
      highColorRgb: [0.58, 0.52, 0.32],
    },
  },
  {
    id: 'tableland-plateaus',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 1.3,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 700,
      lowerThreshold: 0.06,
      upperThreshold: 0.26,
    },
    generators: [
      {
        kind: 'terrace-fractal-3d',
        amplitudeM: 900,
        frequency: 5.0,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
        terraceCount: 4,
        stepSharpness: 0.88,
        seedOffset: 710,
        mask: HOME_PLANET_LAND_MASK,
      },
    ],
    visual: {
      colorRgb: [0.55, 0.42, 0.28],
      highColorRgb: [0.78, 0.65, 0.48],
    },
  },
  {
    id: 'desert-dunes',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 1.2,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 850,
      lowerThreshold: 0.08,
      upperThreshold: 0.28,
    },
    generators: [
      {
        kind: 'dunes-3d',
        amplitudeM: 80,
        frequency: 24,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        windDirectionBodyFixed: [0.8, 0.2, 0.5],
        waveAsymmetry: 0.65,
        seedOffset: 860,
        mask: HOME_PLANET_LAND_MASK,
      },
    ],
    visual: {
      colorRgb: [0.76, 0.58, 0.32],
      highColorRgb: [0.88, 0.74, 0.48],
    },
  },
  {
    id: 'rift-canyons',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 1.3,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 950,
      lowerThreshold: 0.10,
      upperThreshold: 0.30,
    },
    generators: [
      {
        kind: 'canyon-3d',
        depthM: 700,
        frequency: 4.2,
        octaves: 5,
        lacunarity: 2,
        persistence: 0.5,
        canyonWidth: 0.30,
        wallSteepness: 3.2,
        seedOffset: 960,
        mask: HOME_PLANET_LAND_MASK,
      },
    ],
    visual: {
      colorRgb: [0.48, 0.24, 0.16],
      highColorRgb: [0.68, 0.42, 0.28],
    },
  },
  {
    id: 'lowland-meadows',
    mask: {
      kind: 'noise-mask-3d',
      frequency: 1.1,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 100,
      lowerThreshold: -0.50,
      upperThreshold: 0.02,
    },
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 14,
        frequency: 4,
        octaves: 2,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 110,
        mask: HOME_PLANET_LAND_MASK,
      },
    ],
    visual: {
      colorRgb: [0.22, 0.52, 0.18],
      highColorRgb: [0.42, 0.62, 0.28],
    },
  },
];

const HOME_PLANET_BASE_TERRAIN: ITerrainDef = {
  seed: 0x5eed_484f,
  minElevationM: -5_000,
  maxElevationM: 10_500,
  generators: [
    {
      kind: 'continental-3d',
      ...HOME_PLANET_CONTINENT_FIELD,
      transitionWidth: 0.016,
      oceanDepthM: 4_500,
      landHeightM: 160,
      coastVariation: {
        frequency: 4.5,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 1_200,
        strength: 0.85,
      },
      warp: {
        frequency: 1.2,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        strength: 0.18,
        seedOffset: 340,
      },
    },
    /** Fine ground micro-relief grain without disruptive macro slopes. */
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 2.5,
      frequency: 120,
      octaves: 3,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 950,
      mask: HOME_PLANET_LAND_MASK,
    },
  ],
  biomes: HOME_PLANET_BIOMES,
  visual: {
    colorRgb: [0.22, 0.52, 0.18],
    highColorRgb: [0.96, 0.97, 1.0],
  },
  ocean: {
    seaLevelM: 0,
    shallowColorRgb: [0.1, 0.45, 0.65],
    deepColorRgb: [0.02, 0.08, 0.25],
    depthFalloffM: 1_500,
  },
};

/** Rounded generated height keeps the authored plateau stable and serializable. */
const HOME_PAD_FLATTEN_ELEVATION_M = Math.round(
  createSurfaceSampler({
    id: 'home-planet-before-site-flatten',
    kind: 'planet',
    radiusM: HOME_PLANET_RADIUS_M,
    muM3PerS2: HOME_PLANET_MU_M3_PER_S2,
    terrain: HOME_PLANET_BASE_TERRAIN,
  }).sample(HOME_PAD_DIRECTION_BODY_FIXED).elevationM,
);
/** The runway gets its own generated-height plateau rather than floating at the pad's elevation. */
const HOME_RUNWAY_FLATTEN_ELEVATION_M = Math.round(
  createSurfaceSampler({
    id: 'home-planet-before-runway-flatten',
    kind: 'planet',
    radiusM: HOME_PLANET_RADIUS_M,
    muM3PerS2: HOME_PLANET_MU_M3_PER_S2,
    terrain: HOME_PLANET_BASE_TERRAIN,
  }).sample(HOME_RUNWAY_DIRECTION_BODY_FIXED).elevationM,
);

/**
 * The home pad/runway's plateau, expressed as the same
 * `ILocalFlattenTerrainModifierDef` shape the real base builder's grading
 * tool produces (`terrain-grading.ts#flattenAreaToLocalFlatten`) — kept out
 * of `HOME_PLANET.terrain` itself so the app can seed it as ordinary
 * `StoredBaseFlattenArea` rows for the default base
 * (`DatabaseService.seedDefaultHomeBase`) instead of baking it statically
 * into the planet definition. Still exported so anything rendering
 * `HOME_PLANET`'s terrain outside that seeded-game path (e.g. the
 * `launch-scene` example) can apply the same plateau explicitly. The pad
 * circle stays centered on the base anchor (the flag/beacon's own
 * position) but is sized to cover the anchor and the actual landing-pad
 * structure, which `DatabaseService.seedDefaultHomeBase` places a short
 * offset away from the anchor so the two don't visually overlap.
 */
export const HOME_BASE_STATIC_FLATTEN_DEFS: ILocalFlattenTerrainModifierDef[] =
  [
    {
      kind: 'circle',
      directionBodyFixed: HOME_PAD_DIRECTION_BODY_FIXED,
      radiusM: 40,
      blendRadiusM: 40,
      elevationM: HOME_PAD_FLATTEN_ELEVATION_M,
    },
    {
      kind: 'circle',
      directionBodyFixed: HOME_RUNWAY_DIRECTION_BODY_FIXED,
      radiusM: 230,
      blendRadiusM: 80,
      elevationM: HOME_RUNWAY_FLATTEN_ELEVATION_M,
    },
  ];

const HOME_SUN_RADIUS_M = 261_600_000;
const HOME_SUN_MU_M3_PER_S2 = muForSurfaceGravity(HOME_SUN_RADIUS_M, 17.5);

/**
 * Kerbol-scale central star: radius 261,600 km, surface gravity 17.5 m/s².
 * Serves as the system light source and root origin for interplanetary orbits.
 */
export const SUN: ICelestialBody = {
  id: 'sun',
  kind: 'star',
  radiusM: HOME_SUN_RADIUS_M,
  muM3PerS2: HOME_SUN_MU_M3_PER_S2,
  rotationPeriodS: 432_000,
};

export const HOME_PLANET: ICelestialBody = {
  id: 'home-planet',
  kind: 'planet',
  radiusM: HOME_PLANET_RADIUS_M,
  muM3PerS2: HOME_PLANET_MU_M3_PER_S2,
  parentBodyId: SUN.id,
  orbit: {
    semiMajorAxisM: 13_599_840_256,
    eccentricity: 0,
    inclinationRad: 0,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochUt: 0,
  },
  rotationPeriodS: 86_400,
  /** Earth-like obliquity (weather-seasons-climate.md W0) — first stock body to opt in. */
  axialTiltRad: (23.4 * Math.PI) / 180,
  /** Moderate peak zonal wind (weather-seasons-climate.md W1) — first stock body to opt in. */
  windScaleMPerS: 15,
  atmosphere: {
    seaLevelDensityKgM3: 1.225,
    scaleHeightM: 5_000,
    topAltitudeM: 70_000,
    visual: {
      colorRgb: [0.3, 0.6, 1.0],
      horizonColorRgb: [0.9, 0.5, 0.3],
      intensity: 1.0,
    },
  },
  ringSystems: [
    {
      id: 'inner',
      seed: 0x71a6_2026,
      innerRadiusM: HOME_PLANET_RADIUS_M * 1.4,
      outerRadiusM: HOME_PLANET_RADIUS_M * 1.95,
      /** Deliberately opposed to the outer ring for readable crossed-plane lighting. */
      inclinationRad: (20 * Math.PI) / 180,
      profile: 'saturn-like',
      forwardScattering: 1.25,
      shadowOpacity: 1,
    },
    {
      id: 'outer',
      seed: 0x71a6_2027,
      innerRadiusM: HOME_PLANET_RADIUS_M * 2.15,
      outerRadiusM: HOME_PLANET_RADIUS_M * 2.7,
      inclinationRad: (-20 * Math.PI) / 180,
      profile: 'saturn-like',
      forwardScattering: 1.25,
      shadowOpacity: 1,
    },
  ],
  terrain: HOME_PLANET_BASE_TERRAIN,
};

/**
 * The coastal finder keeps the pad at a low 11.5-degree latitude, close
 * enough to `HOME_MOON`'s orbital plane (inclination 0) for a practical
 * eastward gravity turn and prograde transfer. A polar pad (latitude 90) was
 * tried first for a simpler
 * "straight up" liftoff, but every orbit launched from a pole is
 * necessarily polar regardless of heading (the launch point sits on the
 * planet's rotation axis) — no amount of in-flight yaw can reach an
 * equatorial orbit from there, which is what motivated this move.
 */
export const HOME_PAD: ILaunchSite = {
  id: 'home-pad',
  bodyId: HOME_PLANET.id,
  latitude: HOME_BASE_LATITUDE_DEG,
  longitude: HOME_BASE_LONGITUDE_DEG,
  altitude: 0,
  orientation: 0,
  type: 'pad',
};

/** Stock airfield beside the home pad; its heading follows the runway's long axis. */
export const HOME_RUNWAY: ILaunchSite = {
  id: 'home-runway',
  bodyId: HOME_PLANET.id,
  latitude: HOME_RUNWAY_LATITUDE_DEG,
  longitude: HOME_RUNWAY_LONGITUDE_DEG,
  altitude: 0,
  orientation: 0,
  type: 'runway',
};

/**
 * Mun-scale moon (patched-conics.md decision 2): radius 200 km,
 * `muM3PerS2` derived for a ~1.63 m/s² surface gravity, airless, with a
 * visual-only cratered terrain definition, circular equatorial orbit at 12,000 km —
 * reachable with a single prograde burn from either `HOME_PAD`'s equatorial
 * debug-teleport orbit (`leo-teleport.ts`) or a real equatorial launch
 * (`HOME_PAD` itself now sits at a low latitude for exactly
 * this reason). SOI ≈
 * 2.43e6 m, orbital period ≈ 38.6 h — both comfortably inside the rails
 * warp ladder.
 */
export const HOME_MOON: ICelestialBody = {
  id: 'home-moon',
  kind: 'moon',
  radiusM: 200_000,
  muM3PerS2: muForSurfaceGravity(200_000, 1.63),
  parentBodyId: HOME_PLANET.id,
  /**
   * Drives the Moon's baked albedo and normal textures only. Flight collision
   * and altitude remain tied to the datum sphere until Phase 7 terrain physics.
   */
  terrain: {
    seed: 0x600d_2026,
    minElevationM: -3_500,
    maxElevationM: 5_000,
    generators: [
      {
        kind: 'crater-field-3d',
        cellFrequency: 8,
        craterProbability: 0.62,
        minRadiusCells: 0.12,
        maxRadiusCells: 0.42,
        depthM: 1_100,
        rimHeightM: 260,
      },
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 700,
        frequency: 5,
        octaves: 4,
        lacunarity: 2,
        persistence: 0.5,
      },
    ],
    visual: {
      colorRgb: [0.34, 0.36, 0.4],
      highColorRgb: [0.72, 0.75, 0.8],
    },
  },
  orbit: {
    semiMajorAxisM: 12_000_000,
    eccentricity: 0,
    inclinationRad: 0,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochUt: 0,
  },
};

/**
 * Small outer icy moon: radius 80 km, surface gravity 0.6 m/s²,
 * circular orbit at 28,000 km (further than `HOME_MOON`'s 12,000 km orbit).
 * Features a vibrant blue-green turquoise visual palette blending smooth
 * flat ice plains (`flat-ice`) with sharp ridged mountain peaks (`curl-mountains`).
 */
export const FAR_MOON: ICelestialBody = {
  id: 'far-moon',
  kind: 'moon',
  radiusM: 80_000,
  muM3PerS2: muForSurfaceGravity(80_000, 0.6),
  parentBodyId: HOME_PLANET.id,
  terrain: {
    seed: 0x01ce_2026,
    minElevationM: 0,
    maxElevationM: 5_000,
    generators: [
      /** Fine surface micro-detail (2m) leaving the baseline terrain completely flat. */
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 2,
        frequency: 120,
        octaves: 2,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 950,
      },
    ],
    biomes: [
      {
        id: 'flat-ice',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 0.4,
          octaves: 2,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 100,
          lowerThreshold: -0.05,
          upperThreshold: 0.05,
        },
        generators: [],
        visual: {
          colorRgb: [0.15, 0.7, 0.72],
          highColorRgb: [0.85, 0.98, 0.98],
        },
      },
      {
        id: 'curl-mountains',
        mask: {
          kind: 'noise-mask-3d',
          frequency: 1.2,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
          seedOffset: 500,
          lowerThreshold: -0.1,
          upperThreshold: 0.5,
        },
        generators: [
          {
            kind: 'ridged-fractal-3d',
            amplitudeM: 4_200,
            frequency: 5,
            octaves: 5,
            lacunarity: 2,
            persistence: 0.5,
            ridgeExponent: 3.5,
            seedOffset: 510,
          },
        ],
        visual: {
          colorRgb: [0.04, 0.28, 0.35],
          highColorRgb: [0.45, 0.88, 0.82],
        },
      },
    ],
    visual: {
      colorRgb: [0.15, 0.7, 0.72],
      highColorRgb: [0.85, 0.98, 0.98],
    },
  },
  orbit: {
    semiMajorAxisM: 28_000_000,
    eccentricity: 0,
    inclinationRad: 0,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 1.2,
    epochUt: 0,
  },
};

/**
 * Diagnostic twin of `HOME_MOON`, fixed 24,000 km from the home planet with
 * exactly zero parent-relative velocity. It deliberately reuses the moon's
 * radius, gravity, and terrain so surface-physics tests differ only by body
 * translation: orbiting versus stationary.
 */
export const STATIONARY_TEST_MOON: ICelestialBody = {
  ...HOME_MOON,
  id: 'stationary-test-moon',
  orbit: undefined,
  fixedPositionRelativeToParentM: [100_000_000, 0, 0],
  rotationPeriodS: 86_400,
};

/** Every stock body — a collection, never a singleton "the planet" (04_north-star-features.md §8). */
export const STOCK_BODIES: readonly ICelestialBody[] = [
  SUN,
  HOME_PLANET,
  HOME_MOON,
  FAR_MOON,
  STATIONARY_TEST_MOON,
];
