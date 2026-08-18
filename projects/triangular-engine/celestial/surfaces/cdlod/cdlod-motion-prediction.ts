import { Vec3d } from '../../math/vec3';

/**
 * Reusable motion prediction & look-ahead contract for CDLOD quadtree selection.
 *
 * Supports static cameras (with automatic delta estimation), linear hypersonic flight,
 * and curved Keplerian orbits under high time warp.
 */
export type CdlodMotionLookAhead =
  /** 1. Stationary or auto-estimated from camera deltas */
  | { readonly kind: 'none' }

  /** 2. Linear flight (Aircraft, Hypersonic atmospheric cruise, Surface rovers) */
  | {
      readonly kind: 'linear';
      /** Ground/surface-relative velocity in body-fixed metres per second */
      readonly velocityBodyFixedMps: Vec3d;
      /** Active simulation time warp factor (e.g. 1, 5, 100). Defaults to 1. */
      readonly timeWarp?: number;
      /** Forward lead time in wall-clock seconds (defaults to ~0.25s worker latency budget). */
      readonly leadTimeSeconds?: number;
    }

  /** 3. Curved Orbit / Conic Rails (Spacecraft, Satellites, Celestial Ephemeris) */
  | {
      readonly kind: 'curved';
      /** Predicts body-fixed position at leadSeconds in the future, wrapped along the true orbit */
      readonly samplePositionBodyFixedM: (leadSeconds: number) => Vec3d;
      /** Normalized prograde velocity direction in body-fixed frame */
      readonly velocityDirectionBodyFixed?: Vec3d;
      /** Active simulation time warp factor (e.g. 1, 10, 100, 10000). Defaults to 1. */
      readonly timeWarp?: number;
      /** Forward lead time in wall-clock seconds (defaults to ~0.35s worker latency budget). */
      readonly leadTimeSeconds?: number;
    };

export interface IResolvedMotionState {
  /** Effective evaluation center in body-fixed metres where terrain is needed */
  readonly evalCameraBodyFixedM: Vec3d;
  /** Effective forward gaze vector in body-fixed frame */
  readonly evalForwardDir?: Vec3d;
  /** Forward velocity direction unit vector (if moving) for worker queue priority */
  readonly velocityDirection?: Vec3d;
  /** Effective ground-relative speed in metres per second (including time warp) */
  readonly effectiveSpeedMps: number;
  /** Dynamic view-frustum culling cone half-angle in radians (expanded during fast rotational swivels) */
  readonly coneHalfAngleRad: number;
}

const DEFAULT_LEAD_TIME_S = 0.25;
const DEFAULT_CONE_HALF_ANGLE_RAD = 1.28; // ~73 deg half-cone (146 deg wide total cone)
const EXPANDED_CONE_HALF_ANGLE_RAD = 1.42; // ~81 deg half-cone (162 deg wide total cone)

/**
 * Resolves motion look-ahead from an explicit contract or estimated camera state.
 */
export function resolveMotionLookAhead(
  currentCameraBodyFixedM: Vec3d,
  currentForwardDir?: Vec3d,
  motion?: CdlodMotionLookAhead | null,
  estimatedCameraVelocityMps?: Vec3d,
  estimatedAngularSpeedRadPerSec?: number,
): IResolvedMotionState {
  // 1. Explicit Curved Orbit
  if (motion?.kind === 'curved') {
    const warp = Math.max(1, motion.timeWarp ?? 1);
    const lead = motion.leadTimeSeconds ?? DEFAULT_LEAD_TIME_S;
    const futurePos = motion.samplePositionBodyFixedM(lead * warp);

    const deltaX = futurePos[0] - currentCameraBodyFixedM[0];
    const deltaY = futurePos[1] - currentCameraBodyFixedM[1];
    const deltaZ = futurePos[2] - currentCameraBodyFixedM[2];
    const dist = Math.hypot(deltaX, deltaY, deltaZ);
    const effectiveSpeed = dist / Math.max(0.001, lead);

    const velDir: Vec3d | undefined =
      motion.velocityDirectionBodyFixed ?? (dist > 1 ? [deltaX / dist, deltaY / dist, deltaZ / dist] : undefined);

    return {
      evalCameraBodyFixedM: futurePos,
      evalForwardDir: currentForwardDir,
      velocityDirection: velDir,
      effectiveSpeedMps: effectiveSpeed,
      coneHalfAngleRad: DEFAULT_CONE_HALF_ANGLE_RAD,
    };
  }

  // 2. Explicit Linear Flight
  if (motion?.kind === 'linear') {
    const warp = Math.max(1, motion.timeWarp ?? 1);
    const lead = motion.leadTimeSeconds ?? DEFAULT_LEAD_TIME_S;
    const effectiveDt = lead * warp;
    const vx = motion.velocityBodyFixedMps[0];
    const vy = motion.velocityBodyFixedMps[1];
    const vz = motion.velocityBodyFixedMps[2];
    const speed = Math.hypot(vx, vy, vz) * warp;

    const futurePos: Vec3d = [
      currentCameraBodyFixedM[0] + vx * effectiveDt,
      currentCameraBodyFixedM[1] + vy * effectiveDt,
      currentCameraBodyFixedM[2] + vz * effectiveDt,
    ];

    const velDir: Vec3d | undefined =
      speed > 1 ? [vx / (speed / warp), vy / (speed / warp), vz / (speed / warp)] : undefined;

    return {
      evalCameraBodyFixedM: futurePos,
      evalForwardDir: currentForwardDir,
      velocityDirection: velDir,
      effectiveSpeedMps: speed,
      coneHalfAngleRad: DEFAULT_CONE_HALF_ANGLE_RAD,
    };
  }

  // 3. Automatic Estimated Camera Motion (Free camera, OrbitControls, Manual Pan/Rotate)
  if (estimatedCameraVelocityMps) {
    const vx = estimatedCameraVelocityMps[0];
    const vy = estimatedCameraVelocityMps[1];
    const vz = estimatedCameraVelocityMps[2];
    const speed = Math.hypot(vx, vy, vz);

    let futurePos = currentCameraBodyFixedM;
    let velDir: Vec3d | undefined;

    // Apply lead only for meaningful translational velocities (> 5 m/s)
    if (speed > 5) {
      const dt = 0.20;
      futurePos = [
        currentCameraBodyFixedM[0] + vx * dt,
        currentCameraBodyFixedM[1] + vy * dt,
        currentCameraBodyFixedM[2] + vz * dt,
      ];
      velDir = [vx / speed, vy / speed, vz / speed];
    }

    // Widen culling cone during fast camera swivels/rotations
    const isSwiveling = (estimatedAngularSpeedRadPerSec ?? 0) > 0.8;
    const coneAngle = isSwiveling ? EXPANDED_CONE_HALF_ANGLE_RAD : DEFAULT_CONE_HALF_ANGLE_RAD;

    return {
      evalCameraBodyFixedM: futurePos,
      evalForwardDir: currentForwardDir,
      velocityDirection: velDir,
      effectiveSpeedMps: speed,
      coneHalfAngleRad: coneAngle,
    };
  }

  // 4. Default Static
  return {
    evalCameraBodyFixedM: currentCameraBodyFixedM,
    evalForwardDir: currentForwardDir,
    velocityDirection: undefined,
    effectiveSpeedMps: 0,
    coneHalfAngleRad: DEFAULT_CONE_HALF_ANGLE_RAD,
  };
}
