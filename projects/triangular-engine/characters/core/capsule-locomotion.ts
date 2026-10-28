/**
 * Framework-free 3-point Quadratic Bezier limb IK, rubber-hose gait cycles,
 * hand action targeting, and second-order spring-damper secondary motion for
 * Capsule Doodle characters.
 */

import type { CapsuleCharacterDNA, CapsuleHandPoseId } from './capsule-dna';
import {
  characterVector3,
  characterVectorAdd,
  characterVectorCross,
  characterVectorDot,
  characterVectorLength,
  characterVectorScale,
  characterVectorSubtract,
  normalizeCharacterVector3,
  type CharacterVector3,
} from './character-vector';

export type CapsuleLocomotionMode = 'idle' | 'walk' | 'run' | 'float';

export type CapsuleHandActionMode =
  | 'none'
  | 'wave'
  | 'point'
  | 'hold_gadget'
  | 'salute'
  | 'reach';

export interface RubberHoseLimbSolution {
  /** Start attachment socket on the capsule body ($P_0$). */
  readonly p0: CharacterVector3;
  /** Quadratic Bezier control point / elbow or knee bend ($P_1$). */
  readonly p1: CharacterVector3;
  /** Clamped wrist or ankle target position ($P_2$). */
  readonly p2: CharacterVector3;
  /** Normalized curve tangent at $t = 1$ ($\propto P_2 - P_1$) for orienting hands/boots. */
  readonly endTangent: CharacterVector3;
  /** Whether the target was within the limb's maximum reach. */
  readonly reached: boolean;
}

export interface CapsuleHandActionRequest {
  readonly mode: CapsuleHandActionMode;
  /** Optional local-space target when `mode === 'reach'` or `'point'`. */
  readonly target?: CharacterVector3;
}

export interface CapsuleLocomotionInput {
  readonly mode: CapsuleLocomotionMode;
  readonly elapsedSeconds: number;
  readonly dna: CapsuleCharacterDNA;
  /** Optional normalized movement speed multiplier ([0.25, 2.5], default 1.0). */
  readonly speedMultiplier?: number;
  readonly leftHandAction?: CapsuleHandActionRequest;
  readonly rightHandAction?: CapsuleHandActionRequest;
}

export interface CapsuleLocomotionSample {
  /** Phase angle $\phi$ in radians. */
  readonly phase: number;
  /** Vertical bounce offset of the capsule torso in meters. */
  readonly bodyBounceY: number;
  /** Side-to-side hip sway offset in meters. */
  readonly bodySwayX: number;
  /** Forward velocity tilt (pitch around X axis in radians). */
  readonly bodyTiltX: number;
  /** Subtle side roll (around Z axis in radians). */
  readonly bodyRollZ: number;
  /** Subtle torso twist (around Y axis in radians). */
  readonly bodyYawY: number;
  readonly leftLeg: RubberHoseLimbSolution;
  readonly rightLeg: RubberHoseLimbSolution;
  readonly leftArm: RubberHoseLimbSolution;
  readonly rightArm: RubberHoseLimbSolution;
  readonly leftFootPitch: number;
  readonly rightFootPitch: number;
  readonly leftHandPose: CapsuleHandPoseId;
  readonly rightHandPose: CapsuleHandPoseId;
}

export interface SpringDamper3DState {
  readonly position: CharacterVector3;
  readonly velocity: CharacterVector3;
}

export interface SpringDamper3DConfig {
  /** Spring stiffness ($k$, default 140). */
  readonly stiffness?: number;
  /** Damping coefficient ($c$, default 16). */
  readonly damping?: number;
  /** Maximum displacement radius in meters (default 0.12). */
  readonly maxDisplacement?: number;
}

/**
 * Analytical 3-point Quadratic Bezier limb solver for rubber-hose arms and legs.
 *
 * Given attachment point $P_0$, target $P_2$, total limb length $L$, and a preferred
 * bend pole direction, computes the quadratic control point $P_1$ so the curve arches
 * smoothly in the pole plane like a classic rubber-hose cartoon limb.
 */
