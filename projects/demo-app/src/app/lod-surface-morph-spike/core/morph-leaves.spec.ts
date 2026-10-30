import {
  LEAF_STRIDE,
  LodSelector,
  TERRAIN_DEFAULTS,
  latticeSteps,
  maxLevelFor,
  newAnchor,
  frustumNormals,
  type LodDomain,
} from 'triangular-engine/lod-surface/core';
import { computeMorphFrame, latticeDirection, poseOf, projectionBasis, unwrapToSide, type MorphPoseId, type MorphView } from './morph-frame';
import { analyseLeaf, edgeLongitudes, inWindow, instanceCapacity, leafPoleCorner, leafTorn, longitudeOf, packMorphLeaves, poleVertexLongitude } from './morph-leaves';

const PATCH = TERRAIN_DEFAULTS.patchCells;
const MAX_LEVEL = maxLevelFor(PATCH);
const STEPS = latticeSteps(PATCH, MAX_LEVEL);
const domainOf = (radiusM: number): LodDomain => ({ kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' });
const DOMAIN = domainOf(6_371_000);
const BASIS = projectionBasis(0, 0);
const TWO_PI = 2 * Math.PI;

/** All leaves of a level on every face: (face, u0, v0, span). */
function leavesOfLevel(level: number): { face: number; u0: number; v0: number; span: number }[] {
  const step = 1 << (MAX_LEVEL - level);
  const span = step * PATCH;
  const count = 2 ** level;
  const out: { face: number; u0: number; v0: number; span: number }[] = [];
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) out.push({ face, u0: i * span, v0: j * span, span });
  }
  return out;
}

/** Brute force: does any of a dense grid of the leaf's points sit at (or beyond) the cut when its longitudes are taken around the centre? */
function reachesCutDense(face: number, u0: number, v0: number, span: number, basis = BASIS, n = 24): boolean {
  const centre = latticeDirection(face, u0 + span / 2, v0 + span / 2, STEPS, DOMAIN);
  const centreLon = longitudeOf(basis, centre);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const p = latticeDirection(face, u0 + (span * i) / n, v0 + (span * j) / n, STEPS, DOMAIN);
      const delta = longitudeOf(basis, p) - centreLon;
      const wrapped = delta - TWO_PI * Math.round(delta / TWO_PI);
      const lon = centreLon + wrapped;
      if (lon >= Math.PI || lon <= -Math.PI) return true;
    }
  }
  return false;
}

describe('morph-leaves: the straddle test', () => {
  it('never misses a leaf that a dense sampling puts on the cut (levels 1-5, default projection centre)', () => {
    let truePositives = 0;
    let misses = 0;
    let falsePositives = 0;
    for (const level of [1, 2, 3, 4, 5]) {
      for (const leaf of leavesOfLevel(level)) {
        const a = analyseLeaf(BASIS, DOMAIN, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span);
        const dense = reachesCutDense(leaf.face, leaf.u0, leaf.v0, leaf.span);
        if (dense && !a.reachesCut) misses++;
        if (dense && a.reachesCut) truePositives++;
        if (!dense && a.reachesCut && !a.containsPole) falsePositives++;
      }
    }
    expect(misses).toBe(0);
    expect(truePositives).toBeGreaterThan(0);
    // The margin makes a few extra leaves reach the cut; with the default 10 % margin it stays a small number.
    console.log(`[morph-leaves] straddle test: ${truePositives} reached (dense), ${falsePositives} extra by the margin`);
    expect(falsePositives).toBeLessThan(truePositives);
  });

  it('never misses at tilted projection centres either', () => {
    for (const [lon, lat] of [[37, 22], [-120, -41], [180, 0], [90, 60]]) {
      const basis = projectionBasis(lon, lat);
      for (const level of [2, 3, 4]) {
        for (const leaf of leavesOfLevel(level)) {
          const a = analyseLeaf(basis, DOMAIN, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span);
          if (reachesCutDense(leaf.face, leaf.u0, leaf.v0, leaf.span, basis)) expect(a.reachesCut).toBeTrue();
        }
      }
    }
  });

  it('counts the leaves that contain a pole of the basis as reaching the cut', () => {
    // The default basis' poles are the centres of the +Y and -Y faces: lattice (steps / 2, steps / 2) there.
    const poleLeaves: { face: number; u0: number; v0: number; span: number }[] = [];
    for (const level of [1, 2, 3, 4]) {
      for (const leaf of leavesOfLevel(level)) {
        const centre = STEPS / 2;
        const inU = leaf.u0 <= centre && centre <= leaf.u0 + leaf.span;
        const inV = leaf.v0 <= centre && centre <= leaf.v0 + leaf.span;
        if (!inU || !inV) continue;
        const d = latticeDirection(leaf.face, centre, centre, STEPS, DOMAIN);
        if (Math.abs(Math.abs(d[1]) - 1) < 1e-9) poleLeaves.push(leaf);
      }
    }
    expect(poleLeaves.length).toBeGreaterThanOrEqual(8);
    for (const leaf of poleLeaves) {
      const a = analyseLeaf(BASIS, DOMAIN, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span);
      expect(a.containsPole).toBeTrue();
      expect(a.reachesCut).toBeTrue();
    }
  });

  it('does not flag a leaf that is far from the cut and the poles', () => {
    // A leaf next to the projection centre (face +Z centre area) is nowhere near the cut.
    const level = 4;
    const span = (1 << (MAX_LEVEL - level)) * PATCH;
    const a = analyseLeaf(BASIS, DOMAIN, STEPS, 4, 8 * span, 8 * span, span);
    const d = latticeDirection(4, 8 * span + span / 2, 8 * span + span / 2, STEPS, DOMAIN);
    expect(Math.abs(longitudeOf(BASIS, d))).toBeLessThan(1);
    expect(a.reachesCut).toBeFalse();
    expect(a.containsPole).toBeFalse();
  });
});

