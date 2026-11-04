import { type LodDomain, type Vec3 } from './lod-domain';
import { computeMorphFrame, createMorphMap } from './lod-morph-frame';

/**
 * The demo's `planet-scene` orbit camera (600 km planet, 2 R above the ground over direction [0.9, 0.85, 1], centre lon 0 lat 0)
 * as the mesh frame sees it while the globe unrolls. Where the unbend of the camera clamps to the projection pole (morph near 1)
 * the lattice anchor must not become the pole: there the anchor's longitude is undefined and every vertex collapses onto one meridian.
 */

const R = 600_000;
const STEPS = 16 * 2 ** 10;
const DOMAIN: LodDomain = { kind: 'sphere', sizeM: R, warp: 'equal-angle' };
const GROUND: Vec3 = [0.9, 0.85, 1];

function orbitCamera(): Vec3 {
  const l = Math.hypot(...GROUND);
  const lift = 3 * R;
  return [(GROUND[0] / l) * lift, (GROUND[1] / l) * lift, (GROUND[2] / l) * lift];
}

describe('orbit camera: the mesh frame anchor stays off the projection pole', () => {
  for (const morph of [0.9, 0.97, 0.98, 0.99, 1]) {
    it(`morph ${morph}: the anchor has a defined longitude`, () => {
      const map = createMorphMap({ morph, projection: 'equal-earth', projectionCentre: { lonDeg: 0, latDeg: 0 } }, R);
      const frame = computeMorphFrame(map, DOMAIN, STEPS, orbitCamera());
      const v = frame.values;
      expect(Math.hypot(v['vA1'] as number, v['vA2'] as number)).toBeGreaterThan(0.01);
      expect(v['nA2']).toBeDefined();
    });
  }
});
