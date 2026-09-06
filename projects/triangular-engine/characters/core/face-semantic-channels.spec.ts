import {
  EXPRESSION_PRESETS,
  FACE_SEMANTIC_CHANNEL_NAMES,
  clamp01,
  expandSemanticChannels,
  semanticChannelsToBlendShapes,
} from './face-semantic-channels';

describe('face-semantic-channels', () => {
  it('defines all required canonical semantic channels', () => {
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('brow.left.raise');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('brow.right.raise');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('brow.left.lower');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('brow.right.lower');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('eye.blink.left');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('eye.blink.right');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('mouth.smile');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('mouth.frown');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('mouth.jawOpen');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('mouth.lipClose');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('mouth.round');
    expect(FACE_SEMANTIC_CHANNEL_NAMES).toContain('mouth.widen');
  });

  it('clamps values cleanly in [0, 1]', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.7)).toBe(0.7);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
  });

  it('expands paired shortcuts like mouth.smile into left and right channels', () => {
    const expanded = expandSemanticChannels({ 'mouth.smile': 0.8 });
    expect(expanded['mouth.smile.left']).toBe(0.8);
    expect(expanded['mouth.smile.right']).toBe(0.8);
  });

  it('supports raising only the right eyebrow independently', () => {
    const expanded = expandSemanticChannels({
      'brow.right.raise': 0.85,
      'brow.left.lower': 0.2,
    });
    expect(expanded['brow.right.raise']).toBe(0.85);
    expect(expanded['brow.left.raise'] ?? 0).toBe(0);
    expect(expanded['brow.left.lower']).toBe(0.2);

    const blendShapes = semanticChannelsToBlendShapes(expanded);
    expect(blendShapes.browOuterUpRight).toBe(0.85);
    expect(blendShapes.browOuterUpLeft).toBeUndefined();
    expect(blendShapes.browDownLeft).toBe(0.2);
  });

  it('maps expression presets onto ARKit 52 blendshape weights', () => {
    const happyShapes = semanticChannelsToBlendShapes(EXPRESSION_PRESETS.happy);
    expect(happyShapes.mouthSmileLeft).toBeGreaterThan(0.5);
    expect(happyShapes.mouthSmileRight).toBeGreaterThan(0.5);
    expect(happyShapes.cheekSquintLeft).toBeGreaterThan(0.2);

    const sadShapes = semanticChannelsToBlendShapes(EXPRESSION_PRESETS.sad);
    expect(sadShapes.mouthFrownLeft).toBeGreaterThan(0.4);
    expect(sadShapes.mouthFrownRight).toBeGreaterThan(0.4);

    const surprisedShapes = semanticChannelsToBlendShapes(EXPRESSION_PRESETS.surprised);
    expect(surprisedShapes.jawOpen).toBeGreaterThan(0.5);
    expect(surprisedShapes.eyeWideLeft).toBeGreaterThan(0.5);

    const angryShapes = semanticChannelsToBlendShapes(EXPRESSION_PRESETS.angry);
    expect(angryShapes.browDownLeft).toBeGreaterThan(0.5);
    expect(angryShapes.browDownRight).toBeGreaterThan(0.5);

    const skepticalShapes = semanticChannelsToBlendShapes(EXPRESSION_PRESETS.skeptical);
    expect(skepticalShapes.browOuterUpRight).toBeGreaterThan(0.7);
    expect(skepticalShapes.browDownLeft).toBeGreaterThan(0.1);
  });

  it('maps lip closure, rounding, and widening to standard ARKit channels', () => {
    const shapes = semanticChannelsToBlendShapes({
      'mouth.lipClose': 0.9,
      'mouth.round': 0.75,
      'mouth.widen': 0.6,
    });
    expect(shapes.mouthClose).toBe(0.9);
    expect(shapes.mouthPucker).toBe(0.75);
    expect(shapes.mouthStretchLeft).toBe(0.6);
    expect(shapes.mouthStretchRight).toBe(0.6);
  });
});