describe('morph-leaves: the pole vertex longitude', () => {
  it("is the leaf's centre longitude unwrapped into the side window, and identical for the same leaf on its own side", () => {
    for (const level of [2, 3]) {
      for (const leaf of leavesOfLevel(level)) {
        const centre = latticeDirection(leaf.face, leaf.u0 + leaf.span / 2, leaf.v0 + leaf.span / 2, STEPS, DOMAIN);
        const lon = longitudeOf(BASIS, centre);
        for (const sigma of [1, -1]) {
          const q = poleVertexLongitude(BASIS, centre, sigma);
          expect(inWindow(q, sigma)).toBeTrue();
          const turns = (q - lon) / TWO_PI;
          expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
          expect(q).toBe(unwrapToSide(lon, sigma).lon);
        }
      }
    }
  });

  it('puts the four corner-sharing leaves of the default pole at four different longitudes (one quarter of the map apart)', () => {
    const level = 2;
    const centre = STEPS / 2;
    const lons: number[] = [];
    for (const leaf of leavesOfLevel(level)) {
      const onCorner = [leaf.u0, leaf.u0 + leaf.span].includes(centre) && [leaf.v0, leaf.v0 + leaf.span].includes(centre);
      if (!onCorner) continue;
      const d = latticeDirection(leaf.face, centre, centre, STEPS, DOMAIN);
      if (d[1] < 0.999999) continue;
      const c = latticeDirection(leaf.face, leaf.u0 + leaf.span / 2, leaf.v0 + leaf.span / 2, STEPS, DOMAIN);
      lons.push((longitudeOf(BASIS, c) * 180) / Math.PI);
    }
    lons.sort((a, b) => a - b);
    expect(lons.length).toBe(4);
    console.log(`[morph-leaves] centre longitudes of the four leaves that share the +Y pole (deg): ${lons.map((l) => l.toFixed(1)).join(', ')}`);
    for (let i = 1; i < lons.length; i++) expect(lons[i] - lons[i - 1]).toBeGreaterThan(80);
  });
});

