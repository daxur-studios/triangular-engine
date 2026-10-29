/**
 * Framework-free quadruped locomotion for the Capsule Doodle Space Cats.
 *
 * Samples a diagonal four-beat trot, a gathered galloping bound, a zero-G paddle
 * float and a breathing idle, driving four Quadratic Bezier rubber-hose legs plus
 * an S-curved procedural tail. Everything is plain data so the same sample can be
 * replayed in tests without Three.js.
 */

import type { CapsuleCatCharacterDNA, CapsuleCatGaitMode } from './capsule-cat-dna';
import type { ExtendedEmotionName } from './face-semantic-channels';
import {
  characterVector3,
  type CharacterVector3,
} from './character-vector';
import {
  solveRubberHoseLimb,
  type RubberHoseLimbSolution,
} from './capsule-locomotion';

export interface CapsuleCatTailPose {
  /** Attachment point at the rear cap of the capsule. */
  readonly base: CharacterVector3;
  /** First cubic Bezier control point (tail rises behind the rump). */
  readonly control1: CharacterVector3;
  /** Second cubic Bezier control point (the S-curve apex). */
  readonly control2: CharacterVector3;
  /** Tapered tail tip. */
  readonly tip: CharacterVector3;
  /** Base radius of the tapered tail tube. */
  readonly radius: number;
}

export interface CapsuleCatLocomotionInput {
  readonly mode: CapsuleCatGaitMode;
  readonly elapsedSeconds: number;
  readonly dna: CapsuleCatCharacterDNA;
  /** Optional normalized movement speed multiplier ([0.3, 2.0], default 1.0). */
  readonly speedMultiplier?: number;
  /** Optional emotional state to modulate tail kinematics and feline posture. */
  readonly emotion?: ExtendedEmotionName;
}

export interface CapsuleCatLocomotionSample {
  /** Phase angle $\phi$ in radians. */
  readonly phase: number;
  /** Resting capsule center height in meters above the ground. */
  readonly bodyCenterY: number;
  /** Vertical bounce offset of the body in meters. */
  readonly bodyBounceY: number;
  /** Side-to-side body sway offset in meters. */
  readonly bodySwayX: number;
  /** Forward torso pitch in radians (positive = nose down). */
  readonly bodyTiltX: number;
  /** Playful body roll around the forward axis in radians. */
  readonly bodyRollZ: number;
  /** Body yaw around the vertical axis in radians. */
  readonly bodyYawY: number;
  /** Breathing scale offset in $[-1, 1]$ for subtle chest expansion. */
  readonly breathing: number;
  readonly frontLeft: RubberHoseLimbSolution;
  readonly frontRight: RubberHoseLimbSolution;
  readonly backLeft: RubberHoseLimbSolution;
  readonly backRight: RubberHoseLimbSolution;
  readonly frontLeftPawPitch: number;
  readonly frontRightPawPitch: number;
  readonly backLeftPawPitch: number;
  readonly backRightPawPitch: number;
  /** S-curved procedural tail pose in body-local space. */
  readonly tail: CapsuleCatTailPose;
  /** Normalized tail sway amount in $[0, 1]$ for secondary-motion bookkeeping. */
  readonly tailSway: number;
}

interface CatGaitProfile {
  readonly frequency: number;
  readonly stride: number;
  readonly frontStepHeight: number;
  readonly backStepHeight: number;
  readonly bounce: number;
  readonly tiltX: number;
  readonly sway: number;
  readonly roll: number;
  readonly yaw: number;
  readonly tailSway: number;
}

function gaitProfile(mode: CapsuleCatGaitMode, speed: number): CatGaitProfile {
  switch (mode) {
    case 'goofy_walk':
      return {
        frequency: 4.2 * speed,
        stride: 0.16 * speed,
        frontStepHeight: 0.13,
        backStepHeight: 0.08,
        bounce: 0.03,
        tiltX: 0.03,
        sway: 0.018,
        roll: 0.07,
        yaw: 0.1,
        tailSway: 0.4,
      };
    case 'bound_run':
      return {
        frequency: 6.4 * speed,
        stride: 0.2 * speed,
        frontStepHeight: 0.18,
        backStepHeight: 0.14,
        bounce: 0.07,
        tiltX: 0.16,
        sway: 0.022,
        roll: 0.05,
        yaw: 0.06,
        tailSway: 0.55,
      };
    case 'float':
      return {
        frequency: 1.6 * speed,
        stride: 0.05,
        frontStepHeight: 0.06,
        backStepHeight: 0.05,
        bounce: 0.16,
        tiltX: -0.05,
        sway: 0.03,
        roll: 0.035,
        yaw: 0.025,
        tailSway: 0.3,
      };
    case 'idle':
    default:
      return {
        frequency: 1.8 * speed,
        stride: 0.014,
        frontStepHeight: 0.008,
        backStepHeight: 0.006,
        bounce: 0.007,
        tiltX: 0,
        sway: 0.006,
        roll: 0.008,
        yaw: 0.01,
        tailSway: 0.18,
      };
  }
}

