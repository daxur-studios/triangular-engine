/**
 * Named face probes for the Capsule Doodle human: where the eyes, pupils, brows, nose and
 * mouth sit, computed from the DNA and the current face pose without any renderer. The
 * Three.js face rig places its meshes with these functions, so a probe and the rendered part
 * cannot drift apart.
 *
 * Every position is in the torso frame: the frame of the capsule body mesh, with +Y up the
 * body axis, +Z out of the face and the origin at the centre of the capsule's cylinder.
 */

import type { CharacterCapsule, CharacterEllipsoid } from './character-camera-projection';
import {
  characterQuaternionFromEuler,
  multiplyCharacterQuaternions,
  rotateCharacterVector3,
  type CharacterQuaternion,
} from './character-quaternion';
import type { CharacterVector3 } from './character-vector';
import type { CapsuleCharacterDNA } from './capsule-dna';
import type { CapsuleEyeRigPose, CapsuleSdfMouthUniforms } from './capsule-face-projection';

/** Which side of the face a probe belongs to. `left` is the character's own left side, at −X. */
export type CapsuleFaceSide = 'left' | 'right';

/** Depth of the eye white relative to its radius: the sclera is slightly flattened front to back. */
export const CAPSULE_SCLERA_DEPTH_SCALE = 0.94;
/** Distance of the pupil centre in front of the eye centre, in eye radii. */
export const CAPSULE_PUPIL_FORWARD_OFFSET = 0.9;
/** Depth of the pupil disc relative to its radius. */
export const CAPSULE_PUPIL_DEPTH_SCALE = 0.38;
/** Fraction of the pose's gaze yaw and pitch applied to the pupil pivot. */
export const CAPSULE_GAZE_ROTATION_SCALE = 0.75;

/** Mouth shader values for a neutral face: the body material's initial uniform values. */
export const CAPSULE_NEUTRAL_MOUTH: Pick<
  CapsuleSdfMouthUniforms,
  'mouthOpen' | 'mouthWidth' | 'mouthCurve' | 'mouthWave'
> = { mouthOpen: 0.12, mouthWidth: 0.62, mouthCurve: 0.25, mouthWave: 0 };

/** Placement of one eye: the eye root's position and yaw, and the eye-white radius. */
export interface CapsuleEyePlacement {
  readonly side: CapsuleFaceSide;
  /** −1 for the left eye, +1 for the right eye. */
  readonly sign: -1 | 1;
  /** Angle of the eye around the body axis from the face's forward direction, in radians. */
  readonly angle: number;
  /** Eye-white radius in metres. */
  readonly radius: number;
  /** Eye centre. */
  readonly position: CharacterVector3;
  /** Rotation of the eye root about +Y, in radians. */
  readonly yaw: number;
}

/** Rest placement of one floating eyebrow; the pose adds a height offset and a Z roll. */
export interface CapsuleBrowPlacement {
  readonly side: CapsuleFaceSide;
  readonly position: CharacterVector3;
  /** Rotation about +Y, in radians. */
  readonly yaw: number;
}

/** Placement of the button nose. */
export interface CapsuleNosePlacement {
  readonly position: CharacterVector3;
  /** Radius of the nose sphere before its DNA scale and its (1.08, 0.88, 0.95) shape scale. */
  readonly baseRadius: number;
  /** Uniform scale from `dna.noseScale`, at least 0.01. */
  readonly scale: number;
  /** False when the DNA turns the nose off. */
  readonly visible: boolean;
}

/** Size of the mouth in the body shader's face coordinates, in body radii. */
export interface CapsuleMouthShape {
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** Radius of the two upper corners. */
  readonly topCornerRadius: number;
  /** Radius of the two lower corners. */
  readonly bottomCornerRadius: number;
}

/** Mouth probes on the body surface. */
export interface CapsuleMouthProbes {
  /** Centre line height of the mouth on the face, on the body surface. */
  readonly center: CharacterVector3;
  /** Character's left mouth corner (−X): the outermost point of the mouth shape. */
  readonly left: CharacterVector3;
  /** Character's right mouth corner (+X). */
  readonly right: CharacterVector3;
  readonly shape: CapsuleMouthShape;
}

/** Probes for one eye. */
export interface CapsuleEyeProbes {
  readonly placement: CapsuleEyePlacement;
  /** The eye white. */
  readonly sclera: CharacterEllipsoid;
  /** The pupil disc, turned by the pose's gaze. */
  readonly pupil: CharacterEllipsoid;
  /** Centre of the pupil disc, which is also `pupil.center`. */
  readonly pupilCenter: CharacterVector3;
}

/** Probes for the head: the body capsule and where its skin starts. */
export interface CapsuleHeadProbes {
  /** The body capsule; its axis is the head axis. */
  readonly capsule: CharacterCapsule;
  /** Skin covers the capsule above this height; the suit covers it below. */
  readonly skinBottomY: number;
  /** Height of the top of the head. */
  readonly topY: number;
}

