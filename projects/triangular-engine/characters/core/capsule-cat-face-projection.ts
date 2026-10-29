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
  /** Fangs visibility multiplier in $[0, 1]$ (sharp cartoon fangs on angry/snarl). */
  readonly fangsVisible?: number;
  /** Asymmetrical mouth smirk in $[-1, 1]$ ($+1$ = right corner smirk, $-1$ = left corner). */
  readonly mouthAsymmetry?: number;
}

export interface CapsuleCatEarPose {
  /** Pitch angle offset in radians ($+X$ = perk forward, $-X$ = flatten back). */
  readonly pitch: number;
  /** Yaw angle offset in radians (swivel outward/backward). */
  readonly yaw: number;
  /** Roll angle offset in radians ($+Z$ = flatten sideways into airplane ears). */
  readonly roll: number;
}

export interface CapsuleCatFaceProjection {
  readonly mouth: CapsuleCatSdfMouthUniforms;
  readonly leftEye: CapsuleEyeRigPose;
  readonly rightEye: CapsuleEyeRigPose;
  /** Backward-compatible scalar ear perk in $[-1, +1]$: $+1$ alert, $0$ relaxed, $-1$ flattened. */
  readonly earPerk: number;
  /** Independent 3D ear poses for left and right ears. */
  readonly leftEar?: CapsuleCatEarPose;
  readonly rightEar?: CapsuleCatEarPose;
  /** Whisker spread in $[0, 1]$: calm to surprised/puffed. */
  readonly whiskerSpread: number;
  /** Whisker angle offset in radians ($+Y$ = bristled forward, $-Y$ = drooping/pinned). */
  readonly whiskerAngle?: number;
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

  const happyOpen = emotion === 'happy' ? Math.max(smile * 0.45, 0.28) : 0;
  const panicOpen =
    emotion === 'fearful' || emotion === 'surprised'
      ? 0.65
      : emotion === 'angry'
        ? 0.42
        : 0;

  const rawOpen =
    Math.max(restOpen, jawOpen, happyOpen, panicOpen, round * 0.5) * (1 - lipClose * 0.85) + speechNoise;
  const mouthOpen = clamp(rawOpen, 0, 1);

  const meow = clamp(
    Math.max(
      restMeow,
      round * 0.95,
      emotion === 'surprised' ? 0.85 : emotion === 'fearful' ? 0.75 : 0,
      jawOpen * 0.55,
    ) - widen * 0.2,
    0,
    1,
  );

  const baseWidth =
    0.6 +
    (smile * 0.26 + widen * 0.28) -
    round * 0.3 +
    (emotion === 'angry' ? 0.22 : 0);
  const mouthWidth = clamp(baseWidth, 0.25, 1.15);

  const mouthCurve =
    emotion === 'happy'
      ? 0.85
      : emotion === 'angry'
        ? -0.75
        : emotion === 'sad'
          ? -0.85
          : emotion === 'fearful'
            ? -0.45
            : emotion === 'disgusted'
              ? -0.65
              : clamp(smile * 1.05 - frown * 1.05, -1, 1);

  const fangsVisible = emotion === 'angry' ? 1.0 : 0.0;
  const mouthAsymmetry = emotion === 'skeptical' ? 0.75 : emotion === 'disgusted' ? -0.45 : 0.0;
  const tongueVisible =
    fangsVisible > 0.5
      ? 0.0
      : emotion === 'happy'
        ? 1.0
        : emotion === 'fearful' || emotion === 'surprised'
          ? 0.6
          : mouthOpen > 0.15
            ? clamp((mouthOpen - 0.15) / 0.35, 0, 1)
            : 0;

  const wideLeft = Math.max(ch['eye.wide'] ?? 0, ch['eye.wide.left'] ?? 0);
  const wideRight = Math.max(ch['eye.wide'] ?? 0, ch['eye.wide.right'] ?? 0);
  const panicShrink =
    dna.panicked || emotion === 'fearful' || emotion === 'surprised'
      ? -0.09 * Math.max(wideLeft, wideRight, 0.6)
      : emotion === 'happy'
        ? 0.03 * smile
        : 0;
  const pupilScale = clamp(dna.pupilScale + panicShrink, 0.12, 0.55);

