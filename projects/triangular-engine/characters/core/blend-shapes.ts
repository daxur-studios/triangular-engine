/**
 * Facial blendshape vocabulary and emotion mapping.
 *
 * The canonical set is Apple's ARKit 52 blendshape names (the de-facto standard
 * for real-time facial animation). Oculus/VRM names are a rename of the same
 * set, so we keep one canonical vocabulary and translate from Oculus on demand.
 *
 * This module is framework-free and emits plain `0..1` weights; the Three.js
 * binding later drives `morphTargetInfluences` with them.
 */

export const ARKIT_BLENDSHAPE_NAMES = [
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawOpen',
  'jawRight',
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut',
] as const;

export type BlendshapeName = (typeof ARKIT_BLENDSHAPE_NAMES)[number];

export const OCULUS_BLENDSHAPE_NAMES = [
  'Brow_Down_L',
  'Brow_Down_R',
  'Brow_InnerUp',
  'Brow_OuterUp_L',
  'Brow_OuterUp_R',
  'Cheek_Puff',
  'Cheek_Squint_L',
  'Cheek_Squint_R',
  'Eye_Blink_L',
  'Eye_Blink_R',
  'Eye_Look_Down_L',
  'Eye_Look_Down_R',
  'Eye_Look_In_L',
  'Eye_Look_In_R',
  'Eye_Look_Out_L',
  'Eye_Look_Out_R',
  'Eye_Look_Up_L',
  'Eye_Look_Up_R',
  'Eye_Squint_L',
  'Eye_Squint_R',
  'Eye_Wide_L',
  'Eye_Wide_R',
  'Jaw_Down',
  'Jaw_Forward',
  'Jaw_Left',
  'Jaw_Open',
  'Jaw_Right',
  'Mouth_Close',
  'Mouth_Dimple_L',
  'Mouth_Dimple_R',
  'Mouth_Frown_L',
  'Mouth_Frown_R',
  'Mouth_Funnel',
  'Mouth_Left',
  'Mouth_Lower_Down_L',
  'Mouth_Lower_Down_R',
  'Mouth_Press_L',
  'Mouth_Press_R',
  'Mouth_Pucker',
  'Mouth_Right',
  'Mouth_Roll_Lower',
  'Mouth_Roll_Upper',
  'Mouth_Shrug_Lower',
  'Mouth_Shrug_Upper',
  'Mouth_Smile_L',
  'Mouth_Smile_R',
  'Mouth_Stretch_L',
  'Mouth_Stretch_R',
  'Mouth_Upper_Up_L',
  'Mouth_Upper_Up_R',
  'Nose_Sneer_L',
  'Nose_Sneer_R',
  'Tongue_Out',
] as const;

export type OculusBlendshapeName = (typeof OCULUS_BLENDSHAPE_NAMES)[number];

/** Maps each Oculus/VRM blendshape name to its canonical ARKit equivalent. */
export const OCULUS_TO_ARKIT: Readonly<Record<OculusBlendshapeName, BlendshapeName>> = {
  Brow_Down_L: 'browDownLeft',
  Brow_Down_R: 'browDownRight',
  Brow_InnerUp: 'browInnerUp',
  Brow_OuterUp_L: 'browOuterUpLeft',
  Brow_OuterUp_R: 'browOuterUpRight',
  Cheek_Puff: 'cheekPuff',
  Cheek_Squint_L: 'cheekSquintLeft',
  Cheek_Squint_R: 'cheekSquintRight',
  Eye_Blink_L: 'eyeBlinkLeft',
  Eye_Blink_R: 'eyeBlinkRight',
  Eye_Look_Down_L: 'eyeLookDownLeft',
  Eye_Look_Down_R: 'eyeLookDownRight',
  Eye_Look_In_L: 'eyeLookInLeft',
  Eye_Look_In_R: 'eyeLookInRight',
  Eye_Look_Out_L: 'eyeLookOutLeft',
  Eye_Look_Out_R: 'eyeLookOutRight',
  Eye_Look_Up_L: 'eyeLookUpLeft',
  Eye_Look_Up_R: 'eyeLookUpRight',
  Eye_Squint_L: 'eyeSquintLeft',
  Eye_Squint_R: 'eyeSquintRight',
  Eye_Wide_L: 'eyeWideLeft',
  Eye_Wide_R: 'eyeWideRight',
  Jaw_Down: 'jawOpen',
  Jaw_Forward: 'jawForward',
  Jaw_Left: 'jawLeft',
  Jaw_Open: 'jawOpen',
  Jaw_Right: 'jawRight',
  Mouth_Close: 'mouthClose',
  Mouth_Dimple_L: 'mouthDimpleLeft',
  Mouth_Dimple_R: 'mouthDimpleRight',
  Mouth_Frown_L: 'mouthFrownLeft',
  Mouth_Frown_R: 'mouthFrownRight',
  Mouth_Funnel: 'mouthFunnel',
  Mouth_Left: 'mouthLeft',
  Mouth_Lower_Down_L: 'mouthLowerDownLeft',
  Mouth_Lower_Down_R: 'mouthLowerDownRight',
  Mouth_Press_L: 'mouthPressLeft',
  Mouth_Press_R: 'mouthPressRight',
  Mouth_Pucker: 'mouthPucker',
  Mouth_Right: 'mouthRight',
  Mouth_Roll_Lower: 'mouthRollLower',
  Mouth_Roll_Upper: 'mouthRollUpper',
  Mouth_Shrug_Lower: 'mouthShrugLower',
  Mouth_Shrug_Upper: 'mouthShrugUpper',
  Mouth_Smile_L: 'mouthSmileLeft',
  Mouth_Smile_R: 'mouthSmileRight',
  Mouth_Stretch_L: 'mouthStretchLeft',
  Mouth_Stretch_R: 'mouthStretchRight',
  Mouth_Upper_Up_L: 'mouthUpperUpLeft',
  Mouth_Upper_Up_R: 'mouthUpperUpRight',
  Nose_Sneer_L: 'noseSneerLeft',
  Nose_Sneer_R: 'noseSneerRight',
  Tongue_Out: 'tongueOut',
};

