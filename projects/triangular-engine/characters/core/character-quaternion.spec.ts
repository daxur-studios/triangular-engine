import {
  characterQuaternionIdentity,
  characterQuaternionFromEuler,
  multiplyCharacterQuaternions,
  rotateCharacterVector3,
} from './character-quaternion';

describe('characterQuaternion', () => {
  it('maps the identity Euler to the identity quaternion', () => {
    const q = characterQuaternionFromEuler(0, 0, 0);
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(0, 6);
    expect(q.z).toBeCloseTo(0, 6);
    expect(q.w).toBeCloseTo(1, 6);
  });

  it('rotates +Y onto +Z for a +90° X rotation', () => {
    const q = characterQuaternionFromEuler(Math.PI / 2, 0, 0);
    const out = rotateCharacterVector3(q, { x: 0, y: 1, z: 0 });
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(1, 6);
  });

  it('rotates +Z onto +X for a +90° Y rotation', () => {
    const q = characterQuaternionFromEuler(0, Math.PI / 2, 0);
    const out = rotateCharacterVector3(q, { x: 0, y: 0, z: 1 });
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('multiplying by the identity leaves a quaternion unchanged', () => {
    const q = characterQuaternionFromEuler(0.3, -0.4, 0.7);
    const out = multiplyCharacterQuaternions(q, characterQuaternionIdentity());
    expect(out.x).toBeCloseTo(q.x, 6);
    expect(out.y).toBeCloseTo(q.y, 6);
    expect(out.z).toBeCloseTo(q.z, 6);
    expect(out.w).toBeCloseTo(q.w, 6);
  });
});
