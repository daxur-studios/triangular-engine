import { AnimalTime, AnimalVector3 } from './animal-types';
import { AnimalWorldSurfaceSample } from './animal-world-surface';

export type AnimalWaterLocation =
  | 'water'
  | 'above-surface'
  | 'below-bottom'
  | 'dry'
  | 'land';

export interface AnimalWaterSurfaceSample {
  readonly bodyId: string;
  readonly position: AnimalVector3;
  /** Points from the water volume toward air. */
  readonly normal: AnimalVector3;
  readonly flow: AnimalVector3;
}

export interface AnimalWaterVolumeSample {
  readonly location: AnimalWaterLocation;
  readonly containsWater: boolean;
  readonly hasWaterBody: boolean;
  readonly aboveSurface: boolean;
  readonly belowBottom: boolean;
  readonly dry: boolean;
  readonly land: boolean;
  readonly waterColumnDepthM: number;
  readonly surfaceClearanceM: number;
  readonly bottomClearanceM: number;
  /** Positive toward air, negative into water. */
  readonly signedSurfaceDistanceM?: number;
  /** Positive above the bottom, negative inside terrain. */
  readonly signedBottomDistanceM?: number;
  readonly surface?: AnimalWaterSurfaceSample;
  readonly bottom?: AnimalWorldSurfaceSample;
}

export interface AnimalWaterVolume {
  sample(
    worldPosition: AnimalVector3,
    time: AnimalTime,
    anchorWorldPosition?: AnimalVector3,
  ): AnimalWaterVolumeSample;
  /** Bounded sampled steering check, not a collision solver. */
  isSegmentValid(
    from: AnimalVector3,
    to: AnimalVector3,
    time: AnimalTime,
    maxSampleSpacingM?: number,
  ): boolean;
  /** Topology-owned lateral movement over the selected water surface. */
  moveAlongSurface(
    worldPosition: AnimalVector3,
    tangentVelocity: AnimalVector3,
    deltaSeconds: number,
    time: AnimalTime,
  ): AnimalWaterSurfaceSample | undefined;
  surfaceDistance(fromWorldPosition: AnimalVector3, toWorldPosition: AnimalVector3): number;
}