export function solveRubberHoseLimb(
  p0: CharacterVector3,
  targetP2: CharacterVector3,
  limbLength: number,
  poleDirection: CharacterVector3,
  bendMultiplier = 1.15,
): RubberHoseLimbSolution {
  const toTarget = characterVectorSubtract(targetP2, p0);
  const rawDist = characterVectorLength(toTarget);
  const maxReach = Math.max(0.05, limbLength * 0.98);
  const minReach = Math.max(0.02, limbLength * 0.15);
  const clampedDist = Math.max(minReach, Math.min(maxReach, rawDist));
  const reached = rawDist <= maxReach;

  const axis =
    rawDist > 1e-6
      ? characterVectorScale(toTarget, 1 / rawDist)
      : characterVector3(0, -1, 0);

  const p2 = characterVectorAdd(p0, characterVectorScale(axis, clampedDist));
  const midPoint = characterVectorAdd(p0, characterVectorScale(axis, clampedDist * 0.5));

  // Project poleDirection perpendicular to the limb axis
  const dot = characterVectorDot(poleDirection, axis);
  let perp = characterVectorSubtract(poleDirection, characterVectorScale(axis, dot));
  if (characterVectorLength(perp) < 1e-5) {
    const fallback = Math.abs(axis.y) < 0.9 ? characterVector3(0, 1, 0) : characterVector3(0, 0, 1);
    perp = characterVectorCross(axis, fallback);
  }
  const bendDir = normalizeCharacterVector3({ ...perp });

  // Right-triangle height from two equal halves of length L/2
  const halfLen = limbLength * 0.5;
  const halfChord = clampedDist * 0.5;
  const sagitta = Math.sqrt(Math.max(0, halfLen * halfLen - halfChord * halfChord)) * bendMultiplier;

  const p1 = characterVectorAdd(midPoint, characterVectorScale(bendDir, sagitta));
  const tangentRaw = characterVectorSubtract(p2, p1);
  const endTangent =
    characterVectorLength(tangentRaw) > 1e-6
      ? normalizeCharacterVector3({ ...tangentRaw })
      : axis;

  return {
    p0,
    p1,
    p2,
    endTangent,
    reached,
  };
}

/**
 * Evaluates a point on a 3-point Quadratic Bezier curve at $t \in [0, 1]$:
 * $\mathbf{B}(t) = (1-t)^2 P_0 + 2(1-t)t P_1 + t^2 P_2$.
 */
export function evaluateQuadraticBezierPoint(
  p0: CharacterVector3,
  p1: CharacterVector3,
  p2: CharacterVector3,
  t: number,
): CharacterVector3 {
  const u = 1 - t;
  const w0 = u * u;
  const w1 = 2 * u * t;
  const w2 = t * t;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y,
    z: w0 * p0.z + w1 * p1.z + w2 * p2.z,
  };
}

/**
 * Evaluates the normalized first derivative (tangent) on a 3-point Quadratic Bezier curve at $t \in [0, 1]$:
 * $\mathbf{B}'(t) = 2(1-t)(P_1 - P_0) + 2t(P_2 - P_1)$.
 */
export function evaluateQuadraticBezierTangent(
  p0: CharacterVector3,
  p1: CharacterVector3,
  p2: CharacterVector3,
  t: number,
): CharacterVector3 {
  const u = 1 - t;
  const dx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const dy = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  const dz = 2 * u * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
  return normalizeCharacterVector3({ x: dx, y: dy, z: dz });
}

