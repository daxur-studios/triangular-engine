import {
  characterVectorAdd,
  characterVectorCross,
  characterVectorDot,
  characterVectorScale,
  characterVectorSubtract,
} from './character-vector';

describe('characterVector', () => {
  it('adds and subtracts componentwise', () => {
    const sum = characterVectorAdd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(sum).toEqual({ x: 5, y: 7, z: 9 });
    const diff = characterVectorSubtract({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(diff).toEqual({ x: -3, y: -3, z: -3 });
  });

  it('scales componentwise', () => {
    expect(characterVectorScale({ x: 1, y: -2, z: 0.5 }, 2)).toEqual({ x: 2, y: -4, z: 1 });
  });

  it('computes the dot product', () => {
    expect(characterVectorDot({ x: 1, y: 2, z: 3 }, { x: 4, y: -5, z: 6 })).toBeCloseTo(12, 6);
  });

  it('computes a right-handed cross product', () => {
    expect(characterVectorCross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
  });
});
