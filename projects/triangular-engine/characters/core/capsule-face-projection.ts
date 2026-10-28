/**
 * Framework-free projection from `FacialFrameState` (semantic channels, ARKit 52
 * blendshapes, visemes, and gaze) to Capsule Doodle 2D SDF mouth uniforms and
 * googly-eye / hemisphere-eyelid / floating-eyebrow rig parameters.
 */

import type { CapsuleCharacterDNA } from './capsule-dna';
import type { FacialFrameState } from './face-controller';

export interface CapsuleSdfMouthUniforms {
  /** Normalized vertical mouth aperture in $[0, 1]$. */
  readonly mouthOpen: number;
  /** Normalized horizontal mouth width in $[0.22, 1.15]$. */
  readonly mouthWidth: number;
  /** Mouth curvature in $[-1, +1]$: $+1$ = happy `:D`, $0$ = neutral/oval, $-1$ = sad/panicked `D:`. */
  readonly mouthCurve: number;
  /** Sine-wave squiggle amplitude in $[0, 1]$ for nervous/quivering expressions. */
  readonly mouthWave: number;
  /** Upper teeth visibility and buck-tooth split ($0$ = full bar, $1$ = twin buck teeth). */
  readonly buckTeeth: number;
  /** Tongue visibility multiplier in $[0, 1]$. */
  readonly tongueVisible: number;
}

export interface CapsuleEyeRigPose {
  readonly gazeYaw: number;
  readonly gazePitch: number;
  readonly pupilScale: number;
  /** Upper eyelid closure angle in radians ($0$ = open, $\pi/2$ = closed). */
  readonly upperLidAngle: number;
  /** Lower eyelid rise angle in radians ($0$ = open, $\pi/3$ = squinted). */
  readonly lowerLidAngle: number;
  /** Eyelid Z-roll glare angle in radians (inward tilt for angry/determined, outward for sad). */
  readonly lidTiltZ: number;
}

export interface CapsuleBrowRigPose {
  /** Vertical displacement offset from rest position in meters. */
  readonly heightOffset: number;
  /** Z-axis tilt angle in radians (positive tilts inner brow down on left / up on right). */
  readonly zRotation: number;
}

export interface CapsuleFaceProjection {
  readonly mouth: CapsuleSdfMouthUniforms;
  readonly leftEye: CapsuleEyeRigPose;
  readonly rightEye: CapsuleEyeRigPose;
  readonly leftBrow: CapsuleBrowRigPose;
  readonly rightBrow: CapsuleBrowRigPose;
}

