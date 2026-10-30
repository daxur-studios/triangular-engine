import { unwrapToSide } from './lod-morph-frame';
import { poleLattices } from './lod-morph-leaves';
import { DOUBLE_LIB, FLOAT32_LIB } from './lod-morph-math';
import {
  TEST_STEPS, directionOfT, evaluateVertex, exactRel, latticeVector, liftFrame, sceneCameraAt, sphereDomain, testFrame, testMap, unitMetres,
} from './lod-morph.testing';

/**
 * Plan 059, step G6b: the pole zone. A vertex within about 1 km of a pole of the projection is placed by the lattice stage run with
 * the pole as its origin (`poleAngles`), because its longitude is the angle of a horizontal vector of the vertex's own size
 * (rho / R), which the anchor's offset cannot give once the anchor is metres away and the pole is not at the anchor.
 *
 * The pole stage cuts the error, but it does not remove the float32 floor: the longitude of a vertex 1 m from the pole decides x = R g
 * lambda, and float32 holds the vertex's direction angle only to about 6e-8 rad, which is about 0.05 m of x at 6,371 km. So a vertex
 * within ~10 m of the camera and ~1 km of the pole can miss by more than a pixel. The specs state that floor.
 */

const PIXEL = (2 * Math.tan(Math.PI / 6)) / 1080; // radians per pixel, 60 degree vertical field of view at 1080 px
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface PoleCase {
  readonly radius: number;
  readonly morph: number;
  readonly centre: [number, number];
}

const CASES: PoleCase[] = [];
for (const radius of [600_000, 6_371_000]) {
  for (const morph of [0.5, 1]) {
    for (const centre of [[0, 0], [20, 35]] as [number, number][]) CASES.push({ radius, morph, centre });
  }
}
const label = (c: PoleCase): string => `${c.radius / 1000} km, morph ${c.morph}, centre ${c.centre[0]}/${c.centre[1]}`;

/** A pole of the projection that is on a face, as a lattice position (u, v) of that face. */
function poleOnAFace(c: PoleCase): { face: number; u: number; v: number } {
  const map = testMap(c.radius, c.morph, 'equal-earth', c.centre[0], c.centre[1]);
  for (let face = 0; face < 6; face++) {
    const found = poleLattices(map.basis, TEST_STEPS, face, 'equal-angle').find((p) => p.sign === 1);
    if (found) return { face, u: found.u, v: found.v };
  }
  throw new Error('no pole');
}

/** Errors of a vertex `rho` metres from the pole against a camera `rhoCamera` metres from it at bearing offset `turn`. */
function measure(c: PoleCase, rho: number, rhoCamera: number, turn: number, poleStage: boolean, lib = FLOAT32_LIB): { error: number; distance: number; usedPole: boolean } {
  const domain = sphereDomain(c.radius);
  const map = testMap(c.radius, c.morph, 'equal-earth', c.centre[0], c.centre[1]);
  const { face, u, v } = poleOnAFace(c);
  const place = (r: number, angle: number) => {
    const k = r / unitMetres(c.radius);
    return latticeVector(face, Math.round(u + k * Math.cos(angle)), Math.round(v + k * Math.sin(angle)));
  };
  const t = place(rho, 0.3);
  const tc = place(rhoCamera, 0.3 + turn);
  const unit = directionOfT(t, domain);
  const lon = Math.atan2(dot(unit, map.basis.right), dot(unit, map.basis.forward));
  const dc = directionOfT(tc, domain);
  const sigma = lon >= 0 ? 1 : -1;
  const leafLon = unwrapToSide(lon, sigma).lon;
  const cameraLon = unwrapToSide(Math.atan2(dot(dc, map.basis.right), dot(dc, map.basis.forward)), sigma).lon;
  const cameraLat = Math.asin(Math.max(-1, Math.min(1, dot(dc, map.basis.up))));
  const frame = testFrame(map, domain, sceneCameraAt(map, cameraLon, cameraLat, 2));
  const exact = exactRel(frame, domain, t, sigma, 2, leafLon);
  const used = poleStage ? frame : ({ ...frame, values: { ...frame.values, poleOn: 0 } } as typeof frame);
  const got = evaluateVertex(lib, used, liftFrame(lib, used), domain, t, sigma, 2, leafLon);
  return {
    error: Math.hypot(got.rel[0] - exact[0], got.rel[1] - exact[1], got.rel[2] - exact[2]),
    distance: Math.max(2, Math.hypot(exact[0], exact[1], exact[2])),
    usedPole: got.usedPole,
  };
}

const RHOS = [1, 10, 100, 1000];
const CAMERAS = [1, 10, 100, 1000];
const TURNS = [0, 0.05, 1];

describe('lod-morph pole zone: doubles', () => {
  for (const c of CASES) {
    it(`the pole path is exact to the reference's own rounding: ${label(c)}`, () => {
      for (const rho of RHOS) {
        for (const rhoCamera of CAMERAS) {
          const m = measure(c, rho, rhoCamera, 0.05, true, DOUBLE_LIB);
          // The reference forms the pole vertex's longitude from a horizontal vector of size rho / R in doubles: 1e-16 R / (rho / R).
          expect(m.error).toBeLessThan(1e-6 + (3e-16 * c.radius * c.radius) / Math.max(rho, 0.5));
        }
      }
    });
  }
});

