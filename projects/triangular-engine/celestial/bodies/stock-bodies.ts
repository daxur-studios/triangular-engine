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
const HOME_PAD_DIRECTION_BODY_FIXED: [number, number, number] = [1, 0, 0];
/** Degrees east of the pad, leaving enough separation for both colliders and approach space. */
const HOME_RUNWAY_LONGITUDE_DEG = 0.03;
const HOME_RUNWAY_LONGITUDE_RAD = (HOME_RUNWAY_LONGITUDE_DEG * Math.PI) / 180;
const HOME_RUNWAY_DIRECTION_BODY_FIXED: [number, number, number] = [
  Math.cos(HOME_RUNWAY_LONGITUDE_RAD),
  0,
  Math.sin(HOME_RUNWAY_LONGITUDE_RAD),
];

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
const HOME_PLANET_BIOME_MASK_FREQUENCY = 0.5;
/**
 * Narrowed from +-0.15 (2026-07-19 feedback: terrain read as blended/flat
 * rather than showing distinct meadows and mountains). `highlands`/`plains`
 * sample independent noise fields, so `computeBiomeWeights` normalizes two
 * uncorrelated smoothstep outputs — a wide band left most of the surface
 * partway between both fields' 0/1 plateaus, diluting the ridged highlands
 * peaks and un-flattening the plains almost everywhere. A narrower band
 * reaches each field's decisive 0/1 plateau sooner, so more of the surface
 * commits to one biome's generator instead of an even blend of both.
 */
const HOME_PLANET_MASK_THRESHOLDS = {
  lowerThreshold: -0.08,
  upperThreshold: 0.08,
};

/**
 * Richer pass (2026-07-30 feedback: still read as flat in actual flight,
 * not just from orbit). Two compounding causes, both fixed here without
 * touching province size/shape (`HOME_PLANET_BIOME_MASK_FREQUENCY` and
 * thresholds stay as-is — continents-not-noise still holds):
 * - `plains` previously used a 240 km wavelength (`frequency: 2.5` on a
 *   600 km-radius body) at only 60 m amplitude — over any normal flight
 *   distance that's imperceptible, effectively flat regardless of the
 *   number on paper. Raised to a ~50 km wavelength (`frequency: 12`) and
 *   250 m amplitude so meadows read as genuine rolling hills within a
 *   normal flight envelope, not just from orbit.
 * - `highlands` amplitude/sharpness raised (4_500 -> 6_500 m,
 *   `ridgeExponent` 2.5 -> 3) for peaks dramatic enough to be unmistakably
 *   "mountains" rather than rough noise, once you're in that province.
 */
const HOME_PLANET_BIOMES: ITerrainBiomeDef[] = [
  {
    id: 'highlands',
    mask: {
      kind: 'noise-mask-3d',
      frequency: HOME_PLANET_BIOME_MASK_FREQUENCY,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 200,
      ...HOME_PLANET_MASK_THRESHOLDS,
    },
    generators: [
      {
        kind: 'ridged-fractal-3d',
        amplitudeM: 6_500,
        frequency: 6,
        octaves: 5,
        lacunarity: 2,
        persistence: 0.5,
        ridgeExponent: 3,
        seedOffset: 210,
      },
    ],
    visual: {
      colorRgb: [0.45, 0.4, 0.35],
      highColorRgb: [0.95, 0.95, 0.97],
    },
  },
  {
    id: 'plains',
    mask: {
      kind: 'noise-mask-3d',
      frequency: HOME_PLANET_BIOME_MASK_FREQUENCY,
      octaves: 2,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 700,
      ...HOME_PLANET_MASK_THRESHOLDS,
    },
    generators: [
      {
        kind: 'fractal-noise-3d',
        amplitudeM: 250,
        frequency: 12,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        seedOffset: 710,
      },
    ],
    visual: {
      colorRgb: [0.25, 0.45, 0.2],
      highColorRgb: [0.55, 0.5, 0.35],
    },
  },
];

const HOME_PLANET_BASE_TERRAIN: ITerrainDef = {
  seed: 0x5eed_484f,
  // Bounds recomputed for the 2026-07-30 richer pass: worst case is
  // base(+-3_000) + highlands(0..6_500) + detail(+-400), so
  // -3_650/+9_900 true range; padded to -4_000/+10_200 rather than pinned
  // exactly to that sum, so this doesn't need re-touching over a rounding
  // difference the next time a generator amplitude moves.
  minElevationM: -4_000,
  maxElevationM: 10_200,
  generators: [
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 3_000,
      frequency: 0.8,
      octaves: 4,
      lacunarity: 2,
      persistence: 0.5,
    },
    /**
     * Flight-scale detail layer (phase-7-terrain-landing.md C-R2), amplitude
     * raised 150 -> 400 m in the 2026-07-30 richer pass so even the flattest
     * areas keep visible local relief instead of reading as billiard-flat
     * between province-scale features. Finest octave (frequency x
     * lacunarity^3 = 960) is a ~625 m wavelength — D12 requires every
     * layer's finest octave to stay >= 10x the physics triangle edge
     * (~7 m at L12); 625 m clears that with wide margin.
     */
    {
      kind: 'fractal-noise-3d',
      amplitudeM: 400,
      frequency: 120,
      octaves: 4,
      lacunarity: 2,
      persistence: 0.5,
      seedOffset: 900,
    },
  ],
  biomes: HOME_PLANET_BIOMES,
  visual: {
    colorRgb: [0.25, 0.45, 0.2],
    highColorRgb: [0.9, 0.9, 0.92],
  },
  ocean: {
    seaLevelM: 0,
    shallowColorRgb: [0.1, 0.35, 0.55],
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
 * Latitude 0 places the pad on the equator, in `HOME_MOON`'s orbital plane
 * (inclination 0) — a real launch can reach the moon with an eastward
 * gravity turn and a prograde burn, the same way it reaches any other
 * inclination. A polar pad (latitude 90) was tried first for a simpler
 * "straight up" liftoff, but every orbit launched from a pole is
 * necessarily polar regardless of heading (the launch point sits on the
 * planet's rotation axis) — no amount of in-flight yaw can reach an
 * equatorial orbit from there, which is what motivated this move.
 */
export const HOME_PAD: ILaunchSite = {
  id: 'home-pad',
  bodyId: HOME_PLANET.id,
  latitude: 0,
  longitude: 0,
  altitude: 0,
  orientation: 0,
  type: 'pad',
};

/** Stock airfield beside the home pad; its heading follows the runway's long axis. */
export const HOME_RUNWAY: ILaunchSite = {
  id: 'home-runway',
  bodyId: HOME_PLANET.id,
  latitude: 0,
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
 * (`HOME_PAD` itself now sits on the equator for exactly this reason). SOI ≈
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
