import { planetMapExtents, planetMapRowHalfWidth, planetMapXY, PLANET_MAP_EQUAL_EARTH_SCALE } from '../../planet-material/planet-map';
import { cubeComponent } from './lod-lattice';
import { morphMapXY, morphRowHalfWidth, morphExtents, MORPH_EQUAL_EARTH_SCALE, referenceVertex } from './lod-morph-frame';
import { DOUBLE_LIB, FLOAT32_LIB, atan2R, cosW, latticeOffset, sinPoly, sinW, sincPoly, type Num } from './lod-morph-math';
import {
  TEST_STEPS, directionOfT, evaluateVertex, exactRel, latticeVector, liftFrame, sceneCameraAt, sideOf, sphereDomain, testFrame, testMap, verticesAround,
} from './lod-morph.testing';

/** Plan 059, step G6b: the anchor-relative bend (P2) over the number libraries, against the definition in doubles. */

const norm = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);

describe('lod-morph-math: small-safe trig', () => {
  it('sinW, cosW and atan2R keep their digits for tiny angles in float32 arithmetic', () => {
    for (const x of [1e-7, 3e-6, 1e-3, 0.4, 2.5, -5.1]) {
      const n = FLOAT32_LIB.num(x);
      expect(Math.abs(sinW(FLOAT32_LIB, n).v - Math.sin(Math.fround(x)))).toBeLessThan(2e-7 * Math.abs(Math.sin(x)) + (Math.abs(x) > 1 ? 1e-6 : 1e-30));
      expect(Math.abs(cosW(FLOAT32_LIB, n).v - Math.cos(Math.fround(x)))).toBeLessThan(2e-6);
    }
    for (const angle of [1e-9, 2e-7, 1e-4, 0.3, 1.2, -2, 3]) {
      const y = FLOAT32_LIB.num(Math.sin(angle) * 0.7);
      const x = FLOAT32_LIB.num(Math.cos(angle) * 0.7);
      const got = atan2R(FLOAT32_LIB, y, x).v;
      const want = Math.atan2(y.v, x.v);
      expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * 5e-7 + 1e-12);
    }
    expect(atan2R(DOUBLE_LIB, DOUBLE_LIB.num(0), DOUBLE_LIB.num(0)).v).toBe(0);
  });

  it('sinPoly and sincPoly follow sin for the small angles of a lattice difference', () => {
    for (const x of [1e-9, 1e-6, 1e-3, 0.05, 0.4, 0.78]) {
      expect(Math.abs(sinPoly(DOUBLE_LIB, DOUBLE_LIB.num(x)).v - Math.sin(x))).toBeLessThan(1e-12 * Math.max(x, 1e-9));
      expect(Math.abs(sincPoly(DOUBLE_LIB, DOUBLE_LIB.num(x)).v - Math.sin(x) / x)).toBeLessThan(1e-12);
    }
  });
});

describe('lod-morph-math: the lattice stage', () => {
  it('latticeOffset gives the unit direction difference of two lattice points, in float32 to about a part in 1e6 of the offset', () => {
    const domain = sphereDomain(6_371_000);
    const frame = testFrame(testMap(6_371_000, 0.5), domain, sceneCameraAt(testMap(6_371_000, 0.5), 0.3, 0.4, 2));
    const lifted = liftFrame(FLOAT32_LIB, frame);
    for (const metres of [1, 50, 3000, 200_000]) {
      for (const t of verticesAround(frame, 6_371_000, metres)) {
        const tN = t.map((x) => FLOAT32_LIB.num(x)) as unknown as [Num, Num, Num];
        const dT = tN.map((x, k) => x.sub(lifted.anchorT[k])) as unknown as [Num, Num, Num];
        const got = latticeOffset(FLOAT32_LIB, { steps: TEST_STEPS, equalAngle: true }, tN, dT, lifted.anchorOrigin as never);
        // The lattice stage measures from the anchor's float32 cube point, normalised (the shader's own origin), not the exact anchor.
        const cube = frame.anchor.cube;
        const cl = norm(cube);
        const a = [cube[0] / cl, cube[1] / cl, cube[2] / cl];
        const b = directionOfT(t, domain);
        const size = Math.max(norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), 1e-12);
        for (let k = 0; k < 3; k++) expect(Math.abs(got.du[k].v - (b[k] - a[k]))).toBeLessThan(2e-6 * size + 1e-12);
      }
    }
  });
});

