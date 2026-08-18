import { ICelestialBody } from '../bodies/celestial-body';
import {
  Quatd,
  QUAT_IDENTITY,
  quatApplyToVec3,
  quatConjugate,
  quatFromAxisAngle,
  quatMultiply,
} from '../math/quat';
import { Vec3d, vec3Add, vec3Cross } from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';

/**
 * An immutable frame snapshot for one celestial body at universal time `ut`.
 * Formed once per substep so renderer, terrain, physics, and telemetry share
 * the exact same transform (plan `rotating-celestial-bodies.md`).
 */
export interface BodyFrameSnapshot {
  readonly bodyId: string;
  readonly ut: UniversalTime;
  readonly positionM: Vec3d;
  readonly velocityMPerS: Vec3d;
  readonly rotation: Quatd;
  readonly angularVelocityRadPerS: Vec3d;
}

export interface BodyRotationOptions {
  disableCelestialRotation?: boolean;
  frozenUt?: number;
}

/**
 * Fixed obliquity axis (`weather-seasons-climate.md` W0): with no per-body
 * reference longitude in the data model, the pole tilts away from +Y toward
 * -X by a constant amount. The direction is an arbitrary but deterministic
 * convention — only the tilt magnitude (`axialTiltRad`) is meaningful.
 */
const AXIAL_TILT_AXIS: Vec3d = [0, 0, 1];

/**
 * Calculates the orientation quaternion of a celestial body in PCI coordinates at universal time `ut`.
 * Spin axis is +Y (North pole), tilted by `axialTiltRad` (if set) around
 * `AXIAL_TILT_AXIS`. Absence of `rotationPeriodS` produces `QUAT_IDENTITY`.
 */
export function bodyOrientationAt(
  body: ICelestialBody,
  ut: UniversalTime,
  options?: BodyRotationOptions,
): Quatd {
  if (!body.rotationPeriodS || body.rotationPeriodS <= 0) {
    return QUAT_IDENTITY;
  }
  const evalUt = options?.disableCelestialRotation
    ? (options.frozenUt ?? body.rotationEpochUt ?? 0)
    : ut;
  const omegaRadPerS = (2 * Math.PI) / body.rotationPeriodS;
  const dtS = evalUt - (body.rotationEpochUt ?? 0);
  const angleRad = omegaRadPerS * dtS + (body.rotationInitialPhaseRad ?? 0);

  const spin = quatFromAxisAngle([0, 1, 0], angleRad);
  const axialTiltRad = body.axialTiltRad ?? 0;
  if (axialTiltRad === 0) {
    return spin;
  }
  const tilt = quatFromAxisAngle(AXIAL_TILT_AXIS, axialTiltRad);
  return quatMultiply(tilt, spin);
}

/**
 * Calculates the angular velocity vector of a celestial body in PCI coordinates.
 */
export function bodyAngularVelocityAt(
  body: ICelestialBody,
  options?: BodyRotationOptions,
): Vec3d {
  if (
    !body.rotationPeriodS ||
    body.rotationPeriodS <= 0 ||
    options?.disableCelestialRotation
  ) {
    return [0, 0, 0];
  }
  const omegaRadPerS = (2 * Math.PI) / body.rotationPeriodS;
  const axialTiltRad = body.axialTiltRad ?? 0;
  if (axialTiltRad === 0) {
    return [0, omegaRadPerS, 0];
  }
  const tilt = quatFromAxisAngle(AXIAL_TILT_AXIS, axialTiltRad);
  return quatApplyToVec3(tilt, [0, omegaRadPerS, 0]);
}

/**
 * Converts a body-fixed point `pBody` to PCI body-relative inertial offset: `R * pBody`.
 */
export function bodyFixedToInertial(pBody: Vec3d, R: Quatd): Vec3d {
  return quatApplyToVec3(R, pBody);
}

/**
 * Converts a PCI body-relative inertial offset `pInertial` to body-fixed coordinates: `R^-1 * pInertial`.
 */
export function inertialToBodyFixed(pInertial: Vec3d, R: Quatd): Vec3d {
  return quatApplyToVec3(quatConjugate(R), pInertial);
}

/**
 * Surface velocity in global inertial coordinates:
 * `v_surface = v_body + omega x (R * pBody)`
 */
export function surfaceVelocityAtPoint(
  vBody: Vec3d,
  omega: Vec3d,
  Rp: Vec3d,
): Vec3d {
  return vec3Add(vBody, vec3Cross(omega, Rp));
}