describe('morph-leaves: leafTorn', () => {
  it('is false for every leaf when the poles are lattice vertices (the default centre): the quarter-map leaves are not torn', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      for (const leaf of leavesOfLevel(level)) expect(leafTorn(BASIS, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span)).toBeFalse();
    }
  });

  it('is true for the one leaf per level (per pole) that has a pole strictly inside it, for a tilted centre', () => {
    const tilted = projectionBasis(20, 35);
    for (const level of [2, 3, 4, 5]) {
      const torn = leavesOfLevel(level).filter((l) => leafTorn(tilted, STEPS, l.face, l.u0, l.v0, l.span));
      expect(torn.length).toBeGreaterThanOrEqual(1);
      expect(torn.length).toBeLessThanOrEqual(2);
      for (const leaf of torn) expect(analyseLeaf(tilted, DOMAIN, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span).containsPole).toBeTrue();
    }
  });

  it('is false for a leaf far from the poles', () => {
    const tilted = projectionBasis(20, 35);
    const span = (1 << (MAX_LEVEL - 4)) * PATCH;
    expect(leafTorn(tilted, STEPS, 4, 8 * span, 8 * span, span)).toBeFalse();
  });
});

/** A fake selector holding the given leaves (node k = leaf k). */
function fakeSelector(leaves: { face: number; level: number; i: number; j: number }[], masks?: number[]): LodSelector {
  const n = leaves.length;
  const fake = {
    stats: { drawn: n },
    leaves: Int32Array.from(leaves.map((_, k) => k)),
    masks: Uint8Array.from(masks ?? leaves.map(() => 0)),
    level: Int32Array.from(leaves.map((l) => l.level)),
    i: Int32Array.from(leaves.map((l) => l.i)),
    j: Int32Array.from(leaves.map((l) => l.j)),
    root: Int32Array.from(leaves.map((l) => l.face)),
  };
  return fake as unknown as LodSelector;
}

describe('morph-leaves: packing', () => {
  const level = 2;
  const all = leavesOfLevel(level).map((l) => {
    const span = l.span;
    return { face: l.face, level, i: l.u0 / span, j: l.v0 / span };
  });
  const capacity = instanceCapacity(all.length);
  const leafData = new Float32Array(capacity * LEAF_STRIDE);
  const infoData = new Float32Array(capacity * LEAF_STRIDE);

  it('at morph 0 packs one instance per leaf, on the side of its centre, with no duplicates', () => {
    const sel = fakeSelector(all);
    const pack = packMorphLeaves(sel, DOMAIN, PATCH, capacity, BASIS, 0, leafData, infoData);
    expect(pack.instances).toBe(all.length);
    expect(pack.duplicates).toBe(0);
    expect(pack.dropped).toBe(0);
    for (let k = 0; k < all.length; k++) {
      const l = all[k];
      const span = (1 << (MAX_LEVEL - l.level)) * PATCH;
      const centre = latticeDirection(l.face, l.i * span + span / 2, l.j * span + span / 2, STEPS, DOMAIN);
      expect(infoData[k * LEAF_STRIDE + 2]).toBe(longitudeOf(BASIS, centre) >= 0 ? 1 : -1);
    }
  });

  it('above morph 0 writes a +1 and a -1 instance for each leaf that reaches the cut, and one for the rest', () => {
    const sel = fakeSelector(all);
    const pack = packMorphLeaves(sel, DOMAIN, PATCH, capacity, BASIS, 0.5, leafData, infoData);
    let expectedDuplicates = 0;
    for (const l of all) {
      const span = (1 << (MAX_LEVEL - l.level)) * PATCH;
      if (analyseLeaf(BASIS, DOMAIN, STEPS, l.face, l.i * span, l.j * span, span).reachesCut) expectedDuplicates++;
    }
    expect(expectedDuplicates).toBeGreaterThan(0);
    expect(pack.duplicates).toBe(expectedDuplicates);
    expect(pack.instances).toBe(all.length + expectedDuplicates);
    let o = 0;
    for (const l of all) {
      const span = (1 << (MAX_LEVEL - l.level)) * PATCH;
      const a = analyseLeaf(BASIS, DOMAIN, STEPS, l.face, l.i * span, l.j * span, span);
      const copies = a.reachesCut ? 2 : 1;
      for (let c = 0; c < copies; c++, o++) {
        expect(leafData[o * LEAF_STRIDE]).toBe(l.i * span);
        expect(leafData[o * LEAF_STRIDE + 1]).toBe(l.j * span);
        expect(leafData[o * LEAF_STRIDE + 3]).toBe(l.face);
        const sigma = infoData[o * LEAF_STRIDE + 2];
        expect(inWindow(infoData[o * LEAF_STRIDE + 3], sigma)).toBeTrue();
        if (copies === 2) expect(sigma).toBe(c === 0 ? 1 : -1);
        else expect(sigma).toBe(a.side);
      }
    }
    expect(pack.instances).toBeLessThanOrEqual(capacity);
  });

  it('keeps one instance per leaf when duplicates are off, and drops (and counts) instances beyond the capacity', () => {
    const sel = fakeSelector(all);
    expect(packMorphLeaves(sel, DOMAIN, PATCH, capacity, BASIS, 0.5, leafData, infoData, false).instances).toBe(all.length);
    const small = packMorphLeaves(sel, DOMAIN, PATCH, all.length, BASIS, 0.5, leafData, infoData);
    expect(small.instances).toBe(all.length);
    expect(small.dropped).toBe(small.duplicates);
    expect(small.dropped).toBeGreaterThan(0);
  });
});

