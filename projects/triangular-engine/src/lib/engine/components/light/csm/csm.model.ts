import { Vector3, Vector3Tuple } from 'three';

/**
 * Frustum split modes supported by Three.js CSM:
 * - 'practical': Logarithmic distribution favoring foreground detail (recommended for games)
 * - 'uniform': Even linear splits across the distance range
 * - 'logarithmic': Pure logarithmic split
 * - 'custom': Custom split distribution callback
 */
export type CsmSplitMode = 'practical' | 'uniform' | 'logarithmic' | 'custom';

/**
 * Planetary / orbit adaptive range configuration.
 * Dynamically adjusts the CSM max distance and attenuates shadow intensity
 * as the camera zooms out or rises into orbit above a spherical celestial body.
 */
export interface CsmAdaptiveRange {
  /** Center of the planet or reference sphere in world coordinates (default: [0, 0, 0]) */
  center?: Vector3Tuple;
  /** Surface radius of the celestial body in world units */
  surfaceRadius: number;
  /** Minimum shadow distance when camera is on the ground (default: 200) */
  minDistance?: number;
  /** Maximum shadow distance when camera is high up (default: 3000) */
  maxDistance?: number;
  /** Distance scaling multiplier relative to altitude (default: 1.5) */
  altitudeScale?: number;
  /** Altitude at which CSM shadows begin to fade out (default: 2500) */
  fadeOutAltitude?: number;
  /** Altitude at which CSM shadows completely fade out to 0 (default: 6000) */
  maxFadeAltitude?: number;
}

export interface CsmAdaptiveResult {
  /** Calculated effective max shadow distance */
  maxDistance: number;
  /** Shadow intensity multiplier (1.0 = full shadow, 0.0 = completely faded into base PBR day/night) */
  shadowFactor: number;
  /** Computed altitude above the surface */
  altitude: number;
}

export interface CsmOptions {
  cascades?: number;
  maxDistance?: number;
  mode?: CsmSplitMode;
  shadowMapSize?: number;
  shadowBias?: number;
  lightDirection?: Vector3 | Vector3Tuple;
  lightIntensity?: number;
  lightMargin?: number;
  fade?: boolean;
}
