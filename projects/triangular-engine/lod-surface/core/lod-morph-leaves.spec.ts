import { latticeSteps } from './lod-lattice';
import type { LodDomain } from './lod-domain';
import { LEAF_STRIDE } from './lod-leaf-pack';
import { computeMorphFrame, createMorphMap, latticeDirection, projectionBasis, unwrapToSide } from './lod-morph-frame';
import {
  analyseLeaf, inWindow, instanceCapacity, isPoleFanLeaf, leafPoleCorner, leafTorn, longitudeOf, packMorphLeaves, poleVertexLongitude,
} from './lod-morph-leaves';
import { sceneCameraAt } from './lod-morph.testing';
import { LodSelector, maxLevelFor, type PatchCells } from './lod-selector';

/** Plan 059, step G6b: which leaves reach the map's cut, how they are packed, and the pole vertex longitude. */

const PATCH: PatchCells = 16;
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
      const lon = centreLon + (delta - TWO_PI * Math.round(delta / TWO_PI));
      if (lon >= Math.PI || lon <= -Math.PI) return true;
    }
  }
  return false;
}

describe('lod-morph-leaves: the straddle test', () => {
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
    // The 10 % margin makes a few extra leaves reach the cut; it stays a small number.
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
    const span = (1 << (MAX_LEVEL - 4)) * PATCH;
    const a = analyseLeaf(BASIS, DOMAIN, STEPS, 4, 8 * span, 8 * span, span);
    const d = latticeDirection(4, 8 * span + span / 2, 8 * span + span / 2, STEPS, DOMAIN);
    expect(Math.abs(longitudeOf(BASIS, d))).toBeLessThan(1);
    expect(a.reachesCut).toBeFalse();
    expect(a.containsPole).toBeFalse();
  });
});