/** The duplicates the real selector asks for in each view (CPU only; logged as the expected counts for the GPU run). */
describe('morph-leaves: duplicates per view (the real selector)', () => {
  const views: MorphPoseId[] = ['orbit-map', 'mid-200m', 'mid-2m', 'cut-east-2m', 'cut-west-2m', 'pole-200m'];
  for (const radiusM of [600_000, 6_371_000]) {
    for (const poseId of views) {
      it(`counts them: ${radiusM / 1000} km, ${poseId}`, () => {
        const domain = domainOf(radiusM);
        const selector = new LodSelector({
          domain, patchCells: PATCH, mode: 'distance', fixedLevel: 5, cellPixels: TERRAIN_DEFAULTS.cellPixels, leafCap: TERRAIN_DEFAULTS.leafCap,
          heightBoundM: 0, cull: false, hysteresis: TERRAIN_DEFAULTS.hysteresis,
        });
        const view: MorphView = { radiusM, morph: 0.5, centreLonDeg: 0, centreLatDeg: 0, pose: poseOf(poseId, radiusM), groundHeightM: 0 };
        const frame = computeMorphFrame(view, domain, STEPS, newAnchor());
        const fov = Math.PI / 3;
        const frustum = new Float64Array(12);
        frustumNormals(frame.axes, fov, 16 / 9, frustum);
        for (let pass = 0; pass < 3; pass++) {
          selector.select({ camera: frame.selectorCamera, pixelAngle: (2 * Math.tan(fov / 2)) / 576, frustum });
        }
        const capacity = instanceCapacity(TERRAIN_DEFAULTS.leafCap);
        const leafData = new Float32Array(capacity * LEAF_STRIDE);
        const infoData = new Float32Array(capacity * LEAF_STRIDE);
        const pack = packMorphLeaves(selector, domain, PATCH, capacity, frame.basis, 0.5, leafData, infoData);
        console.log(
          `[morph-leaves] ${radiusM / 1000} km ${poseId}: leaves ${pack.leaves}, instances ${pack.instances}, duplicates ${pack.duplicates}, ` +
            `pole leaves ${pack.poleLeaves}, torn ${pack.torn}, dropped ${pack.dropped}, deepest level ${selector.stats.deepestLevel}, capHit ${selector.stats.capHit}`,
        );
        expect(pack.dropped).toBe(0);
        expect(pack.instances).toBe(pack.leaves + pack.duplicates);
        expect(pack.instances).toBeLessThanOrEqual(capacity);
      });
    }
  }
});

/**
 * Where the long streaks of pole-200m come from: triangles of an instance whose vertices, placed in the side window, are more than
 * pi apart in longitude (a torn triangle crosses the map). Counted for the window placement and for the placement continuous
 * around the leaf's own centre longitude.
 */
