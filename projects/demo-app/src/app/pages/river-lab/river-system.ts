import { Vector3 } from 'three';
import type {
  ITerrainField,
  ITerrainFieldSample,
  TerrainVector3,
} from 'triangular-engine/terrain';
import type { WaterSurface } from 'triangular-engine/water';

export interface RiverControlPoint {
  readonly x: number;
  readonly z: number;
  readonly surfaceY: number;
  readonly halfWidth: number;
  readonly flowMps: number;
}

export interface RiverSample {
  readonly x: number;
  readonly z: number;
  readonly surfaceY: number;
  readonly halfWidth: number;
  readonly flowMps: number;
  readonly tangentX: number;
  readonly tangentZ: number;
  readonly distance: number;
  readonly progress: number;
}

/**
 * Demo-level canonical river description. Both terrain carving and rendering
 * consume this object; neither subsystem knows about the other.
 */
export class RiverPath implements WaterSurface {
  readonly points: readonly RiverControlPoint[];
  readonly lengthM: number;
  private readonly cumulativeLengths: readonly number[];

  constructor(points: readonly RiverControlPoint[]) {
    if (points.length < 2) throw new RangeError('A river needs two points.');
    this.points = points;
    const cumulative = [0];
    for (let index = 1; index < points.length; index++) {
      cumulative.push(
        cumulative[index - 1] +
          Math.hypot(
            points[index].x - points[index - 1].x,
            points[index].z - points[index - 1].z,
          ),
      );
    }
    this.cumulativeLengths = cumulative;
    this.lengthM = cumulative[cumulative.length - 1];
  }

  sample(x: number, z: number): RiverSample {
    let closest: RiverSample | undefined;
    for (let index = 0; index < this.points.length - 1; index++) {
      const start = this.points[index];
      const end = this.points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = Math.max(
        0,
        Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared),
      );
      const sampleX = start.x + dx * t;
      const sampleZ = start.z + dz * t;
      const distance = Math.hypot(x - sampleX, z - sampleZ);
      if (!closest || distance < closest.distance) {
        const segmentLength = Math.sqrt(lengthSquared);
        closest = {
          x: sampleX,
          z: sampleZ,
          surfaceY: lerp(start.surfaceY, end.surfaceY, t),
          halfWidth: lerp(start.halfWidth, end.halfWidth, t),
          flowMps: lerp(start.flowMps, end.flowMps, t),
          tangentX: dx / segmentLength,
          tangentZ: dz / segmentLength,
          distance,
          progress:
            (this.cumulativeLengths[index] + segmentLength * t) / this.lengthM,
        };
      }
    }
    return closest!;
  }

  getHeight(x: number, z: number, _time: number): number {
    return this.sample(x, z).surfaceY;
  }

  getNormal(
    _x: number,
    _z: number,
    _time: number,
    out = new Vector3(),
  ): Vector3 {
    return out.set(0, 1, 0);
  }

  getFlow(x: number, z: number, _time: number, out = new Vector3()): Vector3 {
    const sample = this.sample(x, z);
    return out.set(
      sample.tangentX * sample.flowMps,
      0,
      sample.tangentZ * sample.flowMps,
    );
  }
}

/** Composes a channel into any existing terrain field. */
export class RiverCarvedTerrainField implements ITerrainField {
  readonly minElevationM: number;
  readonly maxElevationM: number;

  constructor(
    readonly base: ITerrainField,
    readonly river: RiverPath,
    readonly channelDepthM = 2.5,
    readonly bankWidthMultiplier = 1.7,
  ) {
    this.minElevationM = Math.min(
      base.minElevationM,
      ...river.points.map(({ surfaceY }) => surfaceY - channelDepthM),
    );
    this.maxElevationM = base.maxElevationM;
  }

  sample(position: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.sampleElevation(position) };
  }

  sampleBatch(
    positions: Float64Array,
    elevations = new Float64Array(positions.length / 3),
  ): Float64Array {
    if (
      positions.length % 3 !== 0 ||
      elevations.length !== positions.length / 3
    )
      throw new RangeError('Terrain samples must contain packed xyz triples.');
    for (let index = 0; index < elevations.length; index++) {
      elevations[index] = this.sampleElevation([
        positions[index * 3],
        positions[index * 3 + 1],
        positions[index * 3 + 2],
      ]);
    }
    return elevations;
  }

  private sampleElevation(position: TerrainVector3): number {
    const baseElevation = this.base.sample(position).elevationM;
    const sample = this.river.sample(position[0], position[2]);
    const bankRadius = sample.halfWidth * this.bankWidthMultiplier;
    if (sample.distance >= bankRadius) return baseElevation;
    const normalized = sample.distance / bankRadius;
    const smooth = normalized * normalized * (3 - 2 * normalized);
    const bed = sample.surfaceY - this.channelDepthM;
    return Math.min(baseElevation, lerp(bed, baseElevation, smooth));
  }
}

export function createProceduralRiver(): RiverPath {
  const points: RiverControlPoint[] = [];
  const count = 49;
  for (let index = 0; index < count; index++) {
    const progress = index / (count - 1);
    const z = -470 + progress * 940;
    const envelope = Math.sin(progress * Math.PI);
    const x =
      envelope *
      (72 * Math.sin(progress * Math.PI * 3.2) +
        24 * Math.sin(progress * Math.PI * 7.4 + 0.8));
    points.push({
      x,
      z,
      surfaceY: 30 - progress * 24,
      halfWidth: 6 + progress * 9,
      flowMps: 1.2 + progress * 1.8,
    });
  }
  return new RiverPath(points);
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
