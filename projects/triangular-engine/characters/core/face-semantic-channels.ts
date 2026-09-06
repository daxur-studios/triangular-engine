/**
 * Semantic facial animation channels, ARKit 52 mapping, expression presets,
 * and serializable command types.
 *
 * This module is framework-free and data-first: it defines the semantic
 * vocabulary used by games, scripts, and local AI agents to direct facial
 * motion without coupling to any specific mesh geometry or renderer.
 */

import type { BlendShapeWeights, BlendshapeName } from './blend-shapes';
import type { VisemeKeyframe } from './visemes';

export const FACE_SEMANTIC_CHANNEL_NAMES = [
  // Brows
  'brow.left.raise',
  'brow.left.lower',
  'brow.right.raise',
  'brow.right.lower',
  'brow.raise',
  'brow.lower',

  // Eyes & Eyelids
  'eye.blink.left',
  'eye.blink.right',
  'eye.blink',
  'eye.squint.left',
  'eye.squint.right',
  'eye.squint',
  'eye.wide.left',
  'eye.wide.right',
  'eye.wide',

  // Mouth & Jaw
  'mouth.smile.left',
  'mouth.smile.right',
  'mouth.smile',
  'mouth.frown.left',
  'mouth.frown.right',
  'mouth.frown',
  'mouth.jawOpen',
  'mouth.lipClose',
  'mouth.widen',
  'mouth.round',
  'mouth.pucker',
  'mouth.funnel',

  // Cheeks
  'cheek.puff',
  'cheek.squint.left',
  'cheek.squint.right',
] as const;

export type FaceSemanticChannelName = (typeof FACE_SEMANTIC_CHANNEL_NAMES)[number];

export type FaceSemanticChannelValues = Readonly<Partial<Record<FaceSemanticChannelName, number>>>;

export const EXTENDED_EMOTION_NAMES = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'fearful',
  'disgusted',
  'skeptical',
] as const;

export type ExtendedEmotionName = (typeof EXTENDED_EMOTION_NAMES)[number];

/** Preset facial expressions defined over reusable semantic channels. */
export const EXPRESSION_PRESETS: Readonly<Record<ExtendedEmotionName, FaceSemanticChannelValues>> = {
  neutral: {},
  happy: {
    'mouth.smile': 0.75,
    'cheek.squint.left': 0.4,
    'cheek.squint.right': 0.4,
    'eye.squint': 0.25,
    'brow.raise': 0.15,
  },
  sad: {
    'mouth.frown': 0.65,
    'brow.left.lower': 0.25,
    'brow.right.lower': 0.25,
    'eye.squint': 0.25,
    'mouth.lipClose': 0.2,
  },
  angry: {
    'brow.left.lower': 0.8,
    'brow.right.lower': 0.8,
    'eye.squint': 0.5,
    'mouth.frown': 0.35,
    'mouth.widen': 0.3,
    'mouth.jawOpen': 0.15,
  },
  surprised: {
    'brow.raise': 0.85,
    'eye.wide': 0.85,
    'mouth.jawOpen': 0.65,
    'mouth.round': 0.35,
  },
  fearful: {
    'brow.raise': 0.6,
    'eye.wide': 0.7,
    'mouth.widen': 0.4,
    'mouth.jawOpen': 0.35,
    'mouth.frown': 0.2,
  },
  disgusted: {
    'brow.left.lower': 0.4,
    'brow.right.lower': 0.4,
    'eye.squint': 0.45,
    'mouth.frown': 0.45,
    'mouth.widen': 0.2,
    'mouth.jawOpen': 0.1,
  },
  skeptical: {
    // Single right eyebrow raised, left eyebrow lowered, subtle smirk
    'brow.right.raise': 0.9,
    'brow.left.lower': 0.3,
    'eye.squint.left': 0.35,
    'mouth.smile.right': 0.35,
    'mouth.frown.left': 0.15,
  },
};

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Expands shorthand semantic channels (e.g. `mouth.smile` -> `mouth.smile.left` and `mouth.smile.right`)
 * and clamps values to [0, 1].
 */