export interface CapsuleFaceProjectionOptions {
  /** Optional elapsed time in seconds for procedural speech jitter. */
  readonly elapsedSeconds?: number;
  /** Optional manual override for nervous wavy-mouth expression in $[0, 1]$. */
  readonly wavyMouthOverride?: number;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * Projects a `FacialFrameState` + `CapsuleCharacterDNA` into ready-to-render
 * 2D SDF mouth shader uniforms and 3D googly-eye/brow transforms.
 */
export function projectCapsuleFaceState(
  frame: FacialFrameState,
  dna: CapsuleCharacterDNA,
  options: CapsuleFaceProjectionOptions = {},
): CapsuleFaceProjection {
  const ch = frame.channels;
  const elapsed = options.elapsedSeconds ?? 0;

  const smile = Math.max(ch['mouth.smile'] ?? 0, ch['mouth.smile.left'] ?? 0, ch['mouth.smile.right'] ?? 0);
  const frown = Math.max(ch['mouth.frown'] ?? 0, ch['mouth.frown.left'] ?? 0, ch['mouth.frown.right'] ?? 0);
  const jawOpen = ch['mouth.jawOpen'] ?? 0;
  const lipClose = ch['mouth.lipClose'] ?? 0;
  const round = Math.max(ch['mouth.round'] ?? 0, ch['mouth.pucker'] ?? 0, ch['mouth.funnel'] ?? 0);
  const widen = ch['mouth.widen'] ?? 0;

  // Multi-frequency simplex-like harmonic modulation during active speech
  const speechNoise = frame.isSpeaking
    ? (Math.sin(elapsed * 19.3) * 0.5 + Math.sin(elapsed * 31.7) * 0.35 + Math.cos(elapsed * 11.1) * 0.15) * 0.14
    : 0;

  // Emotions like 'happy' and 'fearful' naturally part the cartoon D-mouth in the concept art
  const expressionOpenBoost =
    frame.currentEmotion === 'happy'
      ? smile * 0.45
      : frame.currentEmotion === 'fearful' || frame.currentEmotion === 'angry'
        ? Math.max(frown, jawOpen) * 0.55
        : 0;

  const rawOpen = Math.max(jawOpen, expressionOpenBoost, round * 0.45) * (1 - lipClose * 0.88) + speechNoise;
  const mouthOpen = clamp(rawOpen, 0, 1);

  const baseWidth = 0.62 + (smile * 0.28 + widen * 0.24) - round * 0.32;
  const mouthWidth = clamp(baseWidth, 0.25, 1.15);

  const mouthCurve = clamp(smile * 1.05 - frown * 1.1, -1, 1);

  const defaultWave =
    frame.currentEmotion === 'disgusted' || (frame.currentEmotion === 'fearful' && mouthOpen < 0.2)
      ? 0.65
      : 0;
  const mouthWave = clamp(options.wavyMouthOverride ?? defaultWave, 0, 1);

  // Pupil dilation / constriction based on emotion (shrinks in panic/surprise, dilates slightly in happy)
  const wideLeft = Math.max(ch['eye.wide'] ?? 0, ch['eye.wide.left'] ?? 0);
  const wideRight = Math.max(ch['eye.wide'] ?? 0, ch['eye.wide.right'] ?? 0);
  const panicShrink =
    frame.currentEmotion === 'fearful' || frame.currentEmotion === 'surprised'
      ? -0.07 * Math.max(wideLeft, wideRight, 0.5)
      : frame.currentEmotion === 'happy'
        ? 0.03 * smile
        : 0;
  const pupilScale = clamp(dna.pupilScale + panicShrink, 0.14, 0.55);

  const blinkLeft = Math.max(ch['eye.blink'] ?? 0, ch['eye.blink.left'] ?? 0);
  const blinkRight = Math.max(ch['eye.blink'] ?? 0, ch['eye.blink.right'] ?? 0);
  const squintLeft = Math.max(ch['eye.squint'] ?? 0, ch['eye.squint.left'] ?? 0);
  const squintRight = Math.max(ch['eye.squint'] ?? 0, ch['eye.squint.right'] ?? 0);

  const browRaiseLeft = Math.max(ch['brow.raise'] ?? 0, ch['brow.left.raise'] ?? 0);
  const browRaiseRight = Math.max(ch['brow.raise'] ?? 0, ch['brow.right.raise'] ?? 0);
  const browLowerLeft = Math.max(ch['brow.lower'] ?? 0, ch['brow.left.lower'] ?? 0);
  const browLowerRight = Math.max(ch['brow.lower'] ?? 0, ch['brow.right.lower'] ?? 0);

  // Upper eyelid closes down to ~1.55 rad on full blink, or partially on glare/squint, or retracts on wide
  const computeUpperLid = (blink: number, squint: number, wide: number, browDown: number): number => {
    const glareCover = Math.max(squint * 0.35, browDown * 0.42) * (1 - wide * 0.8);
    const openRetract = -wide * 0.28;
    const closedAngle = 1.55;
    const baseAngle = Math.max(0, glareCover + openRetract);
    return clamp(baseAngle + (closedAngle - baseAngle) * blink, 0, closedAngle);
  };

  const computeLowerLid = (blink: number, squint: number, smileWeight: number): number => {
    const happyCheekLift = smileWeight * 0.25;
    return clamp(Math.max(squint * 0.65, happyCheekLift, blink * 0.35), 0, 0.95);
  };

  // Inward angry glare vs outward worried/sad tilt
  const leftGlareTilt = (browLowerLeft - browRaiseLeft * 0.5) * -0.38;
  const rightGlareTilt = (browLowerRight - browRaiseRight * 0.5) * 0.38;

  const browMaxTravel = dna.bodyRadius * 0.16;
  const leftBrowHeight = (browRaiseLeft - browLowerLeft * 0.85) * browMaxTravel;
  const rightBrowHeight = (browRaiseRight - browLowerRight * 0.85) * browMaxTravel;

  // Z-rotation: angry lowers inner brow corners; sad/skeptical tilts asymmetrically
  const leftBrowRot =
    frame.currentEmotion === 'sad' || frame.currentEmotion === 'fearful'
      ? 0.28 * Math.max(frown, wideLeft)
      : (browLowerLeft * -0.42) + (browRaiseLeft * 0.14);
  const rightBrowRot =
    frame.currentEmotion === 'sad' || frame.currentEmotion === 'fearful'
      ? -0.28 * Math.max(frown, wideRight)
      : (browLowerRight * 0.42) - (browRaiseRight * 0.14);

  return {
    mouth: {
      mouthOpen,
      mouthWidth,
      mouthCurve,
      mouthWave,
      buckTeeth: dna.buckTeeth ? 1 : 0,
      tongueVisible: mouthOpen > 0.12 ? clamp((mouthOpen - 0.12) / 0.35, 0, 1) : 0,
    },
    leftEye: {
      gazeYaw: frame.gaze.left.yaw,
      gazePitch: frame.gaze.left.pitch,
      pupilScale,
      upperLidAngle: computeUpperLid(blinkLeft, squintLeft, wideLeft, browLowerLeft),
      lowerLidAngle: computeLowerLid(blinkLeft, squintLeft, smile),
      lidTiltZ: leftGlareTilt,
    },
    rightEye: {
      gazeYaw: frame.gaze.right.yaw,
      gazePitch: frame.gaze.right.pitch,
      pupilScale,
      upperLidAngle: computeUpperLid(blinkRight, squintRight, wideRight, browLowerRight),
      lowerLidAngle: computeLowerLid(blinkRight, squintRight, smile),
      lidTiltZ: rightGlareTilt,
    },
    leftBrow: {
      heightOffset: leftBrowHeight,
      zRotation: leftBrowRot,
    },
    rightBrow: {
      heightOffset: rightBrowHeight,
      zRotation: rightBrowRot,
    },
  };
}