  const blinkLeft = Math.max(ch['eye.blink'] ?? 0, ch['eye.blink.left'] ?? 0);
  const blinkRight = Math.max(ch['eye.blink'] ?? 0, ch['eye.blink.right'] ?? 0);
  const squintLeft = Math.max(ch['eye.squint'] ?? 0, ch['eye.squint.left'] ?? 0);
  const squintRight = Math.max(ch['eye.squint'] ?? 0, ch['eye.squint.right'] ?? 0);

  const browRaiseLeft = Math.max(ch['brow.raise'] ?? 0, ch['brow.left.raise'] ?? 0);
  const browRaiseRight = Math.max(ch['brow.raise'] ?? 0, ch['brow.right.raise'] ?? 0);
  const browLowerLeft = Math.max(ch['brow.lower'] ?? 0, ch['brow.left.lower'] ?? 0);
  const browLowerRight = Math.max(ch['brow.lower'] ?? 0, ch['brow.right.lower'] ?? 0);

  const computeUpperLid = (
    blink: number,
    squint: number,
    wide: number,
    browDown: number,
    forceGlare = 0,
  ): number => {
    const glareCover = Math.max(squint * 0.75, browDown * 0.85, forceGlare) * (1 - wide * 0.85);
    const openRetract = -wide * 0.25 - (dna.panicked ? 0.15 : 0);
    const closedAngle = 1.0;
    const baseAngle = Math.max(0, glareCover + openRetract);
    return clamp(baseAngle + (closedAngle - baseAngle) * blink, 0, closedAngle);
  };

  const computeLowerLid = (
    blink: number,
    squint: number,
    smileWeight: number,
    forceSquint = 0,
  ): number =>
    clamp(Math.max(squint * 0.75, smileWeight * 0.55, forceSquint, blink * 0.45), 0, 0.95);

  // Eyelid slant: angry glares inward; sad droops outward; skeptical slants asymmetrically
  const leftGlareTilt =
    emotion === 'angry'
      ? -0.45
      : emotion === 'sad'
        ? 0.40
        : emotion === 'disgusted'
          ? -0.25
        : emotion === 'skeptical'
          ? -0.32
          : (browLowerLeft - browRaiseLeft * 0.5) * -0.34;
  const rightGlareTilt =
    emotion === 'angry'
      ? 0.45
      : emotion === 'sad'
        ? -0.40
        : emotion === 'disgusted'
          ? 0.12
        : emotion === 'skeptical'
          ? 0.0
          : (browLowerRight - browRaiseRight * 0.5) * 0.34;

  const leftForceGlare =
    emotion === 'angry' ? 0.78 : emotion === 'sad' ? 0.55 : emotion === 'disgusted' ? 0.72 : emotion === 'skeptical' ? 0.65 : 0;
  const rightForceGlare =
    emotion === 'angry' ? 0.78 : emotion === 'sad' ? 0.55 : emotion === 'disgusted' ? 0.48 : emotion === 'skeptical' ? 0.0 : 0;

  const leftForceSquint =
    emotion === 'happy' ? 0.55 : emotion === 'angry' ? 0.45 : emotion === 'skeptical' ? 0.45 : 0;
  const rightForceSquint =
    emotion === 'happy' ? 0.55 : emotion === 'angry' ? 0.45 : emotion === 'skeptical' ? 0.0 : 0;

  // 3D Ear Poses per ear
  let leftEar: CapsuleCatEarPose;
  let rightEar: CapsuleCatEarPose;