function resolveHandActionTarget(
  side: 'left' | 'right',
  action: CapsuleHandActionRequest | undefined,
  defaultWrist: CharacterVector3,
  shoulder: CharacterVector3,
  dna: CapsuleCharacterDNA,
  elapsed: number,
): { target: CharacterVector3; pole: CharacterVector3; pose: CapsuleHandPoseId } {
  const sign = side === 'left' ? -1 : 1;
  const r = dna.bodyRadius;
  const h = dna.bodyHeight;
  const mode = action?.mode ?? 'none';

  switch (mode) {
    case 'wave': {
      const waveOsc = Math.sin(elapsed * 9.5) * 0.11;
      return {
        target: characterVector3(
          sign * (r + 0.24) + waveOsc * sign,
          shoulder.y + h * 0.42 + Math.cos(elapsed * 9.5) * 0.03,
          0.16,
        ),
        pole: characterVector3(sign * 0.7, -0.65, -0.25),
        pose: 'wave',
      };
    }
    case 'point': {
      const custom = action?.target;
      return {
        target:
          custom ??
          characterVector3(sign * (r * 0.85), shoulder.y + 0.06, r + 0.42),
        pole: characterVector3(sign * 0.8, -0.45, -0.2),
        pose: 'point',
      };
    }
    case 'hold_gadget': {
      const bob = Math.sin(elapsed * 2.6) * 0.015;
      return {
        target: characterVector3(
          sign * (r * 0.82),
          shoulder.y + 0.02 + bob,
          r + 0.26,
        ),
        pole: characterVector3(sign * 0.75, -0.7, -0.35),
        pose: 'grip',
      };
    }
    case 'salute': {
      return {
        target: characterVector3(
          sign * (r * 0.78),
          shoulder.y + h * 0.46,
          r * 0.82,
        ),
        pole: characterVector3(sign * 0.9, -0.1, 0.25),
        pose: 'open',
      };
    }
    case 'reach': {
      return {
        target: action?.target ?? defaultWrist,
        pole: characterVector3(sign * 0.7, -0.6, -0.3),
        pose: 'open',
      };
    }
    case 'none':
    default:
      return {
        target: defaultWrist,
        pole: characterVector3(sign * 0.65, -0.35, -0.75),
        pose: dna.accessory === 'walkie_talkie' && side === 'left' ? 'grip' : 'open',
      };
  }
}

/**
 * Samples the procedural rubber-hose locomotion state (torso bounce/tilt + 4 Bezier limbs)
 * at `elapsedSeconds`.
 */
