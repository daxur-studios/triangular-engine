import {
  ARKIT_BLENDSHAPE_NAMES,
  blendBlendShapeWeights,
  EMOTION_NAMES,
  mergeBlendShapeWeights,
  OCULUS_TO_ARKIT,
  sampleEmotion,
} from './blend-shapes';

describe('blend-shapes', () => {
  it('defines the 52 canonical ARKit blendshape names', () => {
    expect(ARKIT_BLENDSHAPE_NAMES).toHaveSize(52);
    expect(new Set(ARKIT_BLENDSHAPE_NAMES).size).toBe(52);
  });

  it('maps every Oculus name to an ARKit name', () => {
    const arkit = new Set<string>(ARKIT_BLENDSHAPE_NAMES);
    for (const value of Object.values(OCULUS_TO_ARKIT)) {
      expect(arkit.has(value)).toBeTrue();
    }
  });

  it('returns an empty weight map for the neutral emotion', () => {
    expect(Object.keys(sampleEmotion('neutral')).length).toBe(0);
  });

  it('scales emotion weights by intensity', () => {
    expect(sampleEmotion('happy').mouthSmileLeft).toBeCloseTo(0.6, 6);
    expect(sampleEmotion('happy', 0.5).mouthSmileLeft).toBeCloseTo(0.3, 6);
    expect(sampleEmotion('happy', 0).mouthSmileLeft).toBeUndefined();
  });

  it('keeps every declared emotion producible', () => {
    for (const emotion of EMOTION_NAMES) {
      expect(() => sampleEmotion(emotion)).not.toThrow();
    }
  });

  it('lerps between two weight maps and drops near-zero keys', () => {
    const result = blendBlendShapeWeights({ jawOpen: 0 }, { jawOpen: 1, mouthPucker: 0.5 }, 0.5);
    expect(result.jawOpen).toBeCloseTo(0.5, 6);
    expect(result.mouthPucker).toBeCloseTo(0.25, 6);
    expect(blendBlendShapeWeights({ jawOpen: 1 }, { jawOpen: 1 }, 1).jawOpen).toBeCloseTo(1, 6);
  });

  it('merges weight maps by taking the max per key', () => {
    const merged = mergeBlendShapeWeights(
      { jawOpen: 0.4, mouthSmileLeft: 0.6 },
      { jawOpen: 0.8, browInnerUp: 0.3 },
    );
    expect(merged.jawOpen).toBeCloseTo(0.8, 6);
    expect(merged.mouthSmileLeft).toBeCloseTo(0.6, 6);
    expect(merged.browInnerUp).toBeCloseTo(0.3, 6);
  });
});
