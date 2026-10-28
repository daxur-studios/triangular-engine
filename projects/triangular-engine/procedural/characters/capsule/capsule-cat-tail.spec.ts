import type { CapsuleCatTailPose } from 'triangular-engine/characters';
import { CapsuleCatTailMesh } from './capsule-cat-tail';

function pose(sway: number): CapsuleCatTailPose {
  return {
    base: { x: 0, y: 0.05, z: -0.35 },
    control1: { x: sway * 0.2, y: 0.22, z: -0.5 },
    control2: { x: -sway * 0.4, y: 0.42, z: -0.52 },
    tip: { x: sway, y: 0.56, z: -0.35 },
    radius: 0.045,
  };
}

describe('capsule-cat-tail', () => {
  it('updates the pre-allocated tube in place as the S-curve sways', () => {
    const tail = new CapsuleCatTailMesh({ color: '#e8b07a' });
    const geometry = tail.geometry;
    const posArray = tail.geometry.getAttribute('position').array as Float32Array;
    const before = posArray[0];

    tail.updateFromPose(pose(0.2));
    const afterFirst = posArray[0];
    tail.updateFromPose(pose(-0.2));

    expect(tail.geometry).toBe(geometry);
    expect(tail.geometry.getAttribute('position').array).toBe(posArray);
    expect(afterFirst).not.toBe(before);
    expect(posArray[0]).not.toBe(afterFirst);
    tail.dispose();
  });

  it('updates the tail color without rebuilding geometry', () => {
    const tail = new CapsuleCatTailMesh({ color: '#e8b07a' });
    const geometry = tail.geometry;
    tail.setColor('#d89a63');
    expect(tail.geometry).toBe(geometry);
    expect(tail.material.color.getHexString()).toBe('d89a63');
    tail.dispose();
  });
});