export type BlendShapeWeights = Readonly<Partial<Record<BlendshapeName, number>>>;

export const EMOTION_NAMES = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'fearful',
  'disgusted',
] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

/**
 * Hand-tuned emotion → blendshape weights. Functional placeholders rather than
 * an expressive blend, so intensities stay moderate and predictable.
 */
const EMOTION_WEIGHTS: Readonly<Record<EmotionName, BlendShapeWeights>> = {
  neutral: {},
  happy: {
    mouthSmileLeft: 0.6,
    mouthSmileRight: 0.6,
    cheekSquintLeft: 0.4,
    cheekSquintRight: 0.4,
    eyeSquintLeft: 0.2,
    eyeSquintRight: 0.2,
    browInnerUp: 0.15,
  },
  sad: {
    mouthFrownLeft: 0.5,
    mouthFrownRight: 0.5,
    browInnerUp: 0.55,
    eyeSquintLeft: 0.3,
    eyeSquintRight: 0.3,
    mouthShrugUpper: 0.2,
  },
  angry: {
    browDownLeft: 0.6,
    browDownRight: 0.6,
    eyeSquintLeft: 0.5,
    eyeSquintRight: 0.5,
    noseSneerLeft: 0.4,
    noseSneerRight: 0.4,
    mouthStretchLeft: 0.3,
    mouthStretchRight: 0.3,
  },
  surprised: {
    browOuterUpLeft: 0.7,
    browOuterUpRight: 0.7,
    eyeWideLeft: 0.8,
    eyeWideRight: 0.8,
    jawOpen: 0.7,
    mouthFunnel: 0.2,
  },
  fearful: {
    browInnerUp: 0.6,
    eyeWideLeft: 0.6,
    eyeWideRight: 0.6,
    mouthStretchLeft: 0.3,
    mouthStretchRight: 0.3,
    jawOpen: 0.3,
  },
  disgusted: {
    noseSneerLeft: 0.7,
    noseSneerRight: 0.7,
    browDownLeft: 0.3,
    browDownRight: 0.3,
    eyeSquintLeft: 0.4,
    eyeSquintRight: 0.4,
    mouthShrugUpper: 0.4,
    mouthFrownLeft: 0.3,
    mouthFrownRight: 0.3,
  },
};

function clampWeight(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Scaled-by-intensity weights for an emotion; `intensity` is clamped to 0..1. */
export function sampleEmotion(emotion: EmotionName, intensity = 1): BlendShapeWeights {
  const scale = clampWeight(intensity);
  const base = EMOTION_WEIGHTS[emotion];
  if (scale === 1) return base;
  if (scale === 0) return EMOTION_WEIGHTS.neutral;
  const result: Record<BlendshapeName, number> = {} as Record<BlendshapeName, number>;
  for (const key of Object.keys(base) as BlendshapeName[]) {
    result[key] = base[key]! * scale;
  }
  return result;
}

/** Componentwise lerp between two blendshape weight maps; missing keys are 0. */
export function blendBlendShapeWeights(
  from: BlendShapeWeights,
  to: BlendShapeWeights,
  amount: number,
): BlendShapeWeights {
  const t = clampWeight(amount);
  const result: Record<BlendshapeName, number> = {} as Record<BlendshapeName, number>;
  const keys = new Set<BlendshapeName>([...Object.keys(from), ...Object.keys(to)] as BlendshapeName[]);
  for (const key of keys) {
    const a = from[key] ?? 0;
    const b = to[key] ?? 0;
    const value = a + (b - a) * t;
    if (Math.abs(value) > 1e-6) result[key] = value;
  }
  return result;
}

/** Combines weight maps by taking the max per key (emotion + speech, blinks, …). */
export function mergeBlendShapeWeights(...maps: BlendShapeWeights[]): BlendShapeWeights {
  const result: Record<BlendshapeName, number> = {} as Record<BlendshapeName, number>;
  for (const map of maps) {
    for (const key of Object.keys(map) as BlendshapeName[]) {
      const value = map[key] ?? 0;
      result[key] = Math.max(result[key] ?? 0, value);
    }
  }
  return result;
}