describe('lod-morph-leaves: the pole vertex longitude', () => {
  it("is the leaf's centre longitude unwrapped into the side window", () => {
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

  it('puts the four corner-sharing leaves of the default pole at four different longitudes, a quarter of the map apart', () => {
    const centre = STEPS / 2;
    const lons: number[] = [];
    for (const leaf of leavesOfLevel(2)) {
      const onCorner = [leaf.u0, leaf.u0 + leaf.span].includes(centre) && [leaf.v0, leaf.v0 + leaf.span].includes(centre);
      if (!onCorner) continue;
      const d = latticeDirection(leaf.face, centre, centre, STEPS, DOMAIN);
      if (d[1] < 0.999999) continue;
      const c = latticeDirection(leaf.face, leaf.u0 + leaf.span / 2, leaf.v0 + leaf.span / 2, STEPS, DOMAIN);
      lons.push((longitudeOf(BASIS, c) * 180) / Math.PI);
    }
    lons.sort((a, b) => a - b);
    expect(lons.length).toBe(4);
    for (let i = 1; i < lons.length; i++) expect(lons[i] - lons[i - 1]).toBeGreaterThan(80);
  });
});

describe('lod-morph-leaves: leafTorn and the pole fan leaves', () => {
  it('leafTorn is false for every leaf when the poles are lattice vertices (the default centre): the quarter-map leaves are not torn', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      for (const leaf of leavesOfLevel(level)) expect(leafTorn(BASIS, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span)).toBeFalse();
    }
  });

  it('leafTorn is true for the one leaf per level (per pole) that has a pole strictly inside it, for a tilted centre', () => {
    const tilted = projectionBasis(20, 35);
    for (const level of [2, 3, 4, 5]) {
      const torn = leavesOfLevel(level).filter((l) => leafTorn(tilted, STEPS, l.face, l.u0, l.v0, l.span));
      expect(torn.length).toBeGreaterThanOrEqual(1);
      expect(torn.length).toBeLessThanOrEqual(2);
      for (const leaf of torn) expect(analyseLeaf(tilted, DOMAIN, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span).containsPole).toBeTrue();
    }
  });

  it('leafTorn is false for a leaf far from the poles', () => {
    const tilted = projectionBasis(20, 35);
    const span = (1 << (MAX_LEVEL - 4)) * PATCH;
    expect(leafTorn(tilted, STEPS, 4, 8 * span, 8 * span, span)).toBeFalse();
  });

  it('finds the pole corner of exactly the four leaves around each pole at the default centre, none at a tilted one', () => {
    let corners = 0;
    for (const leaf of leavesOfLevel(2)) if (leafPoleCorner(BASIS, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span)) corners++;
    expect(corners).toBe(8);
    const tilted = projectionBasis(20, 35);
    for (const leaf of leavesOfLevel(2)) expect(leafPoleCorner(tilted, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span)).toBeUndefined();
  });

  it('isPoleFanLeaf (the pole fan seam of G6d) is the corner leaves at the default centre and the torn leaves at a tilted one', () => {
    const tilted = projectionBasis(20, 35);
    let centred = 0;
    let tiltedCount = 0;
    for (const leaf of leavesOfLevel(3)) {
      const c = isPoleFanLeaf(BASIS, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span);
      const t = isPoleFanLeaf(tilted, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span);
      expect(c).toBe(leafPoleCorner(BASIS, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span) !== undefined);
      expect(t).toBe(leafTorn(tilted, STEPS, leaf.face, leaf.u0, leaf.v0, leaf.span));
      if (c) centred++;
      if (t) tiltedCount++;
    }
    expect(centred).toBe(8);
    expect(tiltedCount).toBeGreaterThanOrEqual(1);
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

const leavesAt = (level: number) => leavesOfLevel(level).map((l) => ({ face: l.face, level, i: l.u0 / l.span, j: l.v0 / l.span }));
const optionsOf = (capacity: number, basis = BASIS, morph = 0.5, extra: { duplicate?: boolean; skipPoleLeaves?: boolean } = {}) => ({
  domain: DOMAIN, patchCells: PATCH, capacity, basis, morph, ...extra,
});

describe('lod-morph-leaves: packing', () => {
  const all = leavesAt(2);
  const capacity = instanceCapacity(all.length);
  const leafData = new Float32Array(capacity * LEAF_STRIDE);
  const infoData = new Float32Array(capacity * LEAF_STRIDE);

  it('doubles the leaf capacity for the instance capacity', () => {
    expect(instanceCapacity(4096)).toBe(8192);
  });

  it('at morph 0 packs one instance per leaf, on the side of its centre, with no duplicates', () => {
    const pack = packMorphLeaves(fakeSelector(all), optionsOf(capacity, BASIS, 0), leafData, infoData);
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
    const pack = packMorphLeaves(fakeSelector(all), optionsOf(capacity), leafData, infoData);
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
    expect(packMorphLeaves(fakeSelector(all), optionsOf(capacity, BASIS, 0.5, { duplicate: false }), leafData, infoData).instances).toBe(all.length);
    const small = packMorphLeaves(fakeSelector(all), optionsOf(all.length), leafData, infoData);
    expect(small.instances).toBe(all.length);
    expect(small.dropped).toBe(small.duplicates);
    expect(small.dropped).toBeGreaterThan(0);
  });

  it('leaves out the pole fan leaves when asked, counts them, and writes the rest unchanged', () => {
    const plain = packMorphLeaves(fakeSelector(all), optionsOf(capacity), leafData, infoData);
    const skipping = packMorphLeaves(fakeSelector(all), optionsOf(capacity, BASIS, 0.5, { skipPoleLeaves: true }), leafData, infoData);
    expect(plain.skipped).toBeUndefined();
    expect(skipping.skipped).toBe(8);
    // Each pole leaf is a pole-cap leaf that reaches the cut: two instances in the plain pack, none in the skipping one.
    expect(skipping.instances).toBe(plain.instances - 8 * 2);
    expect(skipping.poleLeaves).toBe(0);
  });
});

describe('lod-morph-leaves: the torn flag in the pack', () => {
  const all = leavesAt(3);
  const capacity = instanceCapacity(all.length);
  const leafData = new Float32Array(capacity * LEAF_STRIDE);
  const infoData = new Float32Array(capacity * LEAF_STRIDE);

  it('flags no instance at the default centre (the poles are lattice vertices) and keeps the side at magnitude 1', () => {
    const pack = packMorphLeaves(fakeSelector(all), optionsOf(capacity), leafData, infoData);
    expect(pack.torn).toBe(0);
    for (let k = 0; k < pack.instances; k++) expect(Math.abs(infoData[k * LEAF_STRIDE + 2])).toBe(1);
  });

  it('flags the instances of the leaves that hold a pole strictly inside, at magnitude 2 with the side kept, for a tilted centre', () => {
    const pack = packMorphLeaves(fakeSelector(all), optionsOf(capacity, projectionBasis(20, 35)), leafData, infoData);
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
    const pack = packMorphLeaves(fakeSelector(all), optionsOf(capacity, projectionBasis(20, 35), 0), leafData, infoData);
    expect(pack.torn).toBe(0);
    for (let k = 0; k < pack.instances; k++) expect(Math.abs(infoData[k * LEAF_STRIDE + 2])).toBe(1);
  });
});

/** The duplicates the real selector asks for in each view, with the bent camera of the morph. */
describe('lod-morph-leaves: duplicates per view (the real selector)', () => {
  const views: { id: string; lon: number; lat: number; altitude: (radius: number) => number }[] = [
    { id: 'orbit-map', lon: 0.3, lat: 0.3, altitude: (r) => 2 * r },
    { id: 'mid-200m', lon: 0.5, lat: 0.4, altitude: () => 200 },
    { id: 'mid-2m', lon: 0.5, lat: 0.4, altitude: () => 2 },
    { id: 'cut-east-2m', lon: 3.1, lat: 0.3, altitude: () => 2 },
    { id: 'cut-west-2m', lon: -3.1, lat: 0.3, altitude: () => 2 },
    { id: 'pole-200m', lon: 0.3, lat: 1.55, altitude: () => 200 },
  ];
  for (const radiusM of [600_000, 6_371_000]) {
    for (const view of views) {
      it(`packs them without drops: ${radiusM / 1000} km, ${view.id}`, () => {
        const domain = domainOf(radiusM);
        const selector = new LodSelector({
          domain, patchCells: PATCH, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap: 4096, heightBoundM: 0, cull: false, hysteresis: 0.15,
        });
        const map = createMorphMap({ morph: 0.5, projection: 'equal-earth', projectionCentre: { lonDeg: 0, latDeg: 0 } }, radiusM);
        const frame = computeMorphFrame(map, domain, STEPS, sceneCameraAt(map, view.lon, view.lat, view.altitude(radiusM)));
        const pixelAngle = (2 * Math.tan(Math.PI / 6)) / 576;
        for (let pass = 0; pass < 3; pass++) selector.select({ camera: frame.selectorCamera, pixelAngle, frustum: new Float64Array(12) });
        const capacity = instanceCapacity(4096);
        const leafData = new Float32Array(capacity * LEAF_STRIDE);
        const infoData = new Float32Array(capacity * LEAF_STRIDE);
        const pack = packMorphLeaves(selector, { domain, patchCells: PATCH, capacity, basis: map.basis, morph: 0.5 }, leafData, infoData);
        expect(pack.leaves).toBeGreaterThan(0);
        expect(pack.dropped).toBe(0);
        expect(pack.instances).toBe(pack.leaves + pack.duplicates);
        expect(pack.instances).toBeLessThanOrEqual(capacity);
        // A camera at the cut, or over a pole, sees leaves that reach it.
        if (view.id.startsWith('cut') || view.id.startsWith('pole')) expect(pack.duplicates).toBeGreaterThan(0);
      });
    }
  }
});

/**
 * Triangles of an instance whose vertices, placed in the side window, are more than pi apart in longitude (a torn triangle crosses the
 * map). Placed around the leaf's own centre longitude there are never more of them than in the window placement.
 */
describe('lod-morph-leaves: torn triangles (window placement against placement around the leaf centre)', () => {
  for (const view of [{ id: 'pole-200m', lon: 0.3, lat: 1.55, altitude: 200 }, { id: 'orbit-map', lon: 0.3, lat: 0.3, altitude: 1_200_000 }]) {
    it(`counts them: 600 km ${view.id}`, () => {
      const radiusM = 600_000;
      const domain = domainOf(radiusM);
      const selector = new LodSelector({
        domain, patchCells: PATCH, mode: 'distance', fixedLevel: 5, cellPixels: 4, leafCap: 4096, heightBoundM: 0, cull: false, hysteresis: 0.15,
      });
      const map = createMorphMap({ morph: 0.5, projection: 'equal-earth', projectionCentre: { lonDeg: 0, latDeg: 0 } }, radiusM);
      const frame = computeMorphFrame(map, domain, STEPS, sceneCameraAt(map, view.lon, view.lat, view.altitude));
      for (let pass = 0; pass < 3; pass++) selector.select({ camera: frame.selectorCamera, pixelAngle: (2 * Math.tan(Math.PI / 6)) / 576, frustum: new Float64Array(12) });
      const capacity = instanceCapacity(4096);
      const leafData = new Float32Array(capacity * LEAF_STRIDE);
      const infoData = new Float32Array(capacity * LEAF_STRIDE);
      const pack = packMorphLeaves(selector, { domain, patchCells: PATCH, capacity, basis: map.basis, morph: 0.5 }, leafData, infoData);
      const side = PATCH + 1;
      let windowTorn = 0;
      let centreTorn = 0;
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
            const isPole = Math.abs(d[0] * map.basis.up[0] + d[1] * map.basis.up[1] + d[2] * map.basis.up[2]) > 1 - 1e-12;
            const lon = longitudeOf(map.basis, d);
            inWin.push(isPole ? centreLon : unwrapToSide(lon, sigma).lon);
            const delta = lon - centreLon;
            inCentre.push(isPole ? centreLon : centreLon + delta - TWO_PI * Math.round(delta / TWO_PI));
          }
        }
        for (let j = 0; j < PATCH; j++) {
          for (let i = 0; i < PATCH; i++) {
            const a = j * side + i;
            for (const tri of [[a, a + 1, a + side + 1], [a, a + side + 1, a + side]]) {
              const spread = (lons: number[]): number => Math.max(...tri.map((k) => lons[k])) - Math.min(...tri.map((k) => lons[k]));
              if (spread(inWin) > Math.PI) windowTorn++;
              if (spread(inCentre) > Math.PI) centreTorn++;
            }
          }
        }
      }
      expect(centreTorn).toBeLessThanOrEqual(windowTorn);
    });
  }
});
