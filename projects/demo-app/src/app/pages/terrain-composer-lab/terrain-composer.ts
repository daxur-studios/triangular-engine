import {
  evaluateAtDistance,
  getSplineArcLengthTable,
  type ISplineDefinition,
  type SplineVector3,
} from 'triangular-engine/spline';
import type {
  ITerrainField,
  ITerrainFieldSample,
  TerrainVector3,
} from 'triangular-engine/terrain';

export type ComposerLayer = 'island' | 'mountain' | 'river';

export interface ComposerFeature {
  readonly id: string;
  readonly layer: ComposerLayer;
  readonly points: SplineVector3[];
  readonly closed: boolean;
}

export interface ComposerSettings {
  readonly worldSize: number;
  readonly seaLevel: number;
  readonly islandHeight: number;
  readonly islandFalloff: number;
  readonly mountainHeight: number;
  readonly mountainWidth: number;
  readonly mountainSharpness: number;
  readonly riverDepth: number;
  readonly riverWidth: number;
  readonly noiseAmplitude: number;
  readonly noiseScale: number;
  readonly noiseSeed: number;
}

const DEFAULTS: ComposerSettings = {
  worldSize: 180,
  seaLevel: -8,
  islandHeight: 22,
  islandFalloff: 18,
  mountainHeight: 26,
  mountainWidth: 24,
  mountainSharpness: 1.6,
  riverDepth: 18,
  riverWidth: 7,
  noiseAmplitude: 7,
  noiseScale: 0.035,
  noiseSeed: 7,
};

export function defaultComposerSettings(): ComposerSettings {
  return { ...DEFAULTS };
}

export class TerrainComposerField implements ITerrainField {
  readonly minElevationM = -30;
  readonly maxElevationM = 120;
  private readonly features: readonly ComposerFeature[];
  private readonly settings: ComposerSettings;
  private readonly polylines = new Map<string, readonly SplineVector3[]>();

  constructor(features: readonly ComposerFeature[], settings: ComposerSettings) {
    this.features = features;
    this.settings = settings;
    for (const feature of features) this.polylines.set(feature.id, sampleFeature(feature));
  }

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    const { settings } = this;
    const island = this.features.find((feature) => feature.layer === 'island');
    const islandLine = island ? this.polylines.get(island.id) ?? [] : [];
    const inside = islandLine.length > 2 && pointInPolygon(x, z, islandLine);
    const islandDistance = islandLine.length ? distanceToPolyline(x, z, islandLine) : Infinity;
    const coast = inside ? 1 : Math.max(0, 1 - islandDistance / settings.islandFalloff);
    let elevation = settings.seaLevel + coast * settings.islandHeight;

    for (const feature of this.features) {
      const line = this.polylines.get(feature.id) ?? [];
      if (feature.layer === 'mountain') {
        const distance = distanceToPolyline(x, z, line);
        const ridge = Math.pow(Math.max(0, 1 - distance / settings.mountainWidth), settings.mountainSharpness);
        elevation += ridge * settings.mountainHeight * coast;
      } else if (feature.layer === 'river') {
        const distance = distanceToPolyline(x, z, line);
        const channel = smoothstep(settings.riverWidth * 1.8, 0, distance);
        elevation -= channel * settings.riverDepth;
      }
    }

    const noise = valueNoise2D(x * settings.noiseScale, z * settings.noiseScale, settings.noiseSeed);
    elevation += (noise - 0.5) * settings.noiseAmplitude * coast;
    return { elevationM: elevation };
  }

  sampleBatch(positions: Float64Array, output = new Float64Array(positions.length / 3)): Float64Array {
    for (let i = 0; i < output.length; i++) {
      output[i] = this.sample([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]).elevationM;
    }
    return output;
  }
}

export function sampleHeightmap(
  field: TerrainComposerField,
  size: number,
  worldSize: number,
): Uint8Array {
  const values = new Uint8Array(size * size);
  const span = worldSize / 2;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = (column / (size - 1)) * worldSize - span;
      const z = (row / (size - 1)) * worldSize - span;
      const elevation = field.sample([x, 0, z]).elevationM;
      values[row * size + column] = Math.round(Math.max(0, Math.min(255, ((elevation + 30) / 150) * 255)));
    }
  }
  return values;
}

function sampleFeature(feature: ComposerFeature): readonly SplineVector3[] {
  const definition: ISplineDefinition = {
    schemaVersion: 1,
    id: feature.id,
    interpolation: 'bezier',
    closed: feature.closed,
    points: feature.points.map((position) => ({ position })),
  };
  if (feature.points.length < (feature.closed ? 3 : 2)) return feature.points;
  const table = getSplineArcLengthTable(definition);
  const result: SplineVector3[] = [];
  const count = Math.max(32, Math.ceil(table.totalLength / 2));
  for (let i = 0; i < count; i++) result.push(evaluateAtDistance(definition, (i / count) * table.totalLength).position);
  return result;
}

function distanceToPolyline(x: number, z: number, points: readonly SplineVector3[]): number {
  let closest = Infinity;
  for (let i = 1; i < points.length; i++) closest = Math.min(closest, distanceToSegment(x, z, points[i - 1], points[i]));
  if (points.length > 2) closest = Math.min(closest, distanceToSegment(x, z, points[points.length - 1], points[0]));
  return closest;
}

function distanceToSegment(x: number, z: number, a: SplineVector3, b: SplineVector3): number {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t));
}

function pointInPolygon(x: number, z: number, points: readonly SplineVector3[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], zi = points[i][2];
    const xj = points[j][0], zj = points[j][2];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = x - x0, tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash(x0, z0, seed), b = hash(x0 + 1, z0, seed);
  const c = hash(x0, z0 + 1, seed), d = hash(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

function hash(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
