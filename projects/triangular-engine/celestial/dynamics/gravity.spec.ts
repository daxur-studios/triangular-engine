import { ICelestialBody } from '../bodies/celestial-body';
import { vec3Length } from '../math/vec3';
import { sphericalGravityForce } from './gravity';

const BODY: ICelestialBody = {
  id: 'test-planet',
  kind: 'planet',
  radiusM: 1000,
  muM3PerS2: 4e6,
};

describe('sphericalGravityForce', () => {
  it('points toward the body center with magnitude mu*mass/r²', () => {
    const force = sphericalGravityForce(BODY, [2000, 0, 0], 10);

    const expectedMagnitude = (BODY.muM3PerS2 * 10) / (2000 * 2000);
    expect(vec3Length(force)).toBeCloseTo(expectedMagnitude, 6);
    expect(force[0]).toBeCloseTo(-expectedMagnitude, 6);
    expect(force[1]).toBeCloseTo(0, 6);
    expect(force[2]).toBeCloseTo(0, 6);
  });

  it('scales linearly with mass', () => {
    const pos: [number, number, number] = [0, 5000, 0];
    const oneKg = sphericalGravityForce(BODY, pos, 1);
    const tenKg = sphericalGravityForce(BODY, pos, 10);
    expect(vec3Length(tenKg)).toBeCloseTo(vec3Length(oneKg) * 10, 6);
  });

  it('falls off with the inverse square of distance', () => {
    const near = sphericalGravityForce(BODY, [1000, 0, 0], 1);
    const far = sphericalGravityForce(BODY, [2000, 0, 0], 1);
    expect(vec3Length(near)).toBeCloseTo(vec3Length(far) * 4, 6);
  });
});
