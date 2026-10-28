/**
 * Framework-free projection from `FacialFrameState` to the Capsule Cat 2D SDF
 * `:3` / omega mouth, googly-eye / hemisphere-eyelid rig, ear perk and whisker
 * spread. Kept separate from the humanoid projection because cat mouths are
 * twin-arched instead of D-shaped and the ears carry the emotional read.
 */

import type { CapsuleCatCharacterDNA } from './capsule-cat-dna';
import type { CapsuleEyeRigPose } from './capsule-face-projection';
import type { FacialFrameState } from './face-controller';

export interface CapsuleCatSdfMouthUniforms {
  /** Normalized vertical mouth aperture in $[0, 1]$ ($0$ = closed `:3` line). */
  readonly mouthOpen: number;
  /** Normalized horizontal mouth width in $[0.22, 1.15]$. */
  readonly mouthWidth: number;
  /** Mouth curvature in $[-1, +1]$: $+1$ = happy `:D`, $0$ = neutral, $-1$ = sad/panicked. */
  readonly mouthCurve: number;
  /** Round `MEOW` opening bias in $[0, 1]$ (turns the twin arches into a tall oval). */
  readonly meow: number;
  /** Tongue visibility multiplier in $[0, 1]$. */
  readonly tongueVisible: number;
}

export interface CapsuleCatFaceProjection {
  readonly mouth: CapsuleCatSdfMouthUniforms;
  readonly leftEye: CapsuleEyeRigPose;
  readonly rightEye: CapsuleEyeRigPose;
  /** Ear perk in $[-1, +1]$: $+1$ alert, $0$ relaxed, $-1$ flattened. */
  readonly earPerk: number;
  /** Whisker spread in $[0, 1]$: calm to surprised/puffed. */
  readonly whiskerSpread: number;
}

