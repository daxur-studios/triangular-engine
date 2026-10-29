import type { BufferGeometry } from 'three';
import type { CapsuleCatTailPose } from 'triangular-engine/characters';
import { CapsuleCatTailMesh } from './capsule-cat-tail';

/**
 * Counts non-degenerate triangles whose winding produces a face normal pointing
 * against the stored vertex normals. A non-zero count means the tube is wound
 * inside out and disappears with backface culling, which the tail material uses.
 */
function measureWinding(geometry: BufferGeometry): {
  total: number;
  inward: number;
  offenders: string[];
} {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!position || !normal || !index) {
    return { total: 0, inward: 0, offenders: [] };
  }

  let total = 0;
  let inward = 0;
  const offenders: string[] = [];

  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    const abX = position.getX(b) - position.getX(a);
    const abY = position.getY(b) - position.getY(a);
    const abZ = position.getZ(b) - position.getZ(a);
    const acX = position.getX(c) - position.getX(a);
    const acY = position.getY(c) - position.getY(a);
    const acZ = position.getZ(c) - position.getZ(a);
    const faceX = abY * acZ - abZ * acY;
    const faceY = abZ * acX - abX * acZ;
    const faceZ = abX * acY - abY * acX;
    if (Math.hypot(faceX, faceY, faceZ) < 1e-9) continue;
    total++;

    const averageNormalX =
      (normal.getX(a) + normal.getX(b) + normal.getX(c)) / 3;
    const averageNormalY =
      (normal.getY(a) + normal.getY(b) + normal.getY(c)) / 3;
    const averageNormalZ =
      (normal.getZ(a) + normal.getZ(b) + normal.getZ(c)) / 3;
    const outwardDot =
      faceX * averageNormalX + faceY * averageNormalY + faceZ * averageNormalZ;
    if (outwardDot <= 0) {
      inward++;
      if (offenders.length < 8) offenders.push(`triangle ${offset / 3}`);
    }
  }

  return { total, inward, offenders };
}

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
    const posArray = tail.geometry.getAttribute('position')
      .array as Float32Array;
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

  it('winds the tube so triangles face outward from the tail', () => {
    const tail = new CapsuleCatTailMesh({ color: '#e8b07a' });

    const initial = measureWinding(tail.geometry);
    tail.updateFromPose(pose(0.4));
    const swayed = measureWinding(tail.geometry);
    tail.dispose();

    expect(initial.total).toBeGreaterThan(0);
    expect(initial.inward)
      .withContext(
        `rest pose has ${initial.inward}/${initial.total} inside-out triangles: ${initial.offenders.join(', ')}`,
      )
      .toBe(0);
    expect(swayed.total).toBeGreaterThan(0);
    expect(swayed.inward)
      .withContext(
        `swayed pose has ${swayed.inward}/${swayed.total} inside-out triangles: ${swayed.offenders.join(', ')}`,
      )
      .toBe(0);
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
