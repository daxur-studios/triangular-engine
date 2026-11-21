/**
 * Shared pose, ground-sampling, and swappable locomotion plugin contracts
 * for the Capsule Human Sandbox motion race.
 *
 * Coordinate conventions (Three.js right-handed, character faces +Z):
 * - Left is -X (`side = -1`), Right is +X (`side = +1`), Up is +Y, Forward is +Z.
 * - `yaw` rotates around +Y; forward direction is `(sin(yaw), 0, cos(yaw))`.
 * - `pitch` > 0 leans torso/head forward toward +Z, or drops boot toe (toe-off).
 * - `roll` > 0 tilts torso top toward -X (left); `roll` < 0 tilts toward +X (right).
 */

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EulerLike {
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export interface FootPose {
  /** Local offset in meters relative to the boot's rest stance on the ground. */
  readonly offset: Vec3Like;
  /** Boot rotation in radians (`YXZ` order). Rig automatically prevents sole floor clipping. */
  readonly rotation: EulerLike;
  /** Optional 3D knee pole/mid-curve bend offset in meters (local space). */
  readonly kneeBend?: Vec3Like;
}

export interface HandPose {
  /** Offset in meters relative to the wrist's rest position inside `upperBody`. */
  readonly offset: Vec3Like;
  /** Glove rotation in radians (`YXZ` order) relative to `upperBody`. */
  readonly rotation: EulerLike;
  /** Optional 3D elbow pole/mid-curve bend offset in meters (torso-local space). */
  readonly elbowBend?: Vec3Like;
}

export interface CapsuleHumanPose {
  /** Pelvis/torso offset in meters relative to rest pelvis position. */
  readonly torsoOffset: Vec3Like;
  /** Torso tilt/twist/lean around pelvis (`YXZ` order, radians). */
  readonly torsoRotation: EulerLike;
  /** Additive head offset in meters relative to collar socket. */
  readonly headOffset: Vec3Like;
  /** Additive head rotation in radians relative to torso (`YXZ` order). */
  readonly headRotation: EulerLike;
  readonly leftFoot: FootPose;
  readonly rightFoot: FootPose;
  readonly leftHand: HandPose;
  readonly rightHand: HandPose;
  /** `1` restores the exact approved standing silhouette; `0` applies this pose fully. */
  readonly restBlend?: number;
}

export type PoseMask =
  | 'full-body'
  | 'lower-body'
  | 'upper-body'
  | 'left-arm'
  | 'right-arm'
  | 'head';

export interface GroundSample {
  /** World ground elevation (meters) at `(x, z)`. */
  readonly y: number;
  /** Unit surface normal at `(x, z)`. */
  readonly normal: Vec3Like;
}

export type GroundSampler = (worldX: number, worldZ: number) => GroundSample;

export interface RigMeasurements {
  readonly legLength: number;
  readonly hipHeight: number;
  readonly stanceHalfWidth: number;
  readonly armLength: number;
  readonly leftFootRestLocal: Vec3Like;
  readonly rightFootRestLocal: Vec3Like;
}

export type GravityPresetId = 'earth' | 'mars' | 'moon';

export interface GravityPreset {
  readonly id: GravityPresetId;
  readonly label: string;
  readonly gravityMps2: number;
  readonly ratioLabel: string;
}

export const EARTH_GRAVITY_MPS2 = 9.81;

export const GRAVITY_PRESETS: readonly GravityPreset[] = [
  { id: 'earth', label: 'Earth', gravityMps2: 9.81, ratioLabel: '1g' },
  { id: 'mars', label: 'Mars', gravityMps2: 3.72, ratioLabel: '0.38g' },
  { id: 'moon', label: 'Moon', gravityMps2: 1.62, ratioLabel: '0.16g' },
];

export function resolveGravityPreset(id?: string | null): GravityPreset {
  return GRAVITY_PRESETS.find((preset) => preset.id === id) ?? GRAVITY_PRESETS[0];
}

export interface LocomotionCommand {
  /** Desired world destination, or `null` when idle/settling. */
  readonly target: Vec3Like | null;
  /** Harness speed cap in meters/second. */
  readonly maxSpeed: number;
  readonly gait: 'walk' | 'run';
  readonly sampleGround: GroundSampler;
  /** Downward gravitational acceleration in m/s² (Earth = 9.81). */
  readonly gravity: number;
}

export interface LocomotionStateSnapshot {
  readonly position: Vec3Like;
  readonly yaw: number;
  readonly velocity: Vec3Like;
}

export interface LocomotionStepResult {
  readonly position: Vec3Like;
  readonly yaw: number;
  readonly pose: CapsuleHumanPose;
  readonly moving: boolean;
}

export interface LocomotionPlugin {
  readonly id: string;
  readonly label: string;
  readonly approach: string;
  readonly summary: string;
  reset(state: LocomotionStateSnapshot, rig: RigMeasurements): void;
  update(
    dt: number,
    command: LocomotionCommand,
    state: LocomotionStateSnapshot,
    rig: RigMeasurements,
  ): LocomotionStepResult;
}

export interface ActionUpdateContext {
  readonly dt: number;
  readonly elapsedSeconds: number;
  readonly rig: RigMeasurements;
  readonly sampleGround: GroundSampler;
  /** Downward gravitational acceleration in m/s² (Earth = 9.81). */
  readonly gravity: number;
}

export interface ActionStepResult {
  readonly pose: CapsuleHumanPose;
  readonly weight: number;
  readonly finished: boolean;
}

/**
 * Reserved Phase-2 slot for discrete world/gesture actions (pick up rock,
 * plant flag, sit, wave, point, beat-timed dance) layered over `LocomotionPlugin`
 * via `blendCapsuleHumanPoses` and `PoseMask`.
 */
export interface ActionPlugin {
  readonly id: string;
  readonly label: string;
  readonly mask: PoseMask;
  enter(context: ActionUpdateContext): void;
  update(context: ActionUpdateContext): ActionStepResult;
  cancel(): void;
}

export const ZERO_VEC3: Vec3Like = { x: 0, y: 0, z: 0 };
export const ZERO_EULER: EulerLike = { pitch: 0, yaw: 0, roll: 0 };

export const REST_CAPSULE_HUMAN_POSE: CapsuleHumanPose = {
  torsoOffset: ZERO_VEC3,
  torsoRotation: ZERO_EULER,
  headOffset: ZERO_VEC3,
  headRotation: ZERO_EULER,
  leftFoot: { offset: ZERO_VEC3, rotation: ZERO_EULER },
  rightFoot: { offset: ZERO_VEC3, rotation: ZERO_EULER },
  leftHand: { offset: ZERO_VEC3, rotation: ZERO_EULER },
  rightHand: { offset: ZERO_VEC3, rotation: ZERO_EULER },
  restBlend: 1,
};

export function createRestCapsuleHumanPose(): CapsuleHumanPose {
  return {
    torsoOffset: { ...ZERO_VEC3 },
    torsoRotation: { ...ZERO_EULER },
    headOffset: { ...ZERO_VEC3 },
    headRotation: { ...ZERO_EULER },
    leftFoot: { offset: { ...ZERO_VEC3 }, rotation: { ...ZERO_EULER } },
    rightFoot: { offset: { ...ZERO_VEC3 }, rotation: { ...ZERO_EULER } },
    leftHand: { offset: { ...ZERO_VEC3 }, rotation: { ...ZERO_EULER } },
    rightHand: { offset: { ...ZERO_VEC3 }, rotation: { ...ZERO_EULER } },
    restBlend: 1,
  };
}

export function createFlatGroundSampler(groundY = 0): GroundSampler {
  const normal: Vec3Like = { x: 0, y: 1, z: 0 };
  return () => ({ y: groundY, normal });
}

export function wrapAngle(radians: number): number {
  let angle = radians;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep01(t: number): number {
  const x = clampNumber(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function lerpVec3(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  return {
    x: lerpNumber(a.x, b.x, t),
    y: lerpNumber(a.y, b.y, t),
    z: lerpNumber(a.z, b.z, t),
  };
}

export function lerpEuler(a: EulerLike, b: EulerLike, t: number): EulerLike {
  return {
    pitch: lerpNumber(a.pitch, b.pitch, t),
    yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * t,
    roll: lerpNumber(a.roll, b.roll, t),
  };
}

function blendFoot(a: FootPose, b: FootPose, t: number): FootPose {
  const kneeA = a.kneeBend ?? ZERO_VEC3;
  const kneeB = b.kneeBend ?? ZERO_VEC3;
  const hasKnee = a.kneeBend !== undefined || b.kneeBend !== undefined;
  return {
    offset: lerpVec3(a.offset, b.offset, t),
    rotation: lerpEuler(a.rotation, b.rotation, t),
    ...(hasKnee ? { kneeBend: lerpVec3(kneeA, kneeB, t) } : {}),
  };
}

function blendHand(a: HandPose, b: HandPose, t: number): HandPose {
  const elbowA = a.elbowBend ?? ZERO_VEC3;
  const elbowB = b.elbowBend ?? ZERO_VEC3;
  const hasElbow = a.elbowBend !== undefined || b.elbowBend !== undefined;
  return {
    offset: lerpVec3(a.offset, b.offset, t),
    rotation: lerpEuler(a.rotation, b.rotation, t),
    ...(hasElbow ? { elbowBend: lerpVec3(elbowA, elbowB, t) } : {}),
  };
}

/**
 * Blends `overlay` onto `base` using a body `mask` and normalized `weight` in `[0, 1]`.
 */
export function blendCapsuleHumanPoses(
  base: CapsuleHumanPose,
  overlay: CapsuleHumanPose,
  weight: number,
  mask: PoseMask = 'full-body',
): CapsuleHumanPose {
  const t = clampNumber(weight, 0, 1);
  if (t <= 0) return base;

  const includeTorso =
    mask === 'full-body' || mask === 'lower-body' || mask === 'upper-body';
  const includeHead =
    mask === 'full-body' || mask === 'upper-body' || mask === 'head';
  const includeFeet = mask === 'full-body' || mask === 'lower-body';
  const includeLeftArm =
    mask === 'full-body' || mask === 'upper-body' || mask === 'left-arm';
  const includeRightArm =
    mask === 'full-body' || mask === 'upper-body' || mask === 'right-arm';

  const baseRest = base.restBlend ?? 0;
  const overlayRest = overlay.restBlend ?? 0;

  return {
    torsoOffset: includeTorso
      ? lerpVec3(base.torsoOffset, overlay.torsoOffset, t)
      : base.torsoOffset,
    torsoRotation: includeTorso
      ? lerpEuler(base.torsoRotation, overlay.torsoRotation, t)
      : base.torsoRotation,
    headOffset: includeHead
      ? lerpVec3(base.headOffset, overlay.headOffset, t)
      : base.headOffset,
    headRotation: includeHead
      ? lerpEuler(base.headRotation, overlay.headRotation, t)
      : base.headRotation,
    leftFoot: includeFeet
      ? blendFoot(base.leftFoot, overlay.leftFoot, t)
      : base.leftFoot,
    rightFoot: includeFeet
      ? blendFoot(base.rightFoot, overlay.rightFoot, t)
      : base.rightFoot,
    leftHand: includeLeftArm
      ? blendHand(base.leftHand, overlay.leftHand, t)
      : base.leftHand,
    rightHand: includeRightArm
      ? blendHand(base.rightHand, overlay.rightHand, t)
      : base.rightHand,
    restBlend:
      mask === 'full-body' ? lerpNumber(baseRest, overlayRest, t) : baseRest * (1 - t * 0.5),
  };
}

/** Converts a character-local delta `(lx, ly, lz)` into world delta for actor `yaw`. */
export function localToWorldDelta(local: Vec3Like, yaw: number): Vec3Like {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: local.x * cos + local.z * sin,
    y: local.y,
    z: -local.x * sin + local.z * cos,
  };
}

/** Converts a world delta `(dx, dy, dz)` into character-local coordinates for actor `yaw`. */
export function worldDeltaToLocal(delta: Vec3Like, yaw: number): Vec3Like {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: delta.x * cos - delta.z * sin,
    y: delta.y,
    z: delta.x * sin + delta.z * cos,
  };
}

/** Computes a foot's world rest position given root position, root yaw, and local rest stance. */
export function footRestWorldPosition(
  rootPos: Vec3Like,
  yaw: number,
  footRestLocal: Vec3Like,
): Vec3Like {
  const delta = localToWorldDelta(footRestLocal, yaw);
  return {
    x: rootPos.x + delta.x,
    y: rootPos.y + delta.y,
    z: rootPos.z + delta.z,
  };
}

/**
 * Converts a desired world foot placement back into the local `FootPose.offset`
 * relative to `footRestLocal` for the given root `position` and `yaw`.
 */
export function footWorldToLocalOffset(
  footWorld: Vec3Like,
  rootPos: Vec3Like,
  yaw: number,
  footRestLocal: Vec3Like,
): Vec3Like {
  const worldDelta: Vec3Like = {
    x: footWorld.x - rootPos.x,
    y: footWorld.y - rootPos.y,
    z: footWorld.z - rootPos.z,
  };
  const local = worldDeltaToLocal(worldDelta, yaw);
  return {
    x: local.x - footRestLocal.x,
    y: local.y - footRestLocal.y,
    z: local.z - footRestLocal.z,
  };
}
