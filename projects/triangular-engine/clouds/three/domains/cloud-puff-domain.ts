import type { Group, Quaternion, Vector3 } from 'three';

export interface ICloudPuffTransform {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;
}

export interface ICloudPuffDomainContext {
  readonly instanceCount: number;
  readonly seed: number;
  readonly puffScaleRangeM: readonly [number, number];
  /** Half-extents [x, y, z] in metres for Cartesian box placement. */
  readonly regionSizeM?: readonly [number, number, number];
  /** World-space centre the domain is anchored around. Defaults to [0, 0, 0]. */
  readonly originM?: readonly [number, number, number];
  /** Radius (metres) for spherical shells or cylindrical domains. */
  readonly radiusM?: number;
  /** Primary length / height (metres) for cylindrical domains. */
  readonly lengthM?: number;
  /** Thickness (metres) of the altitude band for sphere/cylinder shells. */
  readonly shellThicknessM?: number;
  /**
   * Optional density/moisture weight callback returning 0..1 probability of cloud presence
   * along a given unit-sphere direction vector (e.g. from planet climate/moisture data).
   */
  readonly densityAt?: (direction: Vector3) => number;
}

export interface ICloudPuffWindOptions {
  readonly speed?: number;
  readonly velocityMPerSecond?: readonly [number, number, number];
  readonly angularVelocityRadPerSecond?: number;
  readonly axialVelocityMPerSecond?: number;
  /** Whether to enable latitude-dependent alternating zonal winds (e.g. for gas giants / planetary atmospheres). */
  readonly zonalBanding?: boolean;
  /** Frequency of zonal bands across latitude (default: 4.0). */
  readonly zonalFrequency?: number;
  /** Turbulence / curl noise factor. */
  readonly curlTurbulence?: number;
}

export type CloudPuffWindInput =
  | number
  | readonly [number, number, number]
  | ICloudPuffWindOptions;

export interface ICloudPuffDomainWindController {
  /**
   * Advances wind drift using delta time and/or absolute simulation time.
   * Guaranteed to be timewarp-safe and deterministic at any step size (1x - 100x).
   */
  advanceWind(deltaSeconds: number, wind: CloudPuffWindInput, simulationTimeSeconds?: number): void;
  /**
   * Directly sets the absolute simulation time for 100% deterministic positioning / scrubbing.
   */
  setTime?(simulationTimeSeconds: number, wind?: CloudPuffWindInput): void;
}

/**
 * A pluggable placement domain: governs how puff instances are distributed in 3D space,
 * their orientation relative to the environment (e.g. flat sky vs planetary sphere vs cylinder interior),
 * and how wind movement wraps or rotates over time.
 */
export interface ICloudPuffDomain {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  placeInstances(context: ICloudPuffDomainContext): ICloudPuffTransform[];
  createWindController(group: Group, context: ICloudPuffDomainContext): ICloudPuffDomainWindController;
}
