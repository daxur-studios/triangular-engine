import { FACE_FRAMES, domainPreset, type LodDomain, DETAIL_OCTAVES, DETAIL_UNIT_BOUND, detailAtLattice, detailBoundM, detailNoise, detailOctaveFade, detailTexelMetres, withDetailNoise, createHeightSource, bakeHeights, type BakeLayout, noiseSampler, createTextureHeightSource, MAX_LATTICE_STEPS, cubeLattice, gridLattice, leafLattice } from 'triangular-engine/lod-surface/core';
import { DEFAULT_SETTINGS, LOD_SURFACE_TEST_HISTORY } from './lod-surface-tests';

const plane = domainPreset('plane-100km');
const sphere = domainPreset('sphere-600km');
const CELLS = 1024;

/** Deterministic pseudo-random points in [0, 1). */
function sequence(count: number): number[] {
  let state = 12345;
  return Array.from({ length: count }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  });
}

describe('Plan 059 detail noise below the texel size', () => {
  it('is deterministic and bounded by the sum of its octave weights', () => {
    const r = sequence(3000);
    let largest = 0;
    for (let n = 0; n < 1000; n++) {
      const [x, y, z] = [r[3 * n] * 4000 - 2000, r[3 * n + 1] * 4000 - 2000, r[3 * n + 2] * 4000 - 2000];
      const first = detailNoise(x, y, z);
      expect(detailNoise(x, y, z)).toBe(first);
      largest = Math.max(largest, Math.abs(first));
    }
    expect(largest).toBeLessThanOrEqual(DETAIL_UNIT_BOUND);
    expect(largest).toBeGreaterThan(0.3);
    expect(DETAIL_UNIT_BOUND).toBeCloseTo(1.875, 12);
  });

  it('has an analytic gradient that matches finite differences', () => {
    const r = sequence(60);
    const gradient: [number, number, number] = [0, 0, 0];
    const h = 1e-5;
    for (let n = 0; n < 20; n++) {
      const [x, y, z] = [r[3 * n] * 50 - 25, r[3 * n + 1] * 50 - 25, r[3 * n + 2] * 50 - 25];
      detailNoise(x, y, z, undefined, gradient);
      const numeric = [
        (detailNoise(x + h, y, z) - detailNoise(x - h, y, z)) / (2 * h),
        (detailNoise(x, y + h, z) - detailNoise(x, y - h, z)) / (2 * h),
        (detailNoise(x, y, z + h) - detailNoise(x, y, z - h)) / (2 * h),
      ];
      for (let k = 0; k < 3; k++) expect(gradient[k]).toBeCloseTo(numeric[k], 4);
    }
  });

  it('fades octaves out by wavelength against vertex spacing, finest first', () => {
    const texelM = 100;
    const angle = 0.004;
    // A vertex 10 km away has a spacing of 40 m: the one-texel octave (100 m) is 2.5 spacings, so it is partly in.
    const far = Array.from({ length: DETAIL_OCTAVES }, (_, o) => detailOctaveFade(o, texelM, 10_000, angle));
    expect(far[0]).toBeGreaterThan(0);
    expect(far[0]).toBeLessThan(1);
    expect(far.slice(1)).toEqual([0, 0, 0]);
    // Close up (spacing 4 mm) every octave is fully in.
    for (let o = 0; o < DETAIL_OCTAVES; o++) expect(detailOctaveFade(o, texelM, 1, angle)).toBe(1);
    // Never negative, and the fade only drops with distance.
    for (let o = 0; o < DETAIL_OCTAVES; o++) {
      let previous = 1;
      for (const distance of [1, 10, 100, 1000, 10_000, 100_000]) {
        const fade = detailOctaveFade(o, texelM, distance, angle);
        expect(fade).toBeLessThanOrEqual(previous);
        previous = fade;
      }
    }
    // With every octave faded out the noise is exactly nothing.
    expect(detailNoise(1.3, 2.7, 0.4, [0, 0, 0, 0])).toBe(0);
  });

  for (const [label, domain] of [['plane', plane], ['sphere', sphere]] as const) {
    describe(`on the ${label}`, () => {
      const layout: BakeLayout = { kind: domain.kind, warp: domain.warp, sizeM: domain.sizeM, k: 6 };
      const baked = () => createTextureHeightSource('noise', bakeHeights(layout, noiseSampler(layout)));

      it('leaves heights exactly the plain source heights when the amplitude is 0', () => {
        for (const source of [createHeightSource('bumps', domain.kind), baked()]) {
          expect(withDetailNoise(source, { domain, cells: 64, share: 0 })).toBe(source);
          const r = sequence(30);
          for (let n = 0; n < 10; n++) {
            const length = Math.hypot(r[3 * n] - 0.5, 0.3, r[3 * n + 2] - 0.5);
            const [x, y, z] = domain.kind === 'plane'
              ? [(r[3 * n] - 0.5) * domain.sizeM, 0, (r[3 * n + 2] - 0.5) * domain.sizeM]
              : [(r[3 * n] - 0.5) * domain.sizeM / length, 0.3 * domain.sizeM / length, (r[3 * n + 2] - 0.5) * domain.sizeM / length];
            expect(withDetailNoise(source, { domain, cells: 64, share: 0 }).heightAt(x, y, z)).toBe(source.heightAt(x, y, z));
          }
        }
      });

      it('adds the noise to the plain height, within the stated amplitude', () => {
        const source = baked();
        const options = { domain, cells: 64, share: 0.04 };
        const wrapped = withDetailNoise(source, options);
        const bound = detailBoundM(options);
        expect(bound).toBeCloseTo(0.04 * detailTexelMetres(domain, 64) * DETAIL_UNIT_BOUND, 9);
        const r = sequence(300);
        let largest = 0;
        for (let n = 0; n < 100; n++) {
          const [u, v] = [Math.round(r[3 * n] * MAX_LATTICE_STEPS), Math.round(r[3 * n + 1] * MAX_LATTICE_STEPS)];
          const face = Math.floor(r[3 * n + 2] * (domain.kind === 'plane' ? 1 : 6));
          const point = domain.kind === 'plane' ? [(u / MAX_LATTICE_STEPS - 0.5) * domain.sizeM, 0, -(v / MAX_LATTICE_STEPS - 0.5) * domain.sizeM] : positionOf(domain, face, u, v);
          const offset = wrapped.heightAt(point[0], point[1], point[2]) - source.heightAt(point[0], point[1], point[2]);
          largest = Math.max(largest, Math.abs(offset));
        }
        expect(largest).toBeLessThanOrEqual(bound);
        expect(largest).toBeGreaterThan(0);
        expect(wrapped.boundM).toBeCloseTo(source.boundM + bound, 9);
      });

      it('widens every node height range by the noise bound', () => {
        const source = baked();
        const options = { domain, cells: 64, share: 0.04 };
        const wrapped = withDetailNoise(source, options);
        const bound = detailBoundM(options);
        const plain: [number, number] = [0, 0];
        const widened: [number, number] = [0, 0];
        for (const [root, level, i, j] of [[0, 0, 0, 0], [0, 3, 2, 5], [0, 6, 17, 40]] as const) {
          source.nodeRange!(root, level, i, j, plain);
          wrapped.nodeRange!(root, level, i, j, widened);
          expect(widened[0]).toBeCloseTo(plain[0] - bound, 9);
          expect(widened[1]).toBeCloseTo(plain[1] + bound, 9);
        }
      });
    });
  }

  it('gives a point shared by two patches of one level the same offset, bit for bit', () => {
    // Two plane leaves side by side: the east edge of the first is the west edge of the second.
    const patchCells = 16;
    const maxLevel = 20;
    const a = leafLattice(0, 3, 2, 4, patchCells, maxLevel);
    const b = leafLattice(0, 3, 3, 4, patchCells, maxLevel);
    for (let gy = 0; gy <= patchCells; gy++) {
      const [ua, va] = gridLattice(a, patchCells, gy);
      const [ub, vb] = gridLattice(b, 0, gy);
      expect([ua, va]).toEqual([ub, vb]);
      expect(detailAtLattice('plane', CELLS, 0, ua, va)).toBe(detailAtLattice('plane', CELLS, 0, ub, vb));
    }
  });

  it('gives a coarse leaf and a fine leaf the same offset at the vertices they share', () => {
    const patchCells = 16;
    const maxLevel = 20;
    const coarse = leafLattice(0, 3, 2, 4, patchCells, maxLevel);
    const fine = leafLattice(0, 4, 6, 8, patchCells, maxLevel);
    // The fine leaf's west edge lies on the coarse leaf's east edge, and its even vertices are the coarse leaf's vertices.
    let shared = 0;
    for (let gy = 0; gy <= patchCells / 2; gy++) {
      const [uc, vc] = gridLattice(coarse, patchCells, gy);
      const [uf, vf] = gridLattice(fine, 0, 2 * gy);
      expect([uc, vc]).toEqual([uf, vf]);
      expect(detailAtLattice('plane', CELLS, 0, uc, vc)).toBe(detailAtLattice('plane', CELLS, 0, uf, vf));
      shared++;
    }
    expect(shared).toBe(patchCells / 2 + 1);
  });

  it('gives a cube edge vertex the same offset from both faces of the edge', () => {
    // Face 0's +u edge touches another face; find, for every face pair, the lattice points with identical T.
    let checked = 0;
    const tA: [number, number, number] = [0, 0, 0];
    const tB: [number, number, number] = [0, 0, 0];
    for (let faceA = 0; faceA < 6; faceA++) {
      for (let faceB = faceA + 1; faceB < 6; faceB++) {
        for (const along of [0, 0.123, 0.5, 0.777, 1]) {
          const s = Math.round(along * MAX_LATTICE_STEPS);
          for (const [ua, va] of [[0, s], [MAX_LATTICE_STEPS, s], [s, 0], [s, MAX_LATTICE_STEPS]] as const) {
            cubeLattice(faceA, ua, va, MAX_LATTICE_STEPS, tA);
            for (const [ub, vb] of [[0, s], [MAX_LATTICE_STEPS, s], [s, 0], [s, MAX_LATTICE_STEPS], [0, MAX_LATTICE_STEPS - s], [MAX_LATTICE_STEPS, MAX_LATTICE_STEPS - s]] as const) {
              cubeLattice(faceB, ub, vb, MAX_LATTICE_STEPS, tB);
              if (tA[0] !== tB[0] || tA[1] !== tB[1] || tA[2] !== tB[2]) continue;
              expect(detailAtLattice('sphere', CELLS, faceA, ua, va)).toBe(detailAtLattice('sphere', CELLS, faceB, ub, vb));
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('runs every saved suite version with the noise off, and terrain v8 on the default', () => {
    expect(DEFAULT_SETTINGS.detailNoise).toBeGreaterThan(0);
    const find = (id: string, version: number) => LOD_SURFACE_TEST_HISTORY.find((suite) => suite.id === id && suite.version === version)!;
    for (const suite of LOD_SURFACE_TEST_HISTORY.filter((item) => !(item.id === 'lod-surface-terrain' && item.version >= 8))) {
      for (const scenario of suite.scenarios) expect(scenario.settings.detailNoise).withContext(`${suite.id}@${suite.version} ${scenario.id}`).toBe(0);
    }
    const t7 = find('lod-surface-terrain', 7);
    const t8 = find('lod-surface-terrain', 8);
    expect(t8.scenarios.map((scenario) => scenario.id)).toEqual(t7.scenarios.map((scenario) => scenario.id));
    for (const scenario of t8.scenarios) expect(scenario.settings.detailNoise).withContext(scenario.id).toBe(DEFAULT_SETTINGS.detailNoise);
    t8.scenarios.forEach((scenario, index) => expect({ ...scenario.settings, detailNoise: 0 }).withContext(scenario.id).toEqual(t7.scenarios[index].settings));
  });
});

/** Base-surface position of face lattice point (u, v) on the sphere, doubles. */
function positionOf(domain: LodDomain, face: number, u: number, v: number): [number, number, number] {
  const frame = FACE_FRAMES[face];
  const a = Math.tan((Math.PI / 4) * (2 * u / MAX_LATTICE_STEPS - 1));
  const b = Math.tan((Math.PI / 4) * (2 * v / MAX_LATTICE_STEPS - 1));
  const c = [0, 1, 2].map((k) => frame.n[k] + frame.u[k] * a + frame.v[k] * b);
  const scale = domain.sizeM / Math.hypot(c[0], c[1], c[2]);
  return [c[0] * scale, c[1] * scale, c[2] * scale];
}