function transformLocalToWorld(
  lx: number,
  ly: number,
  lz: number,
  rx: number,
  ry: number,
  rz: number,
  ox: number,
  oy: number,
  oz: number,
): CharacterVector3 {
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const y1 = ly * cosX - lz * sinX;
  const z1 = ly * sinX + lz * cosX;
  const x1 = lx;

  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const x2 = x1 * cosY + z1 * sinY;
  const z2 = -x1 * sinY + z1 * cosY;
  const y2 = y1;

  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const x3 = x2 * cosZ - y2 * sinZ;
  const y3 = x2 * sinZ + y2 * cosZ;
  const z3 = z2;

  return characterVector3(x3 + ox, y3 + oy, z3 + oz);
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.3, Math.min(2, speed));
}

function phaseOffsets(mode: CapsuleCatGaitMode): {
  frontLeft: number;
  frontRight: number;
  backLeft: number;
  backRight: number;
} {
  switch (mode) {
    case 'goofy_walk':
      // Near-diagonal four-beat trot: each paw lands slightly after its diagonal partner.
      return { frontLeft: 0, backRight: 0.45, frontRight: Math.PI, backLeft: Math.PI + 0.45 };
    case 'bound_run':
      // Front pair gathers together, the hind pair follows after a short suspension.
      return { frontLeft: 0, frontRight: 0.12, backLeft: Math.PI * 0.55, backRight: Math.PI * 0.55 + 0.12 };
    case 'float':
      return { frontLeft: 0, frontRight: Math.PI, backLeft: Math.PI * 0.5, backRight: Math.PI * 1.5 };
    case 'idle':
    default:
      return { frontLeft: 0, frontRight: 0.35, backLeft: Math.PI * 0.55, backRight: Math.PI * 0.9 };
  }
}

interface PawStep {
  readonly target: CharacterVector3;
}

function samplePawStep(
  phase: number,
  socket: CharacterVector3,
  pawAnkleY: number,
  stride: number,
  stepHeight: number,
  mode: CapsuleCatGaitMode,
  lateralSpread: number,
  floatLift: number,
): PawStep {
  const sin = Math.sin(phase);
  const cos = Math.cos(phase);

  if (mode === 'idle') {
    return {
      target: characterVector3(
        socket.x * lateralSpread,
        pawAnkleY + Math.max(0, sin) * stepHeight,
        socket.z - cos * stride * 0.35,
      ),
    };
  }

  if (mode === 'float') {
    const paddleZ = Math.sin(phase) * stride * 1.6;
    const paddleY = pawAnkleY + floatLift + Math.cos(phase) * stepHeight;
    return {
      target: characterVector3(
        socket.x * lateralSpread + Math.sin(phase * 0.7) * stride * 0.5,
        paddleY,
        socket.z + paddleZ,
      ),
    };
  }

  const lift = Math.max(0, sin) * stepHeight;
  return {
    target: characterVector3(
      socket.x * lateralSpread,
      pawAnkleY + lift,
      socket.z - cos * stride,
    ),
  };
}

function pawPitch(phase: number, mode: CapsuleCatGaitMode, amount: number): number {
  if (mode === 'float') return 0.3 + Math.sin(phase) * 0.2;
  if (mode === 'idle') return Math.sin(phase) * 0.02;
  return -Math.sin(phase) * amount;
}

/**
 * Samples the procedural quadruped locomotion state (body bounce/tilt + four
 * rubber-hose legs + S-curved tail) at `elapsedSeconds`.
 */