export function sampleCapsuleLocomotion(
  input: CapsuleLocomotionInput,
): CapsuleLocomotionSample {
  const { mode, elapsedSeconds, dna } = input;
  const speed = clampSpeed(input.speedMultiplier ?? 1.0);
  const r = dna.bodyRadius;
  const h = dna.bodyHeight;

  // Base geometry metrics:
  // Ground is Y = 0. Boot ankle sits at Y = bootHeight (0.13m).
  // Hip sockets sit at bottom of capsule torso around Y = legLength + bootHeight.
  const bootAnkleY = 0.13;
  const legLength = 0.56;
  const armLength = 0.54;
  const hipBaseY = bootAnkleY + legLength * 0.92; // ~0.645m
  const capsuleCenterBaseY = hipBaseY + r * 0.65 + h * 0.5;

  const hipOffsetX = r * 0.44;
  const shoulderOffsetX = r * 0.94;
  const shoulderOffsetY = capsuleCenterBaseY - h * 0.08;

  let freq = 2.0;
  let strideLength = 0;
  let stepHeight = 0;
  let bounceAmp = 0.012;
  let bodyTiltX = 0;
  let bodySwayAmp = 0.008;
  let armSwingZ = 0.04;
  let armLiftY = 0.015;

  if (mode === 'walk') {
    freq = 4.6 * speed;
    strideLength = 0.24 * speed;
    stepHeight = 0.12;
    bounceAmp = 0.042;
    bodyTiltX = 0.08 * speed;
    bodySwayAmp = 0.025;
    armSwingZ = 0.22 * speed;
    armLiftY = 0.06;
  } else if (mode === 'run') {
    freq = 7.4 * speed;
    strideLength = 0.36 * speed;
    stepHeight = 0.22;
    bounceAmp = 0.085;
    bodyTiltX = 0.20 * speed;
    bodySwayAmp = 0.035;
    armSwingZ = 0.34 * speed;
    armLiftY = 0.14;
  } else if (mode === 'float') {
    freq = 1.8 * speed;
    strideLength = 0.08;
    stepHeight = 0.06;
    bounceAmp = 0.11;
    bodyTiltX = -0.06;
    bodySwayAmp = 0.04;
    armSwingZ = 0.10;
    armLiftY = 0.18;
  }

  const phase = elapsedSeconds * freq;
  const leftPhase = phase;
  const rightPhase = phase + Math.PI;

  const bodyBounceY =
    mode === 'idle'
      ? Math.sin(phase) * bounceAmp
      : mode === 'float'
        ? 0.22 + Math.sin(phase) * bounceAmp
        : Math.abs(Math.sin(phase)) * bounceAmp;

  const bodySwayX = Math.cos(phase) * bodySwayAmp;
  const bodyRollZ = -Math.cos(phase) * (mode === 'run' ? 0.06 : mode === 'walk' ? 0.035 : 0.01);
  const bodyYawY = Math.cos(phase) * (mode === 'run' ? 0.12 : mode === 'walk' ? 0.07 : 0.015);

  // Hip socket positions on the bouncing capsule
  const leftHipP0 = characterVector3(-hipOffsetX + bodySwayX, hipBaseY + bodyBounceY, 0);
  const rightHipP0 = characterVector3(hipOffsetX + bodySwayX, hipBaseY + bodyBounceY, 0);

  // Foot targets along parametric arc: z = cos(phi) * strideLength, y = max(0, sin(phi)) * stepHeight
  const leftStepSin = Math.sin(leftPhase);
  const rightStepSin = Math.sin(rightPhase);

  const leftFootZ = mode === 'idle' ? 0.02 : Math.cos(leftPhase) * strideLength;
  const rightFootZ = mode === 'idle' ? -0.02 : Math.cos(rightPhase) * strideLength;

  const leftFootY =
    mode === 'float'
      ? bootAnkleY + 0.14 + Math.sin(leftPhase) * stepHeight
      : bootAnkleY + Math.max(0, leftStepSin) * stepHeight;
  const rightFootY =
    mode === 'float'
      ? bootAnkleY + 0.10 + Math.sin(rightPhase) * stepHeight
      : bootAnkleY + Math.max(0, rightStepSin) * stepHeight;

  const leftAnkleTarget = characterVector3(-hipOffsetX * 1.08, leftFootY, leftFootZ);
  const rightAnkleTarget = characterVector3(hipOffsetX * 1.08, rightFootY, rightFootZ);

  // Knee pole bends forward (+Z) and slightly outward
  const leftKneePole = characterVector3(-0.18, 0.1, 1.0);
  const rightKneePole = characterVector3(0.18, 0.1, 1.0);

  const leftLeg = solveRubberHoseLimb(leftHipP0, leftAnkleTarget, legLength, leftKneePole, 1.1);
  const rightLeg = solveRubberHoseLimb(rightHipP0, rightAnkleTarget, legLength, rightKneePole, 1.1);

  const leftFootPitch =
    mode === 'idle'
      ? 0
      : mode === 'float'
        ? 0.35 + Math.sin(leftPhase) * 0.15
        : -Math.sin(leftPhase) * (mode === 'run' ? 0.45 : 0.26);
  const rightFootPitch =
    mode === 'idle'
      ? 0
      : mode === 'float'
        ? 0.42 + Math.sin(rightPhase) * 0.15
        : -Math.sin(rightPhase) * (mode === 'run' ? 0.45 : 0.26);

  // Shoulder socket positions
  const leftShoulderP0 = characterVector3(
    -shoulderOffsetX + bodySwayX,
    shoulderOffsetY + bodyBounceY,
    0,
  );
  const rightShoulderP0 = characterVector3(
    shoulderOffsetX + bodySwayX,
    shoulderOffsetY + bodyBounceY,
    0,
  );

  // Counter-phase default wrist swing (left arm swings forward with right leg)
  const leftArmSwing = Math.cos(rightPhase) * armSwingZ;
  const rightArmSwing = Math.cos(leftPhase) * armSwingZ;

  const defaultLeftWrist = characterVector3(
    -(r + 0.16) + bodySwayX,
    shoulderOffsetY - armLength * 0.72 + bodyBounceY + armLiftY + Math.max(0, leftArmSwing) * 0.35,
    leftArmSwing,
  );
  const defaultRightWrist = characterVector3(
    r + 0.16 + bodySwayX,
    shoulderOffsetY - armLength * 0.72 + bodyBounceY + armLiftY + Math.max(0, rightArmSwing) * 0.35,
    rightArmSwing,
  );

  // Automatic walkie-talkie hold if accessory is equipped and no explicit left-hand override
  const effectiveLeftAction: CapsuleHandActionRequest | undefined =
    input.leftHandAction ??
    (dna.accessory === 'walkie_talkie' || dna.accessory === 'flag'
      ? { mode: 'hold_gadget' }
      : undefined);

  const leftHandSpec = resolveHandActionTarget(
    'left',
    effectiveLeftAction,
    defaultLeftWrist,
    leftShoulderP0,
    dna,
    elapsedSeconds,
  );
  const rightHandSpec = resolveHandActionTarget(
    'right',
    input.rightHandAction,
    defaultRightWrist,
    rightShoulderP0,
    dna,
    elapsedSeconds,
  );

  const leftArm = solveRubberHoseLimb(
    leftShoulderP0,
    leftHandSpec.target,
    armLength,
    leftHandSpec.pole,
    1.18,
  );
  const rightArm = solveRubberHoseLimb(
    rightShoulderP0,
    rightHandSpec.target,
    armLength,
    rightHandSpec.pole,
    1.18,
  );

  const defaultHandPose: CapsuleHandPoseId = mode === 'run' ? 'fist' : 'open';

  return {
    phase,
    bodyBounceY,
    bodySwayX,
    bodyTiltX,
    bodyRollZ,
    bodyYawY,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    leftFootPitch,
    rightFootPitch,
    leftHandPose:
      effectiveLeftAction && effectiveLeftAction.mode !== 'none'
        ? leftHandSpec.pose
        : defaultHandPose,
    rightHandPose:
      input.rightHandAction && input.rightHandAction.mode !== 'none'
        ? rightHandSpec.pose
        : defaultHandPose,
  };
}

