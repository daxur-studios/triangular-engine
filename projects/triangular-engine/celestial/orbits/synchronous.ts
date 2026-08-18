import { ICelestialBody } from '../bodies/celestial-body';
import { soiRadiusM } from './soi';

export type SynchronousOrbitInvalidReason =
  | 'no-rotation'
  | 'inside-body'
  | 'inside-atmosphere'
  | 'outside-soi';

export interface ISynchronousOrbitStatus {
  /** True when the synchronous orbit altitude is outside the body and atmosphere, and inside its parent SOI (if parent exists). */
  readonly isValid: boolean;
  /** Radius from the center of the body in meters, or null if body does not rotate. */
  readonly radiusM: number | null;
  /** Altitude above the body datum radius in meters, or null if body does not rotate. */
  readonly altitudeM: number | null;
  /** If not valid, reason explaining why. */
  readonly reason?: SynchronousOrbitInvalidReason;
}

/**
 * Calculates synchronous orbit radius: `r_sync = (mu * T_rot^2 / (4 * pi^2))^(1/3)`.
 * Returns null if `rotationPeriodS` is missing, 0, or non-positive.
 */
export function synchronousOrbitRadiusM(body: ICelestialBody): number | null {
  if (
    !body.rotationPeriodS ||
    body.rotationPeriodS <= 0 ||
    body.muM3PerS2 <= 0
  ) {
    return null;
  }
  const t = body.rotationPeriodS;
  const mu = body.muM3PerS2;
  return Math.cbrt((mu * t * t) / (4 * Math.PI * Math.PI));
}

/**
 * Evaluates the physical validity of a synchronous orbit for a given body,
 * including checks against body radius, atmosphere top altitude, and parent SOI limit.
 */
export function synchronousOrbitStatus(
  body: ICelestialBody,
  parentBody?: ICelestialBody,
): ISynchronousOrbitStatus {
  const radiusM = synchronousOrbitRadiusM(body);
  if (radiusM === null) {
    return {
      isValid: false,
      radiusM: null,
      altitudeM: null,
      reason: 'no-rotation',
    };
  }

  const altitudeM = radiusM - body.radiusM;
  if (altitudeM <= 0) {
    return {
      isValid: false,
      radiusM,
      altitudeM,
      reason: 'inside-body',
    };
  }

  const atmoTopM = body.atmosphere?.topAltitudeM ?? 0;
  if (altitudeM < atmoTopM) {
    return {
      isValid: false,
      radiusM,
      altitudeM,
      reason: 'inside-atmosphere',
    };
  }

  if (parentBody && (body.orbit || body.fixedPositionRelativeToParentM)) {
    try {
      const soiM = soiRadiusM(body, parentBody);
      if (radiusM >= soiM) {
        return {
          isValid: false,
          radiusM,
          altitudeM,
          reason: 'outside-soi',
        };
      }
    } catch {
      // If SOI cannot be computed, skip SOI bound check
    }
  }

  return {
    isValid: true,
    radiusM,
    altitudeM,
  };
}
