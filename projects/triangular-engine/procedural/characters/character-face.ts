import { SkinnedMesh } from 'three';
import type { BlendShapeWeights } from 'triangular-engine/characters';

export const CHARACTER_FACE_MORPH_NAMES = [
  'jawOpen',
  'mouthOpen',
  'mouthSmile',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'browDownLeft',
  'browDownRight',
] as const;

export type CharacterFaceMorphName = (typeof CHARACTER_FACE_MORPH_NAMES)[number];

export type CharacterFaceWeights = Readonly<Record<CharacterFaceMorphName, number>>;

function max01(...values: readonly (number | undefined)[]): number {
  let result = 0;
  for (const value of values) {
    if (value !== undefined && value > result) result = value;
  }
  return Math.min(1, result);
}

/**
 * Projects ARKit blendshape weights onto the procedural face's seven morph
 * targets. This is a lossy, functional mapping (the procedural face has no
 * funnel/pucker/cheek channels), so rounded lip shapes approximate an open
 * mouth and smile/stretch share one target.
 */
export function arkitToCharacterFace(weights: BlendShapeWeights): CharacterFaceWeights {
  return {
    jawOpen: weights.jawOpen ?? 0,
    mouthOpen: max01(weights.mouthFunnel, weights.mouthPucker) * 0.5,
    mouthSmile: max01(
      weights.mouthSmileLeft,
      weights.mouthSmileRight,
      weights.mouthStretchLeft,
      weights.mouthStretchRight,
    ),
    eyeBlinkLeft: weights.eyeBlinkLeft ?? 0,
    eyeBlinkRight: weights.eyeBlinkRight ?? 0,
    browDownLeft: weights.browDownLeft ?? 0,
    browDownRight: weights.browDownRight ?? 0,
  };
}

/** Writes ARKit blendshape weights into a skinned mesh's morph influences or vector face canvas. */
export function applyCharacterFacePose(mesh: SkinnedMesh, weights: BlendShapeWeights): void {
  const face = arkitToCharacterFace(weights);

  if (typeof mesh.userData?.['vectorFace'] === 'function') {
    mesh.userData['vectorFace'](face);
  }

  const influences = mesh.morphTargetInfluences;
  if (!influences || !mesh.morphTargetDictionary) return;

  for (const name of CHARACTER_FACE_MORPH_NAMES) {
    const index = mesh.morphTargetDictionary[name];
    if (index !== undefined && index >= 0 && index < influences.length) {
      influences[index] = face[name];
    }
  }
}