export function expandSemanticChannels(
  channels: FaceSemanticChannelValues,
): Record<FaceSemanticChannelName, number> {
  const result: Partial<Record<FaceSemanticChannelName, number>> = {};

  for (const name of FACE_SEMANTIC_CHANNEL_NAMES) {
    if (channels[name] !== undefined) {
      result[name] = clamp01(channels[name]!);
    }
  }

  // Handle paired shortcuts
  if (channels['brow.raise'] !== undefined) {
    const v = clamp01(channels['brow.raise']!);
    result['brow.left.raise'] = Math.max(result['brow.left.raise'] ?? 0, v);
    result['brow.right.raise'] = Math.max(result['brow.right.raise'] ?? 0, v);
  }
  if (channels['brow.lower'] !== undefined) {
    const v = clamp01(channels['brow.lower']!);
    result['brow.left.lower'] = Math.max(result['brow.left.lower'] ?? 0, v);
    result['brow.right.lower'] = Math.max(result['brow.right.lower'] ?? 0, v);
  }
  if (channels['eye.blink'] !== undefined) {
    const v = clamp01(channels['eye.blink']!);
    result['eye.blink.left'] = Math.max(result['eye.blink.left'] ?? 0, v);
    result['eye.blink.right'] = Math.max(result['eye.blink.right'] ?? 0, v);
  }
  if (channels['eye.squint'] !== undefined) {
    const v = clamp01(channels['eye.squint']!);
    result['eye.squint.left'] = Math.max(result['eye.squint.left'] ?? 0, v);
    result['eye.squint.right'] = Math.max(result['eye.squint.right'] ?? 0, v);
  }
  if (channels['eye.wide'] !== undefined) {
    const v = clamp01(channels['eye.wide']!);
    result['eye.wide.left'] = Math.max(result['eye.wide.left'] ?? 0, v);
    result['eye.wide.right'] = Math.max(result['eye.wide.right'] ?? 0, v);
  }
  if (channels['mouth.smile'] !== undefined) {
    const v = clamp01(channels['mouth.smile']!);
    result['mouth.smile.left'] = Math.max(result['mouth.smile.left'] ?? 0, v);
    result['mouth.smile.right'] = Math.max(result['mouth.smile.right'] ?? 0, v);
  }
  if (channels['mouth.frown'] !== undefined) {
    const v = clamp01(channels['mouth.frown']!);
    result['mouth.frown.left'] = Math.max(result['mouth.frown.left'] ?? 0, v);
    result['mouth.frown.right'] = Math.max(result['mouth.frown.right'] ?? 0, v);
  }
  if (channels['mouth.round'] !== undefined) {
    const v = clamp01(channels['mouth.round']!);
    result['mouth.pucker'] = Math.max(result['mouth.pucker'] ?? 0, v);
  }

  return result as Record<FaceSemanticChannelName, number>;
}

/**
 * Projects semantic channel values onto standard ARKit 52 blendshape weights.
 */
export function semanticChannelsToBlendShapes(channels: FaceSemanticChannelValues): BlendShapeWeights {
  const c = expandSemanticChannels(channels);
  const weights: Partial<Record<BlendshapeName, number>> = {};

  const setIfPositive = (key: BlendshapeName, val: number | undefined) => {
    if (val !== undefined && val > 0.001) {
      weights[key] = Math.min(1, val);
    }
  };

  // Brows
  setIfPositive('browDownLeft', c['brow.left.lower']);
  setIfPositive('browDownRight', c['brow.right.lower']);
  setIfPositive('browOuterUpLeft', c['brow.left.raise']);
  setIfPositive('browOuterUpRight', c['brow.right.raise']);
  setIfPositive(
    'browInnerUp',
    Math.max(c['brow.left.raise'] ?? 0, c['brow.right.raise'] ?? 0) * 0.8,
  );

  // Eyes & Eyelids
  setIfPositive('eyeBlinkLeft', c['eye.blink.left']);
  setIfPositive('eyeBlinkRight', c['eye.blink.right']);
  setIfPositive('eyeSquintLeft', c['eye.squint.left']);
  setIfPositive('eyeSquintRight', c['eye.squint.right']);
  setIfPositive('eyeWideLeft', c['eye.wide.left']);
  setIfPositive('eyeWideRight', c['eye.wide.right']);

  // Mouth & Jaw
  setIfPositive('mouthSmileLeft', c['mouth.smile.left']);
  setIfPositive('mouthSmileRight', c['mouth.smile.right']);
  setIfPositive('mouthFrownLeft', c['mouth.frown.left']);
  setIfPositive('mouthFrownRight', c['mouth.frown.right']);
  setIfPositive('jawOpen', c['mouth.jawOpen']);
  setIfPositive('mouthClose', c['mouth.lipClose']);
  setIfPositive('mouthStretchLeft', c['mouth.widen']);
  setIfPositive('mouthStretchRight', c['mouth.widen']);
  setIfPositive('mouthPucker', c['mouth.pucker']);
  setIfPositive('mouthFunnel', c['mouth.funnel']);

  // Cheeks
  setIfPositive('cheekPuff', c['cheek.puff']);
  setIfPositive('cheekSquintLeft', c['cheek.squint.left']);
  setIfPositive('cheekSquintRight', c['cheek.squint.right']);

  return weights;
}

// =============================================================================
// SERIALIZABLE FACE COMMAND TYPES
// =============================================================================

export interface FaceLookAtCommand {
  readonly type: 'lookAt';
  readonly target: { readonly x: number; readonly y: number; readonly z: number } | { readonly yaw: number; readonly pitch: number };
  readonly transitionSeconds?: number;
}

export interface FaceSetExpressionCommand {
  readonly type: 'setExpression';
  readonly expression: ExtendedEmotionName;
  readonly intensity?: number;
  readonly transitionSeconds?: number;
}

export interface FaceSetChannelCommand {
  readonly type: 'setChannel';
  readonly channel: FaceSemanticChannelName;
  readonly value: number;
  readonly transitionSeconds?: number;
}

export interface FaceBlinkCommand {
  readonly type: 'blink';
  readonly eye?: 'both' | 'left' | 'right';
  readonly durationSeconds?: number;
}

export interface FacePlayVisemesCommand {
  readonly type: 'playVisemes';
  readonly sequence: readonly VisemeKeyframe[];
  readonly blendMode?: 'additive' | 'replace';
}

export interface FaceResetCommand {
  readonly type: 'reset';
  readonly transitionSeconds?: number;
}

export type FaceCommand =
  | FaceLookAtCommand
  | FaceSetExpressionCommand
  | FaceSetChannelCommand
  | FaceBlinkCommand
  | FacePlayVisemesCommand
  | FaceResetCommand;