  if (emotion === 'angry') {
    // Airplane ears: flattened horizontally to the sides and swiveled backward
    leftEar = { pitch: -0.38, yaw: -0.58, roll: 0.78 };
    rightEar = { pitch: -0.38, yaw: 0.58, roll: -0.78 };
  } else if (emotion === 'fearful' || dna.panicked) {
    // Pinned flat backwards against the skull
    leftEar = { pitch: -0.62, yaw: -0.28, roll: 0.40 };
    rightEar = { pitch: -0.62, yaw: 0.28, roll: -0.40 };
  } else if (emotion === 'sad') {
    // Drooping outward and downward limply
    leftEar = { pitch: -0.16, yaw: 0.10, roll: 0.68 };
    rightEar = { pitch: -0.16, yaw: -0.10, roll: -0.68 };
  } else if (emotion === 'happy') {
    // Perky forward upright cheerful ears
    leftEar = { pitch: 0.22, yaw: 0.05, roll: -0.12 };
    rightEar = { pitch: 0.22, yaw: -0.05, roll: 0.12 };
  } else if (emotion === 'surprised') {
    // Tall, pricked straight up high and alert
    leftEar = { pitch: 0.36, yaw: -0.04, roll: -0.16 };
    rightEar = { pitch: 0.36, yaw: 0.04, roll: 0.16 };
  } else if (emotion === 'skeptical') {
    // Signature asymmetric quirk: right ear perked forward, left ear twitched sideways
    leftEar = { pitch: -0.32, yaw: -0.45, roll: 0.68 };
    rightEar = { pitch: 0.28, yaw: 0.0, roll: -0.14 };
  } else if (emotion === 'disgusted') {
    leftEar = { pitch: -0.28, yaw: -0.35, roll: 0.48 };
    rightEar = { pitch: -0.12, yaw: 0.15, roll: -0.25 };
  } else {
    // Neutral alert baseline
    const alertness =
      0.18 +
      Math.max(browRaiseLeft, browRaiseRight) * 0.45 -
      Math.max(browLowerLeft, browLowerRight) * 0.4;
    leftEar = { pitch: alertness, yaw: 0, roll: 0 };
    rightEar = { pitch: alertness, yaw: 0, roll: 0 };
  }

  const earPerk = clamp(
    (leftEar.pitch + rightEar.pitch) * 1.4 -
      (Math.abs(leftEar.roll) + Math.abs(rightEar.roll)) * 0.5,
    -1,
    1,
  );

  const whiskerSpread = clamp(
    emotion === 'surprised'
      ? 1.0
      : emotion === 'fearful' || dna.panicked
        ? 0.95
        : emotion === 'angry'
          ? 0.85
          : emotion === 'happy'
            ? 0.40
            : emotion === 'sad'
              ? 0.08
              : emotion === 'skeptical'
                ? 0.50
                : 0.25 + Math.max(wideLeft, wideRight) * 0.5 + smile * 0.2,
    0,
    1,
  );

  const whiskerAngle =
    emotion === 'angry'
      ? 0.25
      : emotion === 'sad'
        ? -0.35
        : emotion === 'fearful'
          ? -0.12
          : 0.0;

  return {
    mouth: {
      mouthOpen,
      mouthWidth,
      mouthCurve,
      meow,
      tongueVisible,
      fangsVisible,
      mouthAsymmetry,
    },
    leftEye: {
      gazeYaw: frame.gaze.left.yaw,
      gazePitch: frame.gaze.left.pitch,
      pupilScale,
      upperLidAngle: computeUpperLid(
        blinkLeft,
        squintLeft,
        wideLeft,
        browLowerLeft,
        leftForceGlare,
      ),
      lowerLidAngle: computeLowerLid(blinkLeft, squintLeft, smile, leftForceSquint),
      lidTiltZ: leftGlareTilt,
    },
    rightEye: {
      gazeYaw: frame.gaze.right.yaw,
      gazePitch: frame.gaze.right.pitch,
      pupilScale,
      upperLidAngle: computeUpperLid(
        blinkRight,
        squintRight,
        wideRight,
        browLowerRight,
        rightForceGlare,
      ),
      lowerLidAngle: computeLowerLid(blinkRight, squintRight, smile, rightForceSquint),
      lidTiltZ: rightGlareTilt,
    },
    earPerk,
    leftEar,
    rightEar,
    whiskerSpread,
    whiskerAngle,
  };
}