describe('lod-morph pole zone: float32 emulation, a vertex 1 m to 1 km from the pole, camera at 2 m altitude', () => {
  for (const c of CASES) {
    it(`stays under 1 px when the camera is 60 m or more away, and under 6 cm closer: ${label(c)}`, () => {
      let worstPixels = 0;
      let worstClose = 0;
      for (const rho of RHOS) {
        for (const rhoCamera of CAMERAS) {
          for (const turn of TURNS) {
            const m = measure(c, rho, rhoCamera, turn, true);
            const pixels = m.error / (m.distance * PIXEL);
            if (m.distance >= 60) worstPixels = Math.max(worstPixels, pixels);
            else worstClose = Math.max(worstClose, m.error);
          }
        }
      }
      console.log(`[lod-morph-pole] ${label(c)}: worst ${worstPixels.toFixed(2)} px at 60 m or more, worst ${worstClose.toFixed(3)} m closer`);
      expect(worstPixels).toBeLessThan(1);
      expect(worstClose).toBeLessThan(0.06);
    });

    it(`is no worse than the anchor alone, and much better where the anchor alone fails: ${label(c)}`, () => {
      let withPole = 0;
      let anchorOnly = 0;
      for (const rho of RHOS) {
        for (const rhoCamera of CAMERAS) {
          for (const turn of TURNS) {
            const a = measure(c, rho, rhoCamera, turn, true);
            const b = measure(c, rho, rhoCamera, turn, false);
            withPole = Math.max(withPole, a.error / (a.distance * PIXEL));
            anchorOnly = Math.max(anchorOnly, b.error / (b.distance * PIXEL));
          }
        }
      }
      console.log(`[lod-morph-pole] ${label(c)}: worst ${withPole.toFixed(2)} px with the pole stage, ${anchorOnly.toFixed(2)} px anchor only`);
      expect(withPole).toBeLessThanOrEqual(anchorOnly + 1e-9);
    });
  }

  it('picks the pole stage for a vertex nearer the pole than the anchor and the anchor stage otherwise', () => {
    const c: PoleCase = { radius: 6_371_000, morph: 0.5, centre: [20, 35] };
    expect(measure(c, 1, 1000, 1, true).usedPole).toBeTrue();
    expect(measure(c, 1000, 1, 1, true).usedPole).toBeFalse();
  });

  it('never uses the pole stage at morph 0 (poleOn is off)', () => {
    const c: PoleCase = { radius: 6_371_000, morph: 0, centre: [0, 0] };
    for (const rho of RHOS) expect(measure(c, rho, 1000, 1, true).usedPole).toBeFalse();
  });
});

describe('lod-morph pole zone: seams', () => {
  for (const c of CASES) {
    it(`a vertex's position depends only on its lattice point and the frame, not on the leaf that draws it: ${label(c)}`, () => {
      const domain = sphereDomain(c.radius);
      const map = testMap(c.radius, c.morph, 'equal-earth', c.centre[0], c.centre[1]);
      const { face, u, v } = poleOnAFace(c);
      for (const lib of [DOUBLE_LIB, FLOAT32_LIB]) {
        for (const rho of RHOS) {
          const k = rho / unitMetres(c.radius);
          const t = latticeVector(face, Math.round(u + k * Math.cos(0.7)), Math.round(v + k * Math.sin(0.7)));
          const unit = directionOfT(t, domain);
          const lon = Math.atan2(dot(unit, map.basis.right), dot(unit, map.basis.forward));
          const sigma = lon >= 0 ? 1 : -1;
          const frame = testFrame(map, domain, sceneCameraAt(map, unwrapToSide(lon, sigma).lon, 0.2, 2));
          const lifted = liftFrame(lib, frame);
          // Two leaves that share the vertex differ in their centre longitude (a fraction of a radian here) and place the vertex in
          // the same window: the same bits.
          const a = evaluateVertex(lib, frame, lifted, domain, t, sigma, 2, unwrapToSide(lon, sigma).lon + 0.2);
          const b = evaluateVertex(lib, frame, lifted, domain, t, sigma, 2, unwrapToSide(lon, sigma).lon - 0.2);
          expect(a.rel).toEqual(b.rel);
          expect(a.usedPole).toBe(b.usedPole);
        }
      }
    });
  }

  it('the exact pole vertex takes its leaf longitude and lands on the map edge, in float32 too', () => {
    const c: PoleCase = { radius: 6_371_000, morph: 1, centre: [0, 0] };
    const domain = sphereDomain(c.radius);
    const map = testMap(c.radius, c.morph, 'equal-earth', 0, 0);
    const { face } = poleOnAFace(c);
    const t = latticeVector(face, TEST_STEPS / 2, TEST_STEPS / 2);
    for (const poleLon of [0.6, -2.2]) {
      const sigma = poleLon >= 0 ? 1 : -1;
      const frame = testFrame(map, domain, sceneCameraAt(map, poleLon, 1.2, 2));
      expect(frame.poles[0]?.map((x) => x + 0)).toEqual(t.map((x) => x + 0));
      for (const lib of [DOUBLE_LIB, FLOAT32_LIB]) {
        const got = evaluateVertex(lib, frame, liftFrame(lib, frame), domain, t, sigma, 2, poleLon, poleLon);
        const exact = exactRel(frame, domain, t, sigma, 2, poleLon, poleLon);
        const error = Math.hypot(got.rel[0] - exact[0], got.rel[1] - exact[1], got.rel[2] - exact[2]);
        expect(error).toBeLessThan(lib === DOUBLE_LIB ? 1e-5 : 2e-6 * Math.hypot(...exact) + 1e-3);
      }
    }
  });
});
