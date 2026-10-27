import { findRunwaySite, RUNWAY_LENGTH_M, runwayDistanceM, runwayFrame, type IRunwaySite, type Vec3 } from './runway-site';

const RADIUS_M = 600_000;
const centre: Vec3 = [0, 0, 1];
const { along, across } = runwayFrame(centre, 0.4);
const site: IRunwaySite = { centre, along, across, heightM: 100 };

/** Direction `a` metres along and `b` metres across the runway from the site. */
function at(a: number, b: number): Vec3 {
  const x = centre[0] + (along[0] * a + across[0] * b) / RADIUS_M;
  const y = centre[1] + (along[1] * a + across[1] * b) / RADIUS_M;
  const z = centre[2] + (along[2] * a + across[2] * b) / RADIUS_M;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

describe('runway site frame', () => {
  it('builds an orthonormal tangent frame', () => {
    const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    expect(dot(along, centre)).toBeCloseTo(0, 9);
    expect(dot(across, centre)).toBeCloseTo(0, 9);
    expect(dot(along, across)).toBeCloseTo(0, 9);
  });

  it('measures the distance outside the runway rectangle', () => {
    expect(runwayDistanceM(site, at(0, 0), RADIUS_M)).toBeLessThan(0);
    expect(runwayDistanceM(site, at(RUNWAY_LENGTH_M / 2 + 50, 0), RADIUS_M)).toBeCloseTo(50, 1);
  });
});

describe('findRunwaySite', () => {
  it('picks the flat dry plateau and ignores water', () => {
    const found = findRunwaySite(
      {
        heightM: (d) => (d[1] > 0.5 ? 200 : d[1] < -0.5 ? null : 200 + 400 * Math.abs(d[0])),
      },
      RADIUS_M,
    );
    expect(found).not.toBeNull();
    expect(found!.heightM).toBeGreaterThanOrEqual(200);
  });

  it('returns null with no dry land', () => {
    expect(findRunwaySite({ heightM: () => null }, RADIUS_M)).toBeNull();
  });
});
