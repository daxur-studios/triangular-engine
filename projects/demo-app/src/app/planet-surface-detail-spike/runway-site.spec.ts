import {
  findRunwaySite,
  RUNWAY_APRON_M,
  RUNWAY_LENGTH_M,
  RUNWAY_SHOULDER_M,
  runwayFrame,
  runwayHeightStamp,
  runwayStampWeight,
  type IRunwaySite,
  type Vec3,
} from './runway-site';

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

describe('runway height stamp', () => {
  it('builds an orthonormal tangent frame', () => {
    const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    expect(dot(along, centre)).toBeCloseTo(0, 9);
    expect(dot(across, centre)).toBeCloseTo(0, 9);
    expect(dot(along, across)).toBeCloseTo(0, 9);
  });

  it('is fully applied on the runway and its apron', () => {
    expect(runwayStampWeight(site, at(0, 0), RADIUS_M)).toBe(1);
    expect(runwayStampWeight(site, at(RUNWAY_LENGTH_M / 2 + RUNWAY_APRON_M - 1, 0), RADIUS_M)).toBe(1);
  });

  it('leaves terrain beyond the shoulder untouched', () => {
    const far = at(RUNWAY_LENGTH_M / 2 + RUNWAY_APRON_M + RUNWAY_SHOULDER_M + 50, 0);
    expect(runwayStampWeight(site, far, RADIUS_M)).toBe(0);
    expect(runwayHeightStamp(site)(far, 321, RADIUS_M)).toBe(321);
  });

  it('flattens to the site height on the runway', () => {
    expect(runwayHeightStamp(site)(at(300, 5), 480, RADIUS_M)).toBeCloseTo(100, 6);
  });

  it('falls monotonically and continuously over the shoulder', () => {
    const start = RUNWAY_LENGTH_M / 2 + RUNWAY_APRON_M;
    let previous = 1;
    for (let m = 0; m <= RUNWAY_SHOULDER_M; m += 20) {
      const w = runwayStampWeight(site, at(start + m, 0), RADIUS_M);
      expect(w).toBeLessThanOrEqual(previous + 1e-9);
      expect(previous - w).toBeLessThan(0.08);
      previous = w;
    }
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
