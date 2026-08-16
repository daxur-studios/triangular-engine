import type {
  AnimalTime,
  AnimalVector3,
  AnimalWaterSurfaceSample,
  AnimalWaterVolume,
  AnimalWaterVolumeSample,
  AnimalWorldSurface,
} from 'triangular-engine/animals';
import { sampleWaterBody, type WaterBody } from 'triangular-engine/water';
import { Vector3 } from 'three';

export interface AnimalWaterBody {
  readonly body: WaterBody;
  /** Tests the body's 2D footprint at its projected surface position. */
  readonly containsSurface?: (surfacePosition: AnimalVector3) => boolean;
}

export interface TerrainWaterAnimalVolumeOptions {
  readonly terrain: AnimalWorldSurface;
  readonly bodies: readonly AnimalWaterBody[];
  /** Columns at or below this depth are classified as land. Defaults to 1 mm. */
  readonly minimumColumnDepthM?: number;
  /** Hard bound for one segment query. Defaults to 4096 samples. */
  readonly maximumSegmentSamples?: number;
}

/** Combines water surfaces and terrain bathymetry into a fish-safe volume. */
export class TerrainWaterAnimalVolume implements AnimalWaterVolume {
  private readonly bodies: readonly AnimalWaterBody[];
  private readonly minimumColumnDepthM: number;
  private readonly maximumSegmentSamples: number;

  constructor(private readonly options: TerrainWaterAnimalVolumeOptions) {
    this.bodies = [...options.bodies].sort((a, b) =>
      (b.body.priority ?? 0) - (a.body.priority ?? 0) || a.body.id.localeCompare(b.body.id));
    this.minimumColumnDepthM = options.minimumColumnDepthM ?? 0.001;
    this.maximumSegmentSamples = options.maximumSegmentSamples ?? 4096;
    if (!Number.isFinite(this.minimumColumnDepthM) || this.minimumColumnDepthM < 0) {
      throw new RangeError('Animal minimum water-column depth must be finite and non-negative.');
    }
    if (!Number.isSafeInteger(this.maximumSegmentSamples) || this.maximumSegmentSamples < 2) {
      throw new RangeError('Animal maximum segment samples must be an integer of at least two.');
    }
  }

  sample(
    worldPosition: AnimalVector3,
    time: AnimalTime,
    anchorWorldPosition: AnimalVector3 = worldPosition,
  ): AnimalWaterVolumeSample {
    validateVector(worldPosition, 'Animal water position');
    validateVector(anchorWorldPosition, 'Animal water anchor');
    if (!Number.isFinite(time)) throw new RangeError('Animal water time must be finite.');

    const world = toVector3(worldPosition);
    let selected: ReturnType<typeof sampleWaterBody> | undefined;
    for (const candidate of this.bodies) {
      const sampled = sampleWaterBody(candidate.body, world, time);
      const surfacePosition = fromVector3(sampled.position);
      const covered = candidate.containsSurface?.(surfacePosition)
        ?? candidate.body.contains?.(sampled.position)
        ?? true;
      if (covered) {
        selected = sampled;
        break;
      }
    }
    if (!selected) return drySample();

    const surface = waterSurfaceSample(selected);
    const bottom = this.options.terrain.sample(surface.position, anchorWorldPosition);
    const surfaceToBottom = subtract(surface.position, bottom.position);
    const waterColumnDepthM = dot(surfaceToBottom, surface.normal);
    const signedSurfaceDistanceM = dot(subtract(worldPosition, surface.position), surface.normal);
    const signedBottomDistanceM = dot(subtract(worldPosition, bottom.position), surface.normal);
    const land = waterColumnDepthM <= this.minimumColumnDepthM;
    const aboveSurface = !land && signedSurfaceDistanceM > 0;
    const belowBottom = !land && signedBottomDistanceM < 0;
    const containsWater = !land && !aboveSurface && !belowBottom;
    const location = land
      ? 'land'
      : aboveSurface
        ? 'above-surface'
        : belowBottom
          ? 'below-bottom'
          : 'water';

    return {
      location,
      containsWater,
      hasWaterBody: true,
      aboveSurface,
      belowBottom,
      dry: false,
      land,
      waterColumnDepthM: Math.max(0, waterColumnDepthM),
      surfaceClearanceM: containsWater ? Math.max(0, -signedSurfaceDistanceM) : 0,
      bottomClearanceM: containsWater ? Math.max(0, signedBottomDistanceM) : 0,
      signedSurfaceDistanceM,
      signedBottomDistanceM,
      surface,
      bottom,
    };
  }

