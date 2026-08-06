export type GeologicalFeatureKind = 'volcano' | 'canyon';

export interface VolcanoSettings {
  readonly radius: number;
  readonly height: number;
  readonly craterRadius: number;
  readonly craterDepth: number;
  readonly erosion: number;
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
  const angle = Math.atan2(z, x);
  const asymmetry = 1 + Math.sin(angle * 2.1 + settings.seed) * 0.08;
  const radius = Math.hypot(x, z) / asymmetry;
  const normalized = radius / Math.max(1, settings.radius);
  const cone = settings.height * Math.pow(Math.max(0, 1 - normalized), 1.45);
  const rimDistance = Math.abs(radius - settings.craterRadius);
  const rim = settings.height * 0.13 * Math.exp(-(rimDistance * rimDistance) / 28);
  const crater =
    settings.craterDepth *
    Math.exp(-(radius * radius) / Math.max(1, settings.craterRadius ** 2 * 0.7));
  const gullies =
    Math.sin(angle * 11 + settings.seed * 0.7 + radius * 0.12) *
    settings.erosion *
    settings.height *
    0.09 *
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

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