describe('morph-leaves: torn triangles (window placement against placement around the leaf centre)', () => {
  for (const poseId of ['pole-200m', 'orbit-map'] as MorphPoseId[]) {
    it(`counts them: 600 km ${poseId}`, () => {
      const radiusM = 600_000;
      const domain = domainOf(radiusM);
      const selector = new LodSelector({
        domain, patchCells: PATCH, mode: 'distance', fixedLevel: 5, cellPixels: TERRAIN_DEFAULTS.cellPixels, leafCap: TERRAIN_DEFAULTS.leafCap,
        heightBoundM: 0, cull: false, hysteresis: TERRAIN_DEFAULTS.hysteresis,
      });
      const view: MorphView = { radiusM, morph: 0.5, centreLonDeg: 0, centreLatDeg: 0, pose: poseOf(poseId, radiusM), groundHeightM: 0 };
      const frame = computeMorphFrame(view, domain, STEPS, newAnchor());
      const fov = Math.PI / 3;
      const frustum = new Float64Array(12);
      frustumNormals(frame.axes, fov, 16 / 9, frustum);
      for (let pass = 0; pass < 3; pass++) selector.select({ camera: frame.selectorCamera, pixelAngle: (2 * Math.tan(fov / 2)) / 576, frustum });
      const capacity = instanceCapacity(TERRAIN_DEFAULTS.leafCap);
      const leafData = new Float32Array(capacity * LEAF_STRIDE);
      const infoData = new Float32Array(capacity * LEAF_STRIDE);
      const pack = packMorphLeaves(selector, domain, PATCH, capacity, frame.basis, 0.5, leafData, infoData);
      const side = PATCH + 1;
      let windowTorn = 0;
      let centreTorn = 0;
      let instancesWithTear = 0;
      for (let o = 0; o < pack.instances; o++) {
        const u0 = leafData[o * LEAF_STRIDE];
        const v0 = leafData[o * LEAF_STRIDE + 1];
        const step = leafData[o * LEAF_STRIDE + 2];
        const face = leafData[o * LEAF_STRIDE + 3];
        const sigma = infoData[o * LEAF_STRIDE + 2];
        const centreLon = infoData[o * LEAF_STRIDE + 3];
        const inWin: number[] = [];
        const inCentre: number[] = [];
        for (let j = 0; j <= PATCH; j++) {
          for (let i = 0; i <= PATCH; i++) {
            const d = latticeDirection(face, u0 + i * step, v0 + j * step, STEPS, domain);
            const isPole = Math.abs(d[0] * frame.basis.up[0] + d[1] * frame.basis.up[1] + d[2] * frame.basis.up[2]) > 1 - 1e-12;
            const lon = longitudeOf(frame.basis, d);
            inWin.push(isPole ? centreLon : unwrapToSide(lon, sigma).lon);
            const delta = lon - centreLon;
            inCentre.push(isPole ? centreLon : centreLon + delta - TWO_PI * Math.round(delta / TWO_PI));
          }
        }
        let tornHere = 0;
        for (let j = 0; j < PATCH; j++) {
          for (let i = 0; i < PATCH; i++) {
            const a = j * side + i;
            for (const tri of [[a, a + 1, a + side + 1], [a, a + side + 1, a + side]]) {
              const spread = (lons: number[]): number => Math.max(...tri.map((k) => lons[k])) - Math.min(...tri.map((k) => lons[k]));
              if (spread(inWin) > Math.PI) {
                windowTorn++;
                tornHere++;
              }
              if (spread(inCentre) > Math.PI) centreTorn++;
            }
          }
        }
        if (tornHere > 0) instancesWithTear++;
      }
      console.log(
        `[morph-leaves] 600 km ${poseId}: instances ${pack.instances}, torn flagged ${pack.torn}; triangles spanning more than pi of longitude: ` +
          `window placement ${windowTorn} (in ${instancesWithTear} instances), placement around the leaf centre ${centreTorn}`,
      );
      expect(centreTorn).toBeLessThanOrEqual(windowTorn);
    });
  }
});