  isSegmentValid(
    from: AnimalVector3,
    to: AnimalVector3,
    time: AnimalTime,
    maxSampleSpacingM = 1,
  ): boolean {
    validateVector(from, 'Animal water segment start');
    validateVector(to, 'Animal water segment end');
    if (!Number.isFinite(maxSampleSpacingM) || maxSampleSpacingM <= 0) {
      throw new RangeError('Animal water segment spacing must be positive and finite.');
    }
    const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const segments = Math.max(1, Math.ceil(distance / maxSampleSpacingM));
    if (segments + 1 > this.maximumSegmentSamples) return false;
    for (let index = 0; index <= segments; index++) {
      const progress = index / segments;
      const position = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        z: from.z + (to.z - from.z) * progress,
      };
      if (!this.sample(position, time).containsWater) return false;
    }
    return true;
  }

  moveAlongSurface(
    worldPosition: AnimalVector3,
    tangentVelocity: AnimalVector3,
    deltaSeconds: number,
    time: AnimalTime,
  ): AnimalWaterSurfaceSample | undefined {
    validateVector(worldPosition, 'Animal water movement position');
    validateVector(tangentVelocity, 'Animal water tangent velocity');
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(time)) {
      throw new RangeError('Animal water movement time must be finite and non-negative.');
    }
    const current = this.sample(worldPosition, time);
    if (!current.surface) return undefined;
    const configured = this.bodies.find(candidate => candidate.body.id === current.surface?.bodyId);
    if (!configured) return undefined;
    const frame = configured.body.domain.getLocalFrame(toVector3(current.surface.position));
    const velocity = toVector3(tangentVelocity);
    const offsetFromFrame = toVector3(current.surface.position).sub(frame.origin);
    const localX = offsetFromFrame.dot(frame.tangentU) + velocity.dot(frame.tangentU) * deltaSeconds;
    const localZ = offsetFromFrame.dot(frame.tangentV) + velocity.dot(frame.tangentV) * deltaSeconds;
    const candidate = configured.body.domain.composeWorldPosition(frame, localX, localZ, 0);
    const sampled = sampleWaterBody(configured.body, candidate, time);
    const surfacePosition = fromVector3(sampled.position);
    const covered = configured.containsSurface?.(surfacePosition)
      ?? configured.body.contains?.(sampled.position)
      ?? true;
    return covered ? waterSurfaceSample(sampled) : undefined;
  }

  surfaceDistance(fromWorldPosition: AnimalVector3, toWorldPosition: AnimalVector3): number {
    return this.options.terrain.surfaceDistance(fromWorldPosition, toWorldPosition);
  }
}

export function createTerrainWaterAnimalVolume(
  options: TerrainWaterAnimalVolumeOptions,
): AnimalWaterVolume {
  return new TerrainWaterAnimalVolume(options);
}

function drySample(): AnimalWaterVolumeSample {
  return {
    location: 'dry', containsWater: false, hasWaterBody: false,
    aboveSurface: false, belowBottom: false, dry: true, land: false,
    waterColumnDepthM: 0, surfaceClearanceM: 0, bottomClearanceM: 0,
  };
}
function waterSurfaceSample(sample: ReturnType<typeof sampleWaterBody>): AnimalWaterSurfaceSample {
  return {
    bodyId: sample.body.id,
    position: fromVector3(sample.position),
    normal: fromVector3(sample.normal),
    flow: fromVector3(sample.flow),
  };
}
function toVector3(value: AnimalVector3): Vector3 { return new Vector3(value.x, value.y, value.z); }
function fromVector3(value: Vector3): AnimalVector3 { return { x: value.x, y: value.y, z: value.z }; }
function subtract(a: AnimalVector3, b: AnimalVector3): AnimalVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: AnimalVector3, b: AnimalVector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function validateVector(value: AnimalVector3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError(`${label} must be finite.`);
}
