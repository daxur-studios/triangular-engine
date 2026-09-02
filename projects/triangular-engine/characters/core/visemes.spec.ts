import {
  preProcessText,
  sampleVisemeTrack,
  textToBlendShapesAt,
  visemeToBlendShapes,
  VISEME_BLENDSHAPE_KEYS,
  VISEME_NAMES,
  wordsToVisemes,
} from './visemes';

describe('visemes', () => {
  it('normalizes text into lowercase word tokens', () => {
    expect(preProcessText('Hello, World!')).toEqual(['hello', 'world']);
    expect(preProcessText("  It's a test  ")).toEqual(['its', 'a', 'test']);
  });

  it('produces a monotonic, non-negative timed track', () => {
    const track = wordsToVisemes(['hello', 'world']);
    expect(track.length).toBeGreaterThan(0);
    let previous = -1;
    for (const keyframe of track) {
      expect(keyframe.time).toBeGreaterThanOrEqual(previous);
      expect(keyframe.duration).toBeGreaterThan(0);
      expect(VISEME_NAMES).toContain(keyframe.viseme);
      previous = keyframe.time;
    }
  });

  it('collapses repeated graphemes and inserts word gaps', () => {
    const track = wordsToVisemes(['hello']);
    const nonSil = track.filter((k) => k.viseme !== 'sil');
    expect(nonSil.map((k) => k.viseme)).toEqual(['C', 'E', 'L', 'O']);
    expect(track[track.length - 1].viseme).toBe('sil');
  });

  it('samples silence outside the track', () => {
    const track = wordsToVisemes(['hi']);
    expect(sampleVisemeTrack(track, -1)).toBe('sil');
    expect(sampleVisemeTrack(track, 1e9)).toBe('sil');
  });

  it('maps visemes to a known ARKit blendshape subset', () => {
    expect(visemeToBlendShapes('M').mouthPressLeft).toBeCloseTo(0.7, 6);
    expect(visemeToBlendShapes('M').mouthPressRight).toBeCloseTo(0.7, 6);
    expect(visemeToBlendShapes('A').jawOpen).toBeCloseTo(0.75, 6);
  });

  it('computes deterministic blendshape weights for text at a time', () => {
    const at = textToBlendShapesAt(['hello'], 0.01);
    const again = textToBlendShapesAt(['hello'], 0.01);
    expect(at).toEqual(again);
  });

  it('exposes only ARKit names in its blendshape keys', () => {
    expect(VISEME_BLENDSHAPE_KEYS.length).toBeGreaterThan(0);
    for (const key of VISEME_BLENDSHAPE_KEYS) {
      expect(key).toMatch(/^[a-z][A-Za-z]+$/);
    }
  });

  it('rejects invalid timing options', () => {
    expect(() => wordsToVisemes(['hi'], { wordsPerMinute: 0 })).toThrowError(RangeError);
    expect(() => wordsToVisemes(['hi'], { wordGapSeconds: -1 })).toThrowError(RangeError);
  });
});
