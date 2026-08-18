import { vec3Length } from './vec3';
import {
  QUAT_IDENTITY,
  quatApplyToVec3,
  quatConjugate,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatMultiply,
} from './quat';

describe('quatApplyToVec3', () => {
  it('leaves a vector unchanged under the identity quaternion', () => {
    expect(quatApplyToVec3(QUAT_IDENTITY, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('rotates +X to +Y under a 90-degree +Z-axis rotation', () => {
    const q = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
    const [x, y, z] = quatApplyToVec3(q, [1, 0, 0]);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(1, 9);
    expect(z).toBeCloseTo(0, 9);
  });
});

describe('quatFromUnitVectors', () => {
  it('produces identity when from equals to', () => {
    const q = quatFromUnitVectors([0, 1, 0], [0, 1, 0]);
    const [x, y, z, w] = q;
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
    expect(w).toBeCloseTo(1, 9);
  });

  it('maps +Y to +X, matching the launch-site pole-to-equator case', () => {
    const q = quatFromUnitVectors([0, 1, 0], [1, 0, 0]);
    const [x, y, z] = quatApplyToVec3(q, [0, 1, 0]);
    expect(x).toBeCloseTo(1, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
  });

  it('handles the antiparallel (180-degree) case without NaN', () => {
    const q = quatFromUnitVectors([1, 0, 0], [-1, 0, 0]);
    const rotated = quatApplyToVec3(q, [1, 0, 0]);
    expect(vec3Length(rotated)).toBeCloseTo(1, 6);
    expect(rotated[0]).toBeCloseTo(-1, 6);
  });
});

describe('quatMultiply', () => {
  it('applies the right-hand operand first', () => {
    const rotY90 = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    const rotZ90 = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
    const combined = quatMultiply(rotZ90, rotY90);

    const viaCombined = quatApplyToVec3(combined, [1, 0, 0]);
    const viaSequential = quatApplyToVec3(
      rotZ90,
      quatApplyToVec3(rotY90, [1, 0, 0]),
    );

    expect(viaCombined[0]).toBeCloseTo(viaSequential[0], 9);
    expect(viaCombined[1]).toBeCloseTo(viaSequential[1], 9);
    expect(viaCombined[2]).toBeCloseTo(viaSequential[2], 9);
  });
});

describe('quatConjugate', () => {
  it('inverts a unit quaternion’s rotation', () => {
    const q = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
    const inv = quatConjugate(q);
    const roundTrip = quatApplyToVec3(inv, quatApplyToVec3(q, [1, 0, 0]));
    expect(roundTrip[0]).toBeCloseTo(1, 9);
    expect(roundTrip[1]).toBeCloseTo(0, 9);
    expect(roundTrip[2]).toBeCloseTo(0, 9);
  });
});