describe('lod-morph-math: P2 in doubles against the definition', () => {
  const cases = [
    { name: 'mid-latitude, morph 0.5, 6,371 km', radius: 6_371_000, morph: 0.5, lon: 0.3, lat: 0.4, centre: [0, 0] },
    { name: 'mid-latitude, morph 1, 600 km', radius: 600_000, morph: 1, lon: 0.3, lat: 0.4, centre: [0, 0] },
    { name: 'near the pole, morph 0.5', radius: 6_371_000, morph: 0.5, lon: 0.35, lat: 1.5, centre: [0, 0] },
    { name: 'at the projection centre, morph 0.3', radius: 600_000, morph: 0.3, lon: 0, lat: 0, centre: [0, 0] },
    { name: 'off-centre projection, morph 0.7', radius: 6_371_000, morph: 0.7, lon: 0.2, lat: -0.3, centre: [60, 25] },
    { name: 'tiny morph 1e-4', radius: 6_371_000, morph: 1e-4, lon: 0.3, lat: 0.4, centre: [20, 35] },
  ];
  for (const projection of ['equal-earth', 'equirectangular'] as const) {
    for (const c of cases) {
      it(`matches the map and the bend: ${projection}, ${c.name}`, () => {
        const domain = sphereDomain(c.radius);
        const map = testMap(c.radius, c.morph, projection, c.centre[0], c.centre[1]);
        const frame = testFrame(map, domain, sceneCameraAt(map, c.lon, c.lat, 2));
        const lifted = liftFrame(DOUBLE_LIB, frame);
        for (const metres of [0.5, 7, 300, 20_000, 400_000]) {
          for (const t of verticesAround(frame, c.radius, metres)) {
            const sigma = sideOf(map, directionOfT(t, domain));
            const leafLon = referenceVertex(frame, directionOfT(t, domain), sigma, 2).lon;
            const exact = exactRel(frame, domain, t, sigma, 2, leafLon);
            const got = evaluateVertex(DOUBLE_LIB, frame, lifted, domain, t, sigma, 2, leafLon);
            for (let k = 0; k < 3; k++) expect(Math.abs(got.rel[k] - exact[k])).toBeLessThan(5e-6 + 1e-9 * Math.abs(exact[k]));
          }
        }
      });
    }
  }
});

describe('lod-morph-math: float32 emulation (rounded after every operation; not GPU numbers)', () => {
  const scenarios = [
    { name: '6,371 km morph 0.5', radius: 6_371_000, morph: 0.5, lon: 0.3, lat: 0.4 },
    { name: '6,371 km morph 1', radius: 6_371_000, morph: 1, lon: 0.3, lat: 0.4 },
    { name: '600 km morph 0.5', radius: 600_000, morph: 0.5, lon: 0.3, lat: 0.4 },
    { name: '6,371 km morph 0.5 at 80 degrees', radius: 6_371_000, morph: 0.5, lon: 0.3, lat: 1.4 },
  ];
  for (const s of scenarios) {
    it(`stays within a few parts in 1e6 of the distance to the camera: ${s.name}`, () => {
      const domain = sphereDomain(s.radius);
      const map = testMap(s.radius, s.morph, 'equal-earth', 0, 0);
      const frame = testFrame(map, domain, sceneCameraAt(map, s.lon, s.lat, 2));
      const lifted = liftFrame(FLOAT32_LIB, frame);
      for (const metres of [1, 10, 100, 10_000, 500_000]) {
        for (const t of verticesAround(frame, s.radius, metres)) {
          const sigma = sideOf(map, directionOfT(t, domain));
          const leafLon = referenceVertex(frame, directionOfT(t, domain), sigma, 2).lon;
          const exact = exactRel(frame, domain, t, sigma, 2, leafLon);
          const got = evaluateVertex(FLOAT32_LIB, frame, lifted, domain, t, sigma, 2, leafLon);
          const error = Math.hypot(got.rel[0] - exact[0], got.rel[1] - exact[1], got.rel[2] - exact[2]);
          expect(error).toBeLessThan(2e-6 * Math.max(norm(exact), 2) + 1e-4);
        }
      }
    });
  }
});

