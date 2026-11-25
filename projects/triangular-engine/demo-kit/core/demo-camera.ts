import type { Vector3Tuple } from 'three';

/** Camera modes a video recipe can ask for. `static` keeps a fixed spot and only turns to follow the subject. */
export type DemoCameraMode = 'static' | 'chase' | 'side' | 'free';

export interface IDemoCameraRequest {
  readonly mode: DemoCameraMode;
  /** Subject position in world metres. */
  readonly subjectM: Vector3Tuple;
  /** Subject velocity in world metres per second (chase and side use it for direction). */
  readonly velocityMps?: Vector3Tuple;
  /** World position of a `static` camera. Required for `static`. */
  readonly staticPositionM?: Vector3Tuple;
  /** Distance behind or beside the subject for `chase` and `side`. */
  readonly distanceM?: number;
  /** World up for the scene (surface normal for a planet). Defaults to +Y. */
  readonly up?: Vector3Tuple;
}

export interface IDemoCameraView {
  readonly positionM: Vector3Tuple;
  readonly targetM: Vector3Tuple;
  /** Vertical field of view that frames `framingM` around the subject, or undefined to leave it. */
  readonly fovDeg?: number;
}

const DEFAULT_DISTANCE_M = 120;
const MIN_FOV_DEG = 0.5;
const MAX_FOV_DEG = 60;

/** Vertical field of view in degrees that makes `framingM` metres fill the frame height at `distanceM`. */
export function fovForFraming(framingM: number, distanceM: number): number {
  if (!(framingM > 0) || !(distanceM > 0)) return MAX_FOV_DEG;
  const deg = (2 * Math.atan(framingM / 2 / distanceM) * 180) / Math.PI;
  return Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, deg));
}

function sub(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(a: Vector3Tuple): number { return Math.hypot(a[0], a[1], a[2]); }
function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function scaleTo(a: Vector3Tuple, length: number): Vector3Tuple {
  const l = len(a) || 1;
  return [(a[0] / l) * length, (a[1] / l) * length, (a[2] / l) * length];
}

/**
 * Where the camera should be this frame. Pure: the host applies the result with its own camera API,
 * so floating origins and orbit-follow rigs stay the host's business.
 */
export function computeDemoCameraView(request: IDemoCameraRequest, framingM?: number): IDemoCameraView | undefined {
  const { mode, subjectM, velocityMps, staticPositionM, up = [0, 1, 0] } = request;
  const distanceM = request.distanceM ?? DEFAULT_DISTANCE_M;
  if (mode === 'free') return undefined;
  if (mode === 'static') {
    if (!staticPositionM) return undefined;
    const range = len(sub(subjectM, staticPositionM));
    return { positionM: staticPositionM, targetM: subjectM, fovDeg: framingM ? fovForFraming(framingM, range) : undefined };
  }
  const heading = velocityMps && len(velocityMps) > 1e-3 ? velocityMps : up;
  if (mode === 'chase') {
    const back = scaleTo(heading, -distanceM);
    return { positionM: [subjectM[0] + back[0], subjectM[1] + back[1], subjectM[2] + back[2]], targetM: subjectM, fovDeg: framingM ? fovForFraming(framingM, distanceM) : undefined };
  }
  const side = scaleTo(cross(heading, up), distanceM);
  return { positionM: [subjectM[0] + side[0], subjectM[1] + side[1], subjectM[2] + side[2]], targetM: subjectM, fovDeg: framingM ? fovForFraming(framingM, distanceM) : undefined };
}