/** All named face probes for one character and pose. */
export interface CapsuleFaceProbes {
  readonly head: CapsuleHeadProbes;
  readonly leftEye: CapsuleEyeProbes;
  readonly rightEye: CapsuleEyeProbes;
  readonly leftBrow: CapsuleBrowPlacement;
  readonly rightBrow: CapsuleBrowPlacement;
  readonly nose: CapsuleNosePlacement;
  readonly mouth: CapsuleMouthProbes;
}

/** The parts of a face pose that move probes. Fields left out take neutral values. */
export interface CapsuleFaceProbePose {
  readonly mouth?: Pick<CapsuleSdfMouthUniforms, 'mouthOpen' | 'mouthWidth' | 'mouthCurve' | 'mouthWave'>;
  readonly leftEye?: Pick<CapsuleEyeRigPose, 'gazeYaw' | 'gazePitch' | 'pupilScale'>;
  readonly rightEye?: Pick<CapsuleEyeRigPose, 'gazeYaw' | 'gazePitch' | 'pupilScale'>;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function sideSign(side: CapsuleFaceSide): -1 | 1 {
  return side === 'left' ? -1 : 1;
}

function eyeAngle(dna: CapsuleCharacterDNA, sign: -1 | 1): number {
  return sign * Math.max(0.45, dna.eyeSpacing * 1.72);
}

function eyeRadius(dna: CapsuleCharacterDNA, sign: -1 | 1): number {
  const sizeAsym = (dna.eyeSizeAsymmetry ?? 0) * sign * 0.5;
  return dna.bodyRadius * 0.385 * Math.max(0.55, dna.eyeScale * (1 + sizeAsym));
}

function eyeHeight(dna: CapsuleCharacterDNA, sign: -1 | 1): number {
  const heightShift = (dna.eyeHeightAsymmetry ?? 0) * sign * dna.bodyRadius;
  return dna.suitSplitY + dna.bodyHeight * 0.365 + dna.bodyRadius * 0.04 + heightShift;
}

/** Places one googly eye on the upper front of the head. */
export function computeCapsuleEyePlacement(dna: CapsuleCharacterDNA, side: CapsuleFaceSide): CapsuleEyePlacement {
  const sign = sideSign(side);
  const angle = eyeAngle(dna, sign);
  const r = dna.bodyRadius;
  return {
    side,
    sign,
    angle,
    radius: eyeRadius(dna, sign),
    position: { x: Math.sin(angle) * r * 1.04, y: eyeHeight(dna, sign), z: Math.cos(angle) * r * 1.08 },
    yaw: angle * 0.38,
  };
}

/** Rest placement of one eyebrow, just above its eye. */
export function computeCapsuleBrowPlacement(dna: CapsuleCharacterDNA, side: CapsuleFaceSide): CapsuleBrowPlacement {
  const sign = sideSign(side);
  const angle = eyeAngle(dna, sign);
  const r = dna.bodyRadius;
  return {
    side,
    position: {
      x: Math.sin(angle) * r * 0.96,
      y: eyeHeight(dna, sign) + eyeRadius(dna, sign) * 1.03,
      z: Math.cos(angle) * r * 1.08,
    },
    yaw: angle * 0.55,
  };
}

/** Places the button nose on the front of the head. */
export function computeCapsuleNosePlacement(dna: CapsuleCharacterDNA): CapsuleNosePlacement {
  const scale = Math.max(0, dna.noseScale ?? 0);
  return {
    position: { x: 0, y: dna.suitSplitY + dna.bodyHeight * 0.245, z: dna.bodyRadius * 0.99 },
    baseRadius: dna.bodyRadius * 0.082,
    scale: Math.max(0.01, scale),
    visible: scale > 0.01,
  };
}

/** Height of the mouth's centre line in the torso frame (the body shader's `uMouthCenterY`). */
export function computeCapsuleMouthCenterY(dna: CapsuleCharacterDNA): number {
  return dna.suitSplitY + dna.bodyHeight * 0.16;
}

/** Mouth size and corner radii in body radii, exactly as the body shader computes them. */
export function computeCapsuleMouthShape(
  mouth: Pick<CapsuleSdfMouthUniforms, 'mouthOpen' | 'mouthWidth' | 'mouthCurve'>,
): CapsuleMouthShape {
  const halfWidth = clamp(mouth.mouthWidth * 0.34, 0.08, 0.42);
  const halfHeight = mix(0.014, 0.19, clamp(mouth.mouthOpen, 0, 1));
  const maxR = Math.min(halfWidth, halfHeight) * 0.95;
  return {
    halfWidth,
    halfHeight,
    topCornerRadius: mix(maxR * 0.85, maxR * 0.28, clamp(mouth.mouthCurve, 0, 1)),
    bottomCornerRadius: mix(maxR * 0.85, maxR * 0.28, clamp(-mouth.mouthCurve, 0, 1)),
  };
}

/**
 * Depth of the body capsule's front surface at torso-frame `(x, y)`, or `NaN` when that point
 * is outside the capsule's outline seen from the front.
 */
export function computeCapsuleFrontSurfaceZ(dna: CapsuleCharacterDNA, x: number, y: number): number {
  const r = dna.bodyRadius;
  const half = dna.bodyHeight / 2;
  const dy = Math.max(0, Math.abs(y) - half);
  const z2 = r * r - x * x - dy * dy;
  return z2 >= 0 ? Math.sqrt(z2) : Number.NaN;
}

/**
 * Mouth centre and corners on the body surface. A corner is the outermost point of the shader's
 * rounded-box mouth, halfway along its straight side, after the smile curve and the wave are
 * applied.
 */
export function computeCapsuleMouthProbes(
  dna: CapsuleCharacterDNA,
  mouth: Pick<CapsuleSdfMouthUniforms, 'mouthOpen' | 'mouthWidth' | 'mouthCurve' | 'mouthWave'> = CAPSULE_NEUTRAL_MOUTH,
): CapsuleMouthProbes {
  const r = Math.max(0.15, dna.bodyRadius);
  const centerY = computeCapsuleMouthCenterY(dna);
  const shape = computeCapsuleMouthShape(mouth);
  const halfW = shape.halfWidth;
  // Middle of the straight side of the rounded box, in shader face units.
  const sideMidY = (shape.bottomCornerRadius - shape.topCornerRadius) / 2;
  const corner = (sign: -1 | 1): CharacterVector3 => {
    const mx = sign * halfW;
    const xNorm = clamp(mx / Math.max(0.05, halfW), -1.5, 1.5);
    const parabola = (xNorm * xNorm - 0.35) * mouth.mouthCurve * 0.085;
    const wave = Math.sin(mx * 28) * mouth.mouthWave * 0.024;
    const x = mx * r;
    const y = centerY + (sideMidY + parabola + wave) * r;
    return { x, y, z: computeCapsuleFrontSurfaceZ(dna, x, y) };
  };
  return {
    center: { x: 0, y: centerY, z: computeCapsuleFrontSurfaceZ(dna, 0, centerY) },
    left: corner(-1),
    right: corner(1),
    shape,
  };
}

function scaledAxes(q: CharacterQuaternion, sx: number, sy: number, sz: number): CharacterEllipsoid['axes'] {
  return [
    rotateCharacterVector3(q, { x: sx, y: 0, z: 0 }),
    rotateCharacterVector3(q, { x: 0, y: sy, z: 0 }),
    rotateCharacterVector3(q, { x: 0, y: 0, z: sz }),
  ];
}

/** Eye-white and pupil probes for one eye in the given gaze. */
export function computeCapsuleEyeProbes(
  dna: CapsuleCharacterDNA,
  side: CapsuleFaceSide,
  pose: Pick<CapsuleEyeRigPose, 'gazeYaw' | 'gazePitch' | 'pupilScale'> = {
    gazeYaw: 0,
    gazePitch: 0,
    pupilScale: dna.pupilScale,
  },
): CapsuleEyeProbes {
  const placement = computeCapsuleEyePlacement(dna, side);
  const er = placement.radius;
  const rootQ = characterQuaternionFromEuler(0, placement.yaw, 0);
  const gazeQ = multiplyCharacterQuaternions(
    rootQ,
    characterQuaternionFromEuler(pose.gazePitch * CAPSULE_GAZE_ROTATION_SCALE, pose.gazeYaw * CAPSULE_GAZE_ROTATION_SCALE, 0),
  );
  const forward = rotateCharacterVector3(gazeQ, { x: 0, y: 0, z: er * CAPSULE_PUPIL_FORWARD_OFFSET });
  const c = placement.position;
  const pupilCenter = { x: c.x + forward.x, y: c.y + forward.y, z: c.z + forward.z };
  const p = pose.pupilScale * er;
  return {
    placement,
    sclera: { center: c, axes: scaledAxes(rootQ, er, er, er * CAPSULE_SCLERA_DEPTH_SCALE) },
    pupil: { center: pupilCenter, axes: scaledAxes(gazeQ, p, p, p * CAPSULE_PUPIL_DEPTH_SCALE) },
    pupilCenter,
  };
}

/** Head probes: the body capsule and the height where skin starts. */
export function computeCapsuleHeadProbes(dna: CapsuleCharacterDNA): CapsuleHeadProbes {
  const half = dna.bodyHeight / 2;
  return {
    capsule: { start: { x: 0, y: -half, z: 0 }, end: { x: 0, y: half, z: 0 }, radius: dna.bodyRadius },
    skinBottomY: dna.suitSplitY,
    topY: half + dna.bodyRadius,
  };
}

/** Computes every named face probe for a character in a pose (neutral when `pose` is omitted). */
export function computeCapsuleFaceProbes(dna: CapsuleCharacterDNA, pose: CapsuleFaceProbePose = {}): CapsuleFaceProbes {
  return {
    head: computeCapsuleHeadProbes(dna),
    leftEye: computeCapsuleEyeProbes(dna, 'left', pose.leftEye),
    rightEye: computeCapsuleEyeProbes(dna, 'right', pose.rightEye),
    leftBrow: computeCapsuleBrowPlacement(dna, 'left'),
    rightBrow: computeCapsuleBrowPlacement(dna, 'right'),
    nose: computeCapsuleNosePlacement(dna),
    mouth: computeCapsuleMouthProbes(dna, pose.mouth),
  };
}