describe('morph-leaves: the torn flag in the pack', () => {
  const level = 3;
  const all = leavesOfLevel(level).map((l) => ({ face: l.face, level, i: l.u0 / l.span, j: l.v0 / l.span }));
  const capacity = instanceCapacity(all.length);
  const leafData = new Float32Array(capacity * LEAF_STRIDE);
  const infoData = new Float32Array(capacity * LEAF_STRIDE);

  it('flags no instance at the default centre (the poles are lattice vertices) and keeps the side at magnitude 1', () => {
    const pack = packMorphLeaves(fakeSelector(all), DOMAIN, PATCH, capacity, BASIS, 0.5, leafData, infoData);
    expect(pack.torn).toBe(0);
    for (let k = 0; k < pack.instances; k++) expect(Math.abs(infoData[k * LEAF_STRIDE + 2])).toBe(1);
  });

  it('flags the instances of the leaves that hold a pole strictly inside, at magnitude 2 with the side kept, for a tilted centre', () => {
    const tilted = projectionBasis(20, 35);
    const pack = packMorphLeaves(fakeSelector(all), DOMAIN, PATCH, capacity, tilted, 0.5, leafData, infoData);
    expect(pack.torn).toBeGreaterThanOrEqual(1);
    let magnitude2 = 0;
    for (let k = 0; k < pack.instances; k++) {
      const z = Math.abs(infoData[k * LEAF_STRIDE + 2]);
      expect(z === 1 || z === 2).toBeTrue();
      if (z === 2) magnitude2++;
    }
    expect(magnitude2).toBe(pack.torn);
  });

  it('writes no torn flag at morph 0', () => {
    const tilted = projectionBasis(20, 35);
    const pack = packMorphLeaves(fakeSelector(all), DOMAIN, PATCH, capacity, tilted, 0, leafData, infoData);
    expect(pack.torn).toBe(0);
    for (let k = 0; k < pack.instances; k++) expect(Math.abs(infoData[k * LEAF_STRIDE + 2])).toBe(1);
  });
});

describe('morph-leaves: the pole corner and its edge longitudes', () => {
  const level = 2;
  const all = leavesOfLevel(level).map((l) => ({ face: l.face, level, i: l.u0 / l.span, j: l.v0 / l.span }));
  const capacity = instanceCapacity(all.length);
  const leafData = new Float32Array(capacity * LEAF_STRIDE);
  const infoData = new Float32Array(capacity * LEAF_STRIDE);
  const capData = new Float32Array(capacity * LEAF_STRIDE);

  it('finds the pole corner of exactly the four leaves around each pole at the default centre, none at a tilted one', () => {
    let corners = 0;
    for (const leaf of leavesOfLevel(level)) if (leafPoleCorner(BASIS, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span)) corners++;
    expect(corners).toBe(8);
    const tilted = projectionBasis(20, 35);
    for (const leaf of leavesOfLevel(level)) expect(leafPoleCorner(tilted, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span)).toBeUndefined();
  });

  it('the two edges at the pole corner run along meridians a quarter turn apart, and both lie within a quarter turn of the leaf centre', () => {
    for (const leaf of leavesOfLevel(level)) {
      const corner = leafPoleCorner(BASIS, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span);
      if (!corner) continue;
      const a = analyseLeaf(BASIS, DOMAIN, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span);
      const leafLon = poleVertexLongitude(BASIS, a.centre, a.side);
      const lon = edgeLongitudes(BASIS, DOMAIN, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span, corner, leafLon);
      expect(Math.abs(Math.abs(lon.x - lon.y) - Math.PI / 2)).toBeLessThan(1e-9);
      expect(Math.abs(lon.x - leafLon)).toBeCloseTo(Math.PI / 4, 9);
      expect(Math.abs(lon.y - leafLon)).toBeCloseTo(Math.PI / 4, 9);
    }
  });

  it('the pack writes the corner and the edge longitudes for those leaves at morph above 0, and -1 for every other instance', () => {
    const pack = packMorphLeaves(fakeSelector(all), DOMAIN, PATCH, capacity, BASIS, 0.5, leafData, infoData, true, capData);
    let withCorner = 0;
    for (let k = 0; k < pack.instances; k++) {
      const z = capData[k * LEAF_STRIDE + 2];
      if (z >= 0) {
        withCorner++;
        expect([0, 1]).toContain(z);
        expect([0, 1]).toContain(capData[k * LEAF_STRIDE + 3]);
      } else {
        expect(z).toBe(-1);
      }
    }
    expect(withCorner).toBeGreaterThanOrEqual(8);
    const atGlobe = packMorphLeaves(fakeSelector(all), DOMAIN, PATCH, capacity, BASIS, 0, leafData, infoData, true, capData);
    for (let k = 0; k < atGlobe.instances; k++) expect(capData[k * LEAF_STRIDE + 2]).toBe(-1);
  });
});
