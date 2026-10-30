import { OUTLINE_WRAP } from './lod-morph-math';
import {
  bendPoint, bodyToMap, createMorphMap, directionOf, latticeDirection, leafSide, mapVectorToBody, morphExtents, morphMapInverse, morphMapXY, morphRowFactor,
  morphSettingsFromUniforms, outlineDistancesAt, poleOrigin, projectionBasis, referenceVertex, unbendPoint, unbendPosition, unwrapToSide,
  type MorphUniformsLike,
} from './lod-morph-frame';
import { TEST_STEPS, directionOfT, sceneCameraAt, sphereDomain, testFrame, testMap, unitMetres } from './lod-morph.testing';

/** Plan 059, step G6b: the CPU half of the morph (doubles): the map, the bend and their inverses, the basis, the per-frame anchor. */

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const R = 6_371_000;

describe('lod-morph-frame: basis and settings', () => {
  it('projectionBasis is orthonormal and the default centre is +Z forward, +Y up', () => {
    for (const [lon, lat] of [[0, 0], [20, 35], [-120, -41], [180, 10], [0, 90], [30, -90]]) {
      const b = projectionBasis(lon, lat);
      for (const v of [b.forward, b.up, b.right]) expect(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(dot(b.forward, b.up))).toBeLessThan(1e-12);
      expect(Math.abs(dot(b.forward, b.right))).toBeLessThan(1e-12);
      expect(Math.abs(dot(b.up, b.right))).toBeLessThan(1e-12);
    }
    const d = projectionBasis(0, 0);
    // (Adding 0 turns a -0 into 0, which `toEqual` tells apart.)
    expect(d.forward.map((x) => x + 0)).toEqual([0, 0, 1]);
    expect(d.up.map((x) => x + 0)).toEqual([0, 1, 0]);
    expect(d.right.map((x) => x + 0)).toEqual([1, 0, 0]);
  });

  it('morphSettingsFromUniforms reads the morph, the projection and the basis (the static mode gives the default centre)', () => {
    const v = (x: number, y: number, z: number) => ({ value: { x, y, z } });
    const basis = projectionBasis(20, 35);
    const uniforms = (mode: number, type: number): MorphUniformsLike => ({
      uMorph: { value: 0.4 },
      uProjForward: v(...basis.forward), uProjUp: v(...basis.up), uProjRight: v(...basis.right),
      uProjMode: { value: mode },
      uProjectionType: { value: type },
    });
    const dynamic = morphSettingsFromUniforms(uniforms(1, 1));
    expect(dynamic.morph).toBe(0.4);
    expect(dynamic.projection).toBe('equal-earth');
    expect(dynamic.basis?.up).toEqual(basis.up);
    const fixed = morphSettingsFromUniforms(uniforms(0, 0));
    expect(fixed.projection).toBe('equirectangular');
    expect(fixed.basis).toBeUndefined();
    expect(fixed.projectionCentre).toEqual({ lonDeg: 0, latDeg: 0 });
  });

  it('createMorphMap clamps the morph and sets the weights: Equal Earth blends in with the morph, equirectangular never does', () => {
    expect(createMorphMap({ morph: 3, projection: 'equal-earth' }, R).morph).toBe(1);
    expect(createMorphMap({ morph: -1, projection: 'equal-earth' }, R).morph).toBe(0);
    const ee = createMorphMap({ morph: 0.25, projection: 'equal-earth' }, R);
    expect(ee.wLin).toBeCloseTo(0.75, 12);
    expect(ee.wEE).toBeCloseTo(0.25 * 1.1607, 3);
    expect(ee.k).toBeCloseTo(0.75 / R, 18);
    expect(ee.shift).toBeCloseTo(0.75 * R, 6);
    for (const morph of [0, 0.3, 1]) {
      const eq = createMorphMap({ morph, projection: 'equirectangular' }, R);
      expect(eq.wLin).toBe(1);
      expect(eq.wEE).toBe(0);
    }
  });
});

