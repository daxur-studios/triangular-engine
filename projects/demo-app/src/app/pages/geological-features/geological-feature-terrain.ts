export type GeologicalFeatureKind = 'volcano' | 'canyon';

export interface VolcanoSettings {
  readonly radius: number;
  readonly height: number;
  readonly craterRadius: number;
  readonly craterDepth: number;
  readonly erosion: number;
  readonly ridgeCount: number;
  readonly spiralness: number;
  readonly seed: number;
}

export interface CanyonSettings {
  readonly width: number;
  readonly depth: number;
  readonly wallSteepness: number;
  readonly meander: number;
  readonly erosion: number;
  readonly seed: number;
}

export interface GeologicalTerrainSettings {
  readonly volcano: VolcanoSettings;
  readonly canyon: CanyonSettings;
}

export function defaultGeologicalTerrainSettings(): GeologicalTerrainSettings {
  return {
    volcano: {
      radius: 72,
      height: 48,
      craterRadius: 13,
      craterDepth: 19,
      erosion: 0.42,
      ridgeCount: 8,
      spiralness: 0.58,
      seed: 7,
    },
    canyon: {
      width: 24,
      depth: 34,
      wallSteepness: 2.4,
      meander: 24,
      erosion: 0.38,
      seed: 11,
    },
  };
}

export function sampleGeologicalElevation(
  kind: GeologicalFeatureKind,
  x: number,
  z: number,
  settings: GeologicalTerrainSettings,
): number {
  const base = rollingBase(x, z);
  return kind === 'volcano'
    ? base + sampleVolcano(x, z, settings.volcano)
    : base + sampleCanyon(x, z, settings.canyon);
}

export function sampleVolcano(
  x: number,
  z: number,
  settings: VolcanoSettings,
): number {
  const distance = Math.hypot(x, z);
  // Keep the asymmetry in Cartesian space. Angle-based functions with a
  // non-integer frequency jump at atan2's -PI/PI branch and create a visible
  // seam through the volcano.
  const asymmetry =
    1 +
    (valueNoise(x * 0.018, z * 0.018, settings.seed + 17) - 0.5) *
      0.14;
  const radius = distance / asymmetry;
  const normalized = radius / Math.max(1, settings.radius);
  const cone = settings.height * Math.pow(Math.max(0, 1 - normalized), 1.45);
  const rimDistance = Math.abs(radius - settings.craterRadius);
  const rim = settings.height * 0.13 * Math.exp(-(rimDistance * rimDistance) / 28);
  const crater =
    settings.craterDepth *
    Math.exp(-(radius * radius) / Math.max(1, settings.craterRadius ** 2 * 0.7));
  const angle = Math.atan2(z, x);
  // Retain a subtle directional volcanic structure: the integer harmonic is
  // continuous at atan2's -PI/PI branch, while the small radial phase creates
  // gently curving ridges instead of straight spokes. Cartesian noise keeps
  // the ridges from becoming a repeated procedural pattern.
  // Seed the large-scale identity as well as the fine noise. Keeping the
  // ridge count integral preserves continuity at the atan2 branch while
  // allowing one seed to make five broad ridges and another to make twelve.
  const ridgeCount = Math.max(3, Math.min(16, Math.round(settings.ridgeCount)));
  const twist = 0.035 + seedNoise(settings.seed + 23) * 0.09;
  const direction = seedNoise(settings.seed + 41) < 0.5 ? -1 : 1;
  const spiralPattern =
    Math.sin(
      direction * (angle * ridgeCount + radius * twist) + settings.seed * 0.7,
    ) *
      (0.35 + settings.spiralness * 0.45) +
    0.5;
  const warpX =
    (valueNoise(x * 0.035 + 4.7, z * 0.035 - 2.1, settings.seed + 31) -
      0.5) *
    9;
  const warpZ =
    (valueNoise(x * 0.035 - 6.3, z * 0.035 + 5.4, settings.seed + 47) -
      0.5) *
    9;
  const erosionNoise = valueNoise(
    (x + warpX) * 0.075,
    (z + warpZ) * 0.075,
    settings.seed + 61,
  );
  const gullies =
    ((spiralPattern - 0.5) * 0.7 + (erosionNoise - 0.5) * 0.3) *
    settings.erosion *
    settings.height *
    0.14 *
    smoothstep(0.08, 0.85, normalized) *
    (1 - smoothstep(0.82, 1, normalized));
  return cone + rim - crater - gullies;
}

export function sampleCanyon(
  x: number,
  z: number,
  settings: CanyonSettings,
): number {
  const centre =
    Math.sin(z * 0.026 + settings.seed) * settings.meander +
    Math.sin(z * 0.061 - settings.seed * 0.3) * settings.meander * 0.22;
  const distance = Math.abs(x - centre);
  const halfWidth = Math.max(1, settings.width * 0.5);
  const profile = Math.exp(
    -Math.pow(distance / halfWidth, Math.max(0.5, settings.wallSteepness)),
  );
  const wallNoise =
    (valueNoise(x * 0.055, z * 0.055, settings.seed) - 0.5) *
    settings.erosion *
    9 *
    smoothstep(halfWidth * 0.25, halfWidth * 2.5, distance) *
    (1 - smoothstep(halfWidth * 2, halfWidth * 4, distance));
  return -settings.depth * profile + wallNoise;
}

function rollingBase(x: number, z: number): number {
  return Math.sin(x * 0.035) * 1.2 + Math.cos(z * 0.029) * 1.4;
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(0, 1, x - x0);
  const tz = smoothstep(0, 1, z - z0);
  const a = hash(x0, z0, seed);
  const b = hash(x0 + 1, z0, seed);
  const c = hash(x0, z0 + 1, seed);
  const d = hash(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function hash(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function seedNoise(seed: number): number {
  const value = Math.sin(seed * 91.73 + 17.19) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