function clampSpeed(s: number): number {
  if (!Number.isFinite(s)) return 1.0;
  return Math.max(0.25, Math.min(2.5, s));
}

/**
 * Steps a 3D second-order spring-damper toward `target`, returning the updated position and velocity.
 * Used for secondary motion on jetpack backpacks and modular hair chunks.
 */
export function stepSpringDamper3D(
  state: SpringDamper3DState,
  target: CharacterVector3,
  deltaSeconds: number,
  config: SpringDamper3DConfig = {},
): SpringDamper3DState {
  const dt = Math.max(0, Math.min(0.05, deltaSeconds));
  if (dt === 0) return state;

  const k = config.stiffness ?? 140;
  const c = config.damping ?? 16;
  const maxDisp = config.maxDisplacement ?? 0.12;

  const disp = characterVectorSubtract(state.position, target);
  const springForce = characterVectorScale(disp, -k);
  const dampingForce = characterVectorScale(state.velocity, -c);
  const accel = characterVectorAdd(springForce, dampingForce);

  const nextVel = characterVectorAdd(state.velocity, characterVectorScale(accel, dt));
  let nextPos = characterVectorAdd(state.position, characterVectorScale(nextVel, dt));

  const newOffset = characterVectorSubtract(nextPos, target);
  const offsetLen = characterVectorLength(newOffset);
  if (offsetLen > maxDisp && offsetLen > 1e-6) {
    nextPos = characterVectorAdd(target, characterVectorScale(newOffset, maxDisp / offsetLen));
  }

  return {
    position: nextPos,
    velocity: nextVel,
  };
}