describe('lod-morph-math: the map (equirectangular target and the 1.1607 scale)', () => {
  it('the scale is the material map scale, about 1.1607', () => {
    expect(MORPH_EQUAL_EARTH_SCALE).toBeCloseTo(PLANET_MAP_EQUAL_EARTH_SCALE, 12);
    expect(MORPH_EQUAL_EARTH_SCALE).toBeCloseTo(1.1607, 4);
  });

  it('the CPU map is planetMapXY: Equal Earth scaled by 1.1607 in x and y, equirectangular (R lon, R lat) at every morph', () => {
    const radius = 600_000;
    for (const projection of ['equal-earth', 'equirectangular'] as const) {
      for (const morph of [0, 0.25, 0.5, 1]) {
        const map = testMap(radius, morph, projection);
        for (const lon of [-3, -1, 0, 0.7, 3.1]) {
          for (const lat of [-1.5, -0.6, 0, 0.4, 1.57]) {
            const want = planetMapXY(lon, lat, morph, projection, radius);
            const got = morphMapXY(lon, lat, map);
            expect(Math.abs(got[0] - want[0])).toBeLessThan(1e-6);
            expect(Math.abs(got[1] - want[1])).toBeLessThan(1e-6);
            if (projection === 'equirectangular') {
              expect(got[0]).toBe(radius * lon);
              expect(got[1]).toBe(radius * lat);
            }
          }
          expect(Math.abs(morphRowHalfWidth(lon / 2, map) - planetMapRowHalfWidth(lon / 2, morph, projection, radius))).toBeLessThan(1e-6);
        }
        const extents = planetMapExtents(morph, projection, radius);
        expect(Math.abs(morphExtents(map).halfWidth - extents.halfWidth)).toBeLessThan(1e-6);
        expect(Math.abs(morphExtents(map).halfHeight - extents.halfHeight)).toBeLessThan(1e-6);
      }
    }
  });

  it('the vertex stage (P2) gives the same dx and dy as the map differences, at morph 0.5 and 1 of each projection', () => {
    const radius = 6_371_000;
    const domain = sphereDomain(radius);
    for (const projection of ['equal-earth', 'equirectangular'] as const) {
      for (const morph of [0.5, 1]) {
        const map = testMap(radius, morph, projection, 20, 35);
        const frame = testFrame(map, domain, sceneCameraAt(map, 0.3, 0.4, 2));
        const lifted = liftFrame(DOUBLE_LIB, frame);
        const a = morphMapXY(frame.values.lamA, Math.atan2(frame.values.sA, frame.values.cA), map);
        for (const metres of [3, 300, 30_000]) {
          for (const t of verticesAround(frame, radius, metres)) {
            const unit = directionOfT(t, domain);
            const sigma = sideOf(map, unit);
            const ref = referenceVertex(frame, unit, sigma, 0);
            const got = evaluateVertex(DOUBLE_LIB, frame, lifted, domain, t, sigma, 0, ref.lon);
            const xy = planetMapXY(ref.lon, ref.lat, morph, projection, radius);
            expect(Math.abs(got.p2.dx.v - (xy[0] - a[0]))).toBeLessThan(2e-6 + 1e-9 * Math.abs(xy[0] - a[0]));
            expect(Math.abs(got.p2.dy.v - (xy[1] - a[1]))).toBeLessThan(2e-6 + 1e-9 * Math.abs(xy[1] - a[1]));
            if (projection === 'equirectangular') {
              // No blend: the row factor is 1 whatever the morph.
              expect(got.p2.g.v).toBe(1);
              expect(Math.abs(got.p2.dx.v - radius * got.p2.dlam.v)).toBeLessThan(1e-6 + 1e-12 * Math.abs(got.p2.dx.v));
            }
          }
        }
      }
    }
  });

  it('the bend is the flat map exactly at morph 1 (k = 0): dG = (dx, dy, 0) and up = z', () => {
    const radius = 6_371_000;
    const domain = sphereDomain(radius);
    const map = testMap(radius, 1, 'equal-earth');
    expect(map.k).toBe(0);
    const frame = testFrame(map, domain, sceneCameraAt(map, 0.3, 0.4, 2));
    const lifted = liftFrame(DOUBLE_LIB, frame);
    for (const metres of [1, 300, 40_000]) {
      for (const t of verticesAround(frame, radius, metres)) {
        const got = evaluateVertex(DOUBLE_LIB, frame, lifted, domain, t, sideOf(map, directionOfT(t, domain)), 0).p2;
        expect(got.dG[0].v).toBe(got.dx.v);
        expect(got.dG[1].v).toBe(got.dy.v);
        expect(Math.abs(got.dG[2].v)).toBe(0);
        expect(got.up[2].v).toBe(1);
      }
    }
  });

  it('applies the height along the bend up (a 500 m offset)', () => {
    const radius = 6_371_000;
    const domain = sphereDomain(radius);
    const map = testMap(radius, 0.5, 'equal-earth');
    const frame = testFrame(map, domain, sceneCameraAt(map, 0.3, 0.4, 2));
    const lifted = liftFrame(DOUBLE_LIB, frame);
    for (const t of verticesAround(frame, radius, 40)) {
      const sigma = sideOf(map, directionOfT(t, domain));
      const leafLon = referenceVertex(frame, directionOfT(t, domain), sigma, 500).lon;
      const exact = exactRel(frame, domain, t, sigma, 500, leafLon);
      const got = evaluateVertex(DOUBLE_LIB, frame, lifted, domain, t, sigma, 500, leafLon);
      for (let k = 0; k < 3; k++) expect(Math.abs(got.rel[k] - exact[k])).toBeLessThan(5e-6);
    }
  });

  it('latticeVector and cubeComponent agree with directionOfT (helper sanity)', () => {
    const domain = sphereDomain(6_371_000);
    const t = latticeVector(4, 1_000_000, 2_000_000);
    const c = t.map((x) => cubeComponent(x, TEST_STEPS, 'equal-angle'));
    const l = norm(c);
    const d = directionOfT(t, domain);
    for (let k = 0; k < 3; k++) expect(d[k]).toBeCloseTo(c[k] / l, 12);
  });
});