describe('lod-morph-frame: the map and the bend', () => {
  it('morphMapInverse inverts morphMapXY for both projections', () => {
    for (const projection of ['equal-earth', 'equirectangular'] as const) {
      for (const morph of [0, 0.4, 1]) {
        const map = testMap(R, morph, projection);
        for (const lon of [-3, -1, 0, 0.7, 3]) {
          for (const lat of [-1.4, -0.5, 0, 0.9, 1.5]) {
            const [x, y] = morphMapXY(lon, lat, map);
            const back = morphMapInverse(x, y, map);
            expect(Math.abs(back.lat - lat)).toBeLessThan(1e-9);
            expect(Math.abs(back.lon - lon)).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('the row factor is 1 for equirectangular and narrows towards the pole for Equal Earth at morph 1', () => {
    expect(morphRowFactor(1.2, testMap(R, 1, 'equirectangular'))).toBe(1);
    const flat = testMap(R, 1, 'equal-earth');
    expect(morphRowFactor(0, flat)).toBeCloseTo(1, 12);
    expect(morphRowFactor(Math.PI / 2, flat)).toBeLessThan(0.7);
  });

  it('bendPoint lies on the sphere of radius 1 / k and unbendPoint inverts it, with a height', () => {
    for (const k of [0, 1 / R, 0.5 / R, 3 / R]) {
      for (const [x, y] of [[0, 0], [1e5, -2e5], [4e6, 3e6], [-1.2e7, 1e6]]) {
        for (const height of [0, 2, 5000]) {
          const bent = bendPoint(x, y, k, height);
          if (k > 0 && height === 0) {
            const centre = [0, 0, 1 / k];
            const d = Math.hypot(bent.position[0] - centre[0], bent.position[1] - centre[1], bent.position[2] + centre[2]);
            expect(Math.abs(d - 1 / k)).toBeLessThan(1e-3);
          }
          if (k * Math.abs(x) < Math.PI / 2 - 0.1 && k * Math.abs(y) < Math.PI / 2 - 0.1) {
            const back = unbendPoint(bent.position, k);
            expect(Math.abs(back.x - x)).toBeLessThan(1e-3);
            expect(Math.abs(back.y - y)).toBeLessThan(1e-3);
            expect(Math.abs(back.height - height)).toBeLessThan(1e-3);
          }
        }
      }
    }
    expect(bendPoint(123, -456, 0, 7).position).toEqual([123, -456, 7]);
  });

  it('bodyToMap inverts mapVectorToBody with the shift on z', () => {
    const map = testMap(R, 0.5, 'equal-earth', 20, 35);
    const v = [1.5e5, -2.5e5, 7e4];
    const body = mapVectorToBody(map.basis, [v[0], v[1], v[2] + map.shift]);
    const back = bodyToMap(map, body);
    for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - v[i])).toBeLessThan(1e-6);
  });

  it('unbendPosition finds the longitude, latitude and height of a bent camera and its unbent position', () => {
    for (const projection of ['equal-earth', 'equirectangular'] as const) {
      for (const morph of [0.2, 0.7, 1]) {
        const map = testMap(R, morph, projection, 20, 35);
        for (const [lon, lat, height] of [[0.3, 0.4, 2], [-1, -0.2, 500], [2.5, 1.2, 12_000]]) {
          const scene = sceneCameraAt(map, lon, lat, height);
          const at = unbendPosition(map, scene);
          expect(Math.abs(at.lon - lon)).toBeLessThan(1e-9);
          expect(Math.abs(at.lat - lat)).toBeLessThan(1e-9);
          expect(Math.abs(at.height - height)).toBeLessThan(1e-3);
          expect(Math.abs(Math.hypot(at.position[0], at.position[1], at.position[2]) - (R + height))).toBeLessThan(1e-3);
          const unit = directionOf(map.basis, lon, lat);
          for (let i = 0; i < 3; i++) expect(Math.abs(at.position[i] - unit[i] * (R + height))).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('at morph 0 the bent camera is the camera: the scene position is the unbent one', () => {
    const map = testMap(R, 0, 'equal-earth', 20, 35);
    const scene = sceneCameraAt(map, 0.3, 0.4, 100);
    const at = unbendPosition(map, scene);
    for (let i = 0; i < 3; i++) expect(Math.abs(at.position[i] - scene[i])).toBeLessThan(1e-3);
  });
});

describe('lod-morph-frame: windows, sides and lattice directions', () => {
  it('unwrapToSide puts a longitude into the side window', () => {
    for (const sigma of [1, -1]) {
      for (let lon = -3.1; lon <= 3.1; lon += 0.37) {
        const w = unwrapToSide(lon, sigma);
        expect(w.lon).toBeGreaterThan(sigma * (Math.PI / 2) - Math.PI);
        expect(w.lon).toBeLessThanOrEqual(sigma * (Math.PI / 2) + Math.PI + 1e-12);
        expect(Math.abs(w.lon - lon - w.n * 2 * Math.PI)).toBeLessThan(1e-12);
      }
    }
  });

  it('leafSide is the sign of the centre longitude, and latticeDirection is a unit vector', () => {
    const domain = sphereDomain(R);
    const basis = projectionBasis(0, 0);
    expect(leafSide(basis, [0.6, 0, 0.8])).toBe(1);
    expect(leafSide(basis, [-0.6, 0, 0.8])).toBe(-1);
    for (let face = 0; face < 6; face++) {
      const d = latticeDirection(face, 123_456, 7_654_321, TEST_STEPS, domain);
      expect(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1)).toBeLessThan(1e-14);
    }
  });
});

describe('lod-morph-frame: the per-frame anchor', () => {
  it('the anchor is the lattice point nearest the unbent camera, and the camera-relative anchor point is a lattice unit or two from it', () => {
    const domain = sphereDomain(R);
    for (const morph of [0.3, 1]) {
      const map = testMap(R, morph, 'equal-earth', 20, 35);
      const frame = testFrame(map, domain, sceneCameraAt(map, 0.3, 0.4, 2));
      expect(Math.abs(frame.lambdaC - 0.3)).toBeLessThan(1e-9);
      expect(Math.abs(frame.phiC - 0.4)).toBeLessThan(1e-9);
      expect(Math.abs(frame.values.lamA - frame.lambdaC)).toBeLessThan(1e-5);
      // The vertex at the anchor, by the reference: within a lattice unit or two of the camera (plus its 2 m height).
      const ref = referenceVertex(frame, directionOfT(frame.anchor.t, domain), 1, 0);
      expect(Math.hypot(ref.rel[0], ref.rel[1], ref.rel[2])).toBeLessThan(2 * unitMetres(R) + 2.5);
      expect(frame.values.poleOn).toBe(1);
    }
  });

  it('turns the pole stage off at morph 0', () => {
    const map = testMap(R, 0, 'equal-earth');
    expect(testFrame(map, sphereDomain(R), sceneCameraAt(map, 0.3, 0.4, 2)).values.poleOn).toBe(0);
  });

  it('the pole vertices: both are lattice vertices at the default centre, neither at a tilted one', () => {
    const domain = sphereDomain(R);
    const centred = testMap(R, 0.5, 'equal-earth', 0, 0);
    const tilted = testMap(R, 0.5, 'equal-earth', 20, 35);
    const framed = testFrame(centred, domain, sceneCameraAt(centred, 0.3, 0.4, 2));
    expect(framed.poles[0]).toBeDefined();
    expect(framed.poles[1]).toBeDefined();
    expect(poleOrigin(centred.basis, 1, domain, TEST_STEPS).isVertex).toBeTrue();
    expect(poleOrigin(tilted.basis, 1, domain, TEST_STEPS).isVertex).toBeFalse();
    expect(testFrame(tilted, domain, sceneCameraAt(tilted, 0.3, 0.4, 2)).poles).toEqual([undefined, undefined]);
  });

  it('the pole origin is the pole to float32: cube point, error and bias are small and consistent', () => {
    const domain = sphereDomain(R);
    for (const [lon, lat] of [[0, 0], [20, 35], [-120, -41]]) {
      const basis = projectionBasis(lon, lat);
      for (const sign of [1, -1] as const) {
        const o = poleOrigin(basis, sign, domain, TEST_STEPS);
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(o.error[k])).toBeLessThan(1e-7);
          expect(Math.abs(o.bias[k])).toBeLessThan(1e-7);
        }
        const unit = directionOfT(o.t, domain);
        for (let k = 0; k < 3; k++) expect(Math.abs(unit[k] - sign * basis.up[k])).toBeLessThan(1e-9);
      }
    }
  });

  it('the outline tables hold the distance to the right and left edges per unwrap integer, and top and bottom', () => {
    const domain = sphereDomain(R);
    const map = testMap(R, 1, 'equal-earth');
    const frame = testFrame(map, domain, sceneCameraAt(map, 0.3, 0.4, 2));
    expect(frame.outline.right.length).toBe(2 * OUTLINE_WRAP + 1);
    const n = OUTLINE_WRAP;
    expect(frame.outline.right[n]).toBeCloseTo(Math.PI - frame.values.lamA, 9);
    expect(frame.outline.left[n]).toBeCloseTo(Math.PI + frame.values.lamA, 9);
    expect(frame.outline.top + frame.outline.bottom).toBeCloseTo(2 * morphExtents(map).halfHeight, 6);
  });

  it('outlineDistancesAt is inside-positive at the centre and zero on the edge row', () => {
    const map = testMap(R, 1, 'equal-earth');
    const inside = outlineDistancesAt(0, 0, map);
    for (const d of inside) expect(d).toBeGreaterThan(0);
    const edge = outlineDistancesAt(Math.PI, 0.3, map);
    expect(Math.abs(edge[0])).toBeLessThan(1e-6);
    expect(edge[1]).toBeGreaterThan(0);
    const top = outlineDistancesAt(0, Math.PI / 2, map);
    expect(Math.abs(top[2])).toBeLessThan(1e-6);
  });
});