export function sampleCapsuleCatLocomotion(
  input: CapsuleCatLocomotionInput,
): CapsuleCatLocomotionSample {
  const { mode, elapsedSeconds, dna } = input;
  const speed = clampSpeed(input.speedMultiplier ?? 1);
  const r = dna.bodyRadius;
  const length = dna.bodyLength;

  const pawAnkleY = 0.07;
  // The solver length is longer than the resting leg drop so a bounding cat can
  // extend its hind legs without the target being clamped.
  const legLength = Math.max(0.36, r * 1.65 + 0.04);
  const legDrop = r * 0.9 + 0.02;
  const legAttachDrop = r * 0.52;
  const bodyCenterY = pawAnkleY + legDrop + legAttachDrop;

  const lateral = r * 0.56;
  const frontZ = length * 0.28;
  const backZ = -length * 0.3;
  const socketY = bodyCenterY - legAttachDrop;

  const profile = gaitProfile(mode, speed);
  const phase = elapsedSeconds * profile.frequency;
  const offsets = phaseOffsets(mode);

  let bodyBounceY: number;
  if (mode === 'idle') {
    bodyBounceY = Math.sin(phase) * profile.bounce;
  } else if (mode === 'float') {
    bodyBounceY = profile.bounce + Math.sin(phase) * 0.045;
  } else {
    bodyBounceY = Math.abs(Math.sin(phase)) * profile.bounce;
  }

  const bodySwayX = Math.cos(phase) * profile.sway;
  const bodyRollZ = -Math.cos(phase) * profile.roll;
  const bodyYawY = Math.cos(phase) * profile.yaw;
  const bodyTiltX =
    mode === 'bound_run'
      ? profile.tiltX + Math.sin(phase) * 0.05
      : mode === 'goofy_walk'
        ? profile.tiltX + Math.cos(phase) * 0.03
        : profile.tiltX;

  const breathing =
    mode === 'float'
      ? Math.sin(elapsedSeconds * 1.3) * 0.6
      : Math.sin(elapsedSeconds * (mode === 'idle' ? 1.9 : 3.1)) *
        (mode === 'bound_run' ? 0.9 : 0.45);

  const floatLift = mode === 'float' ? 0.05 : 0;
  const lateralSpread = 1.08;

  const bodyOrigin = characterVector3(bodySwayX, bodyCenterY + bodyBounceY, 0);

  const frontLeftSocket = transformLocalToWorld(
    -lateral,
    -legAttachDrop,
    frontZ,
    bodyTiltX,
    bodyYawY,
    bodyRollZ,
    bodyOrigin.x,
    bodyOrigin.y,
    bodyOrigin.z,
  );
  const frontRightSocket = transformLocalToWorld(
    lateral,
    -legAttachDrop,
    frontZ,
    bodyTiltX,
    bodyYawY,
    bodyRollZ,
    bodyOrigin.x,
    bodyOrigin.y,
    bodyOrigin.z,
  );
  const backLeftSocket = transformLocalToWorld(
    -lateral,
    -legAttachDrop,
    backZ,
    bodyTiltX,
    bodyYawY,
    bodyRollZ,
    bodyOrigin.x,
    bodyOrigin.y,
    bodyOrigin.z,
  );
  const backRightSocket = transformLocalToWorld(
    lateral,
    -legAttachDrop,
    backZ,
    bodyTiltX,
    bodyYawY,
    bodyRollZ,
    bodyOrigin.x,
    bodyOrigin.y,
    bodyOrigin.z,
  );

  const frontLeftStep = samplePawStep(
    phase + offsets.frontLeft,
    frontLeftSocket,
    pawAnkleY,
    profile.stride,
    profile.frontStepHeight,
    mode,
    lateralSpread,
    floatLift,
  );
  const frontRightStep = samplePawStep(
    phase + offsets.frontRight,
    frontRightSocket,
    pawAnkleY,
    profile.stride,
    profile.frontStepHeight,
    mode,
    lateralSpread,
    floatLift,
  );
  const backLeftStep = samplePawStep(
    phase + offsets.backLeft,
    backLeftSocket,
    pawAnkleY,
    profile.stride,
    profile.backStepHeight,
    mode,
    lateralSpread,
    floatLift,
  );
  const backRightStep = samplePawStep(
    phase + offsets.backRight,
    backRightSocket,
    pawAnkleY,
    profile.stride,
    profile.backStepHeight,
    mode,
    lateralSpread,
    floatLift,
  );

  // Front elbows point back and down; hind knees point forward and down (cat anatomy).
  const frontLeftPole = characterVector3(-0.22, 0.08, -0.95);
  const frontRightPole = characterVector3(0.22, 0.08, -0.95);
  const backLeftPole = characterVector3(-0.18, 0.08, 0.95);
  const backRightPole = characterVector3(0.18, 0.08, 0.95);

  const frontLeft = solveRubberHoseLimb(
    frontLeftSocket,
    frontLeftStep.target,
    legLength,
    frontLeftPole,
    0.92,
  );
  const frontRight = solveRubberHoseLimb(
    frontRightSocket,
    frontRightStep.target,
    legLength,
    frontRightPole,
    0.92,
  );
  const backLeft = solveRubberHoseLimb(
    backLeftSocket,
    backLeftStep.target,
    legLength,
    backLeftPole,
    0.92,
  );
  const backRight = solveRubberHoseLimb(
    backRightSocket,
    backRightStep.target,
    legLength,
    backRightPole,
    0.92,
  );

  const walkPitch = mode === 'goofy_walk' ? 0.35 : mode === 'bound_run' ? 0.5 : 0.18;
  const emotion = input.emotion;

  let tailFreqMult = 1.0;
  let tailAmpMult = 1.0;
  let tailTipYOffset = 0.0;
  let tailRadiusMult = 1.0;
  let bodyDrop = 0.0;

  if (emotion === 'angry') {
    // Fast, aggressive tail lashes with wide horizontal whip
    tailFreqMult = 2.4;
    tailAmpMult = 2.1;
    tailTipYOffset = -r * 0.45;
  } else if (emotion === 'fearful' || dna.panicked) {
    // Puffed-up bottle-brush tail tucked low between the legs; cowering body
    tailFreqMult = 0.8;
    tailAmpMult = 0.45;
    tailTipYOffset = -r * 0.85;
    tailRadiusMult = 1.55;
    bodyDrop = r * 0.15;
  } else if (emotion === 'sad') {
    // Drooping limp tail with barely any sway
    tailFreqMult = 0.6;
    tailAmpMult = 0.28;
    tailTipYOffset = -r * 0.95;
  } else if (emotion === 'happy') {
    // Cheerful upright question-mark tail
    tailFreqMult = 1.15;
    tailAmpMult = 1.1;
    tailTipYOffset = r * 0.35;
  } else if (emotion === 'surprised') {
    // Tall, fluffed up straight tail
    tailRadiusMult = 1.4;
    tailTipYOffset = r * 0.45;
  }

  const tailSwayPhase =
    elapsedSeconds * (mode === 'bound_run' ? 4.4 : mode === 'float' ? 1.2 : 2.4) * tailFreqMult +
    (mode === 'idle' ? 0 : phase * 0.5);
  const swayAmplitude = r * profile.tailSway * tailAmpMult;
  const sway = Math.sin(tailSwayPhase) * swayAmplitude;
  const secondary = Math.cos(tailSwayPhase * 0.7) * swayAmplitude * 0.35;
  const curl = dna.tailCurl;

  const tailBaseZ = -length * 0.5 - r * 0.1;
  const streamBack = mode === 'bound_run' ? r * 0.35 : 0;
  const tail: CapsuleCatTailPose = {
    base: characterVector3(bodySwayX * 0.4, r * 0.18 - bodyDrop * 0.5, tailBaseZ),
    control1: characterVector3(
      bodySwayX * 0.3 + sway * 0.25,
      r * (0.82 + profile.tailSway * 0.12) + tailTipYOffset * 0.3,
      tailBaseZ - r * (0.55 + curl * 0.12),
    ),
    control2: characterVector3(
      bodySwayX * 0.2 - sway * 0.55 + secondary,
      r * (1.45 + curl * 0.5) + tailTipYOffset * 0.7,
      tailBaseZ - r * (0.95 - curl * 0.4) - streamBack * 0.5,
    ),
    tip: characterVector3(
      sway * 0.85 + secondary * 0.5,
      r * (1.78 + curl * 0.6) + tailTipYOffset - streamBack * 0.45,
      tailBaseZ - r * (0.35 - curl * 0.6) - streamBack,
    ),
    radius: Math.max(0.022, r * 0.155) * tailRadiusMult,
  };

  return {
    phase,
    bodyCenterY: bodyCenterY - bodyDrop,
    bodyBounceY,
    bodySwayX,
    bodyTiltX,
    bodyRollZ,
    bodyYawY,
    breathing,
    frontLeft,
    frontRight,
    backLeft,
    backRight,
    frontLeftPawPitch: pawPitch(phase + offsets.frontLeft, mode, walkPitch),
    frontRightPawPitch: pawPitch(phase + offsets.frontRight, mode, walkPitch),
    backLeftPawPitch: pawPitch(phase + offsets.backLeft, mode, walkPitch),
    backRightPawPitch: pawPitch(phase + offsets.backRight, mode, walkPitch),
    tail,
    tailSway: (Math.sin(tailSwayPhase) * 0.5 + 0.5) * profile.tailSway,
  };
}
