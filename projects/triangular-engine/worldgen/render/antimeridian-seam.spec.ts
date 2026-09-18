import {
  IDENTITY_PROJECTION_BASIS,
  IProjectionBasis,
  edgeCrossesAntimeridian,
  projectedLongitude,
  triangleCrossesAntimeridian,
} from './antimeridian-seam';

describe('antimeridian-seam', () => {
  const dirAt = (
    lonDeg: number,
    latDeg = 0,
  ): { x: number; y: number; z: number } => {
    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;
    return {
      x: Math.cos(lat) * Math.sin(lon),
      y: Math.sin(lat),
      z: Math.cos(lat) * Math.cos(lon),
    };
  };

  it('matches atan2(x, z) longitude for the identity basis', () => {
    for (const lonDeg of [-179, -90, 0, 45, 179]) {
      const dir = dirAt(lonDeg);
      const expected = (lonDeg * Math.PI) / 180;
      expect(projectedLongitude(dir, IDENTITY_PROJECTION_BASIS)).toBeCloseTo(
        expected,
        10,
      );
    }
  });

  it('detects an edge crossing the antimeridian and ignores a nearby one', () => {
    expect(edgeCrossesAntimeridian(dirAt(179), dirAt(-179))).toBeTrue();
    expect(edgeCrossesAntimeridian(dirAt(-179), dirAt(179))).toBeTrue();
    expect(edgeCrossesAntimeridian(dirAt(170), dirAt(179))).toBeFalse();
    expect(edgeCrossesAntimeridian(dirAt(-179), dirAt(-170))).toBeFalse();
  });

  it('flags a triangle only when one of its three edges crosses', () => {
    // The seam-crossing edge is (k1, k2); neither edge touching the center crosses. This is the
    // exact cell-fan shape that a single-counterpart test missed.
    expect(
      triangleCrossesAntimeridian(dirAt(0), dirAt(179), dirAt(-179)),
    ).toBeTrue();

    // Fully on one side of the seam.
    expect(
      triangleCrossesAntimeridian(dirAt(0), dirAt(10), dirAt(-10)),
    ).toBeFalse();
  });

  it('respects a rotated tracking basis', () => {
    // Rotate the frame 90 degrees around Y so +X becomes "forward": projectedLon = atan2(-z, x).
    const basis: IProjectionBasis = {
      forward: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      right: { x: 0, y: 0, z: -1 },
    };

    // +Z is lon 0 in the identity frame but lon -90 in the rotated frame.
    expect(projectedLongitude({ x: 0, y: 0, z: 1 }, basis)).toBeCloseTo(
      -Math.PI / 2,
      10,
    );

    // Two points straddling the rotated seam (x < 0, z = 0) cross there...
    expect(
      edgeCrossesAntimeridian(
        { x: -1, y: 0, z: 0.1 },
        { x: -1, y: 0, z: -0.1 },
        basis,
      ),
    ).toBeTrue();

    // ...while the identity-frame seam (z = 0, x < 0) is no longer a seam in this frame.
    expect(
      edgeCrossesAntimeridian(dirAt(90), dirAt(90.001), basis),
    ).toBeFalse();
  });
});