export interface CapsuleCatFaceProjectionOptions {
  /** Optional elapsed time in seconds for procedural speech jitter. */
  readonly elapsedSeconds?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Projects a `FacialFrameState` + `CapsuleCatCharacterDNA` into ready-to-render
 * cat SDF mouth uniforms, eye/eyelid poses, ear perk and whisker spread.
 */
export function projectCapsuleCatFaceState(
  frame: FacialFrameState,
  dna: CapsuleCatCharacterDNA,
  options: CapsuleCatFaceProjectionOptions = {},
): CapsuleCatFaceProjection {
  const ch = frame.channels;
  const elapsed = options.elapsedSeconds ?? 0;
  const emotion = frame.currentEmotion;

  const smile = Math.max(
    ch['mouth.smile'] ?? 0,
    ch['mouth.smile.left'] ?? 0,
    ch['mouth.smile.right'] ?? 0,
  );
  const frown = Math.max(
    ch['mouth.frown'] ?? 0,
    ch['mouth.frown.left'] ?? 0,
    ch['mouth.frown.right'] ?? 0,
  );
  const jawOpen = ch['mouth.jawOpen'] ?? 0;
  const lipClose = ch['mouth.lipClose'] ?? 0;
  const round = Math.max(ch['mouth.round'] ?? 0, ch['mouth.pucker'] ?? 0, ch['mouth.funnel'] ?? 0);
  const widen = ch['mouth.widen'] ?? 0;

  const speechNoise = frame.isSpeaking
    ? (Math.sin(elapsed * 19.3) * 0.5 + Math.sin(elapsed * 31.7) * 0.35 + Math.cos(elapsed * 11.1) * 0.15) *
      0.14
    : 0;

  // The DNA's rest mouth is the starting bias so a Scrufly cat idles mid-meow.
  const restMeow = dna.restMouthPose === 'meow' ? 0.82 : dna.restMouthPose === 'open_happy' ? 0.35 : 0;
  const restOpen = dna.restMouthPose === 'meow' ? 0.5 : dna.restMouthPose === 'open_happy' ? 0.42 : 0;

  const happyOpen = emotion === 'happy' ? smile * 0.32 : 0;
  const panicOpen =
    emotion === 'fearful' || emotion === 'surprised' || emotion === 'angry'
      ? Math.max(jawOpen, round, frown) * 0.5
      : 0;

  const rawOpen =
    Math.max(restOpen, jawOpen, happyOpen, panicOpen, round * 0.5) * (1 - lipClose * 0.85) + speechNoise;
  const mouthOpen = clamp(rawOpen, 0, 1);

  const meow = clamp(
    Math.max(restMeow, round * 0.95, (emotion === 'surprised' ? 0.55 : 0), jawOpen * 0.55) -
      widen * 0.2,
    0,
    1,
  );

  const baseWidth = 0.6 + (smile * 0.26 + widen * 0.22) - round * 0.3;
  const mouthWidth = clamp(baseWidth, 0.25, 1.15);
  const mouthCurve = clamp(smile * 1.05 - frown * 1.05, -1, 1);

  const wideLeft = Math.max(ch['eye.wide'] ?? 0, ch['eye.wide.left'] ?? 0);
  const wideRight = Math.max(ch['eye.wide'] ?? 0, ch['eye.wide.right'] ?? 0);
  const panicShrink =
    dna.panicked || emotion === 'fearful' || emotion === 'surprised'
      ? -0.08 * Math.max(wideLeft, wideRight, 0.5)
      : emotion === 'happy'
        ? 0.03 * smile
        : 0;
  const pupilScale = clamp(dna.pupilScale + panicShrink, 0.13, 0.55);

  const blinkLeft = Math.max(ch['eye.blink'] ?? 0, ch['eye.blink.left'] ?? 0);
  const blinkRight = Math.max(ch['eye.blink'] ?? 0, ch['eye.blink.right'] ?? 0);
  const squintLeft = Math.max(ch['eye.squint'] ?? 0, ch['eye.squint.left'] ?? 0);
  const squintRight = Math.max(ch['eye.squint'] ?? 0, ch['eye.squint.right'] ?? 0);

  const browRaiseLeft = Math.max(ch['brow.raise'] ?? 0, ch['brow.left.raise'] ?? 0);
  const browRaiseRight = Math.max(ch['brow.raise'] ?? 0, ch['brow.right.raise'] ?? 0);
  const browLowerLeft = Math.max(ch['brow.lower'] ?? 0, ch['brow.left.lower'] ?? 0);
  const browLowerRight = Math.max(ch['brow.lower'] ?? 0, ch['brow.right.lower'] ?? 0);

  const computeUpperLid = (blink: number, squint: number, wide: number, browDown: number): number => {
    const glareCover = Math.max(squint * 0.3, browDown * 0.34) * (1 - wide * 0.8);
    const openRetract = -wide * 0.22 - (dna.panicked ? 0.12 : 0);
    const closedAngle = 1.55;
    const baseAngle = Math.max(0, glareCover + openRetract);
    return clamp(baseAngle + (closedAngle - baseAngle) * blink, 0, closedAngle);
  };

  const computeLowerLid = (blink: number, squint: number, smileWeight: number): number =>
    clamp(Math.max(squint * 0.55, smileWeight * 0.22, blink * 0.32), 0, 0.95);

  const leftGlareTilt = (browLowerLeft - browRaiseLeft * 0.5) * -0.34;
  const rightGlareTilt = (browLowerRight - browRaiseRight * 0.5) * 0.34;

  const alertness =
    0.22 +
    Math.max(browRaiseLeft, browRaiseRight) * 0.55 +
    Math.max(wideLeft, wideRight) * 0.3 -
    Math.max(browLowerLeft, browLowerRight) * 0.5 -
    frown * 0.3;
  const panicFlatten = dna.panicked ? 0.75 : 0;
  const emotionFlatten =
    emotion === 'angry' ? 0.55 : emotion === 'fearful' ? 0.7 : emotion === 'sad' ? 0.45 : 0;
  const earPerk = clamp(alertness - panicFlatten - emotionFlatten, -1, 1);

  const whiskerSpread = clamp(
    0.25 +
      Math.max(wideLeft, wideRight) * 0.55 +
      smile * 0.2 +
      (dna.panicked ? 0.45 : 0) +
      (emotion === 'surprised' ? 0.3 : 0),
    0,
    1,
  );

  return {
    mouth: {
      mouthOpen,
      mouthWidth,
      mouthCurve,
      meow,
      tongueVisible: mouthOpen > 0.15 ? clamp((mouthOpen - 0.15) / 0.35, 0, 1) : 0,
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
    earPerk,
    whiskerSpread,
  };
}
