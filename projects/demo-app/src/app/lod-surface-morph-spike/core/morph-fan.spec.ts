import { TERRAIN_DEFAULTS, latticeSteps, maxLevelFor, type LodDomain, type LodSelector } from 'triangular-engine/lod-surface/core';
import { computeMorphFrame, latticeDirection, poseOf, projectionBasis, referenceVertex, type MorphView } from './morph-frame';
import { buildPoleFan, fanLeafPole, ringFractions } from './morph-fan';
import { leafPoleCorner, leafTorn, longitudeOf, packMorphLeaves, poleLattices } from './morph-leaves';

const PATCH = TERRAIN_DEFAULTS.patchCells;
const MAX_LEVEL = maxLevelFor(PATCH);
const STEPS = latticeSteps(PATCH, MAX_LEVEL);
const RADIUS = 6_371_000;
const DOMAIN: LodDomain = { kind: 'sphere', sizeM: RADIUS, warp: 'equal-angle' };

interface FakeLeaf {
  face: number;
  level: number;
  i: number;
  j: number;
  mask?: number;
}

/** Just enough of a selector for the fan builder and the packer: the drawn leaves' arrays. */
function fakeSelector(leaves: FakeLeaf[]): LodSelector {
  return {
    leaves: Int32Array.from(leaves.map((_, k) => k)),
    masks: Uint8Array.from(leaves.map((l) => l.mask ?? 0)),
    level: Int32Array.from(leaves.map((l) => l.level)),
    i: Int32Array.from(leaves.map((l) => l.i)),
    j: Int32Array.from(leaves.map((l) => l.j)),
    root: Int32Array.from(leaves.map((l) => l.face)),
    stats: { drawn: leaves.length },
    version: 1,
  } as unknown as LodSelector;
}

function viewOf(centreLonDeg: number, centreLatDeg: number, morph: number): MorphView {
  return { radiusM: RADIUS, morph, centreLonDeg, centreLatDeg, pose: poseOf('pole-200m', RADIUS, morph), groundHeightM: 0 };
}

/** The face and lattice position of the basis' up pole. */
function poleOf(centreLonDeg: number, centreLatDeg: number): { face: number; u: number; v: number } {
  const basis = projectionBasis(centreLonDeg, centreLatDeg);
  for (let face = 0; face < 6; face++) {
    const found = poleLattices(basis, STEPS, face, DOMAIN.warp).find((p) => p.sign === 1);
    if (found) return { face, u: found.u, v: found.v };
  }
  throw new Error('no pole');
}

/** The four leaves of a level that share the pole at a lattice vertex (centre 0, 0). */
function cornerLeaves(level: number): FakeLeaf[] {
  const { face } = poleOf(0, 0);
  const half = 2 ** level / 2;
  return [half - 1, half].flatMap((i) => [half - 1, half].map((j) => ({ face, level, i, j })));
}

/** The leaf of a level that holds the pole strictly inside (a tilted centre). */
function interiorLeaf(level: number, centreLonDeg: number, centreLatDeg: number): FakeLeaf {
  const { face, u, v } = poleOf(centreLonDeg, centreLatDeg);
  const span = (1 << (MAX_LEVEL - level)) * PATCH;
  return { face, level, i: Math.floor(u / span), j: Math.floor(v / span) };
}

describe('morph-fan: which leaves', () => {
  it('finds the four leaves around a lattice-vertex pole as corners and a tilted pole as one interior leaf', () => {
    const basis = projectionBasis(0, 0);
    for (const leaf of cornerLeaves(3)) {
      const span = (1 << (MAX_LEVEL - 3)) * PATCH;
      const pole = fanLeafPole(basis, STEPS, leaf.face, leaf.i * span, leaf.j * span, span, DOMAIN.warp);
      expect(pole?.kind).toBe('corner');
      expect(leafPoleCorner(basis, STEPS, leaf.face, leaf.i * span, leaf.j * span, span, DOMAIN.warp)).toBeDefined();
    }
    const tilted = projectionBasis(20, 35);
    const leaf = interiorLeaf(3, 20, 35);
    const span = (1 << (MAX_LEVEL - 3)) * PATCH;
    expect(fanLeafPole(tilted, STEPS, leaf.face, leaf.i * span, leaf.j * span, span, DOMAIN.warp)?.kind).toBe('interior');
    expect(leafTorn(tilted, STEPS, leaf.face, leaf.i * span, leaf.j * span, span, DOMAIN.warp)).toBeTrue();
  });

  it('packs without the pole leaves exactly when asked, and never at morph 0', () => {
    const leaves = [...cornerLeaves(3), { face: 0, level: 3, i: 1, j: 1 }];
    const selector = fakeSelector(leaves);
    const basis = projectionBasis(0, 0);
    const data = (): [Float32Array, Float32Array, Float32Array] => [new Float32Array(64 * 4), new Float32Array(64 * 4), new Float32Array(64 * 4)];
    const [l0, i0, c0] = data();
    const kept = packMorphLeaves(selector, DOMAIN, PATCH, 64, basis, 0.5, l0, i0, true, c0, true);
    const [l1, i1, c1] = data();
    const all = packMorphLeaves(selector, DOMAIN, PATCH, 64, basis, 0.5, l1, i1, true, c1, false);
    expect(kept.skipped).toBe(4);
    expect(kept.leaves).toBe(5);
    expect(all.instances - kept.instances).toBeGreaterThanOrEqual(4);
    const [l2, i2, c2] = data();
    const globe = packMorphLeaves(selector, DOMAIN, PATCH, 64, basis, 0, l2, i2, true, c2, true);
    expect(globe.instances).toBe(5);
    expect(globe.skipped).toBe(0);
  });
});

describe('morph-fan: ring fractions', () => {
  it('run from the boundary (1) to the pole (0), strictly descending, linear then geometric', () => {
    const f = ringFractions(PATCH, 0.1, RADIUS);
    expect(f[0]).toBe(1);
    expect(f[f.length - 1]).toBe(0);
    for (let k = 1; k < f.length; k++) expect(f[k]).toBeLessThan(f[k - 1]);
    expect(f[PATCH / 2]).toBeCloseTo(0.5, 12);
    expect(f[PATCH / 2 + 1]).toBeCloseTo(0.25, 12);
    expect(f.length).toBeGreaterThan(PATCH / 2 + 8);
  });
});

describe('morph-fan: the corner case (centre 0, 0)', () => {
  const frame = computeMorphFrame(viewOf(0, 0, 0.5), DOMAIN, STEPS);
  const selector = fakeSelector(cornerLeaves(3));

  it('builds four quarter fans with the counts of its grid and no NaN', () => {
    const fan = buildPoleFan(selector, DOMAIN, PATCH, 64, frame, 1024, 0);
    expect(fan.stats.leaves).toBe(4);
    expect(fan.stats.corner).toBe(4);
    expect(fan.stats.interior).toBe(0);
    expect(fan.stats.vertices).toBe(fan.positions.length / 3);
    expect(fan.stats.triangles).toBe(fan.index.length / 3);
    expect(fan.positions.every(Number.isFinite)).toBeTrue();
    let top = 0;
    for (const k of fan.index) top = Math.max(top, k);
    expect(top).toBeLessThan(fan.stats.vertices);
    expect(fan.layout.length).toBe(4);
    // 1,024 rays per turn: each quarter has about 256 plus the boundary samples (2 x 16 - 1 chain samples).
    expect(fan.stats.vertices).toBeGreaterThan(4 * 256 * 20);
    expect(fan.stats.buildMs).toBeGreaterThan(0);
  });

  it('has more rays and vertices at 4,096 than at 256', () => {
    const small = buildPoleFan(selector, DOMAIN, PATCH, 64, frame, 256, 0).stats;
    const large = buildPoleFan(selector, DOMAIN, PATCH, 64, frame, 4096, 0).stats;
    expect(large.vertices).toBeGreaterThan(small.vertices * 4);
    expect(large.triangles).toBeGreaterThan(small.triangles * 4);
  });

  it('builds nothing at morph 0', () => {
    const globe = computeMorphFrame(viewOf(0, 0, 0), DOMAIN, STEPS);
    const fan = buildPoleFan(selector, DOMAIN, PATCH, 64, globe, 1024, 0);
    expect(fan.stats.vertices).toBe(0);
    expect(fan.stats.triangles).toBe(0);
  });

  it('puts the leaf\'s far corner (an outer ring vertex) where the vertex stage\'s reference puts it', () => {
    const fan = buildPoleFan(selector, DOMAIN, PATCH, 64, frame, 256, 0);
    const level = 3;
    const span = (1 << (MAX_LEVEL - level)) * PATCH;
    const { face } = poleOf(0, 0);
    // The leaf east-north of the pole: the far corner is (u0 + span, v0 + span).
    const leaf = cornerLeaves(level).find((l) => l.i === 4 && l.j === 4)!;
    const unit = latticeDirection(face, (leaf.i + 1) * span, (leaf.j + 1) * span, STEPS, DOMAIN);
    const centre = latticeDirection(face, leaf.i * span + span / 2, leaf.j * span + span / 2, STEPS, DOMAIN);
    const leafLon = longitudeOf(frame.basis, centre);
    const expected = referenceVertex(frame, unit, leafLon >= 0 ? 1 : -1, 0, undefined, leafLon).rel;
    let best = Infinity;
    for (let v = 0; v < fan.positions.length; v += 3) {
      best = Math.min(best, Math.hypot(fan.positions[v] - expected[0], fan.positions[v + 1] - expected[1], fan.positions[v + 2] - expected[2]));
    }
    const scale = Math.hypot(expected[0], expected[1], expected[2]);
    expect(best).toBeLessThan(1e-6 * scale + 1e-3);
  });

  it('has the pole ring on the map\'s top edge: one point per ray, spread over the leaf\'s 90 degrees of longitude', () => {
    const one = fakeSelector([cornerLeaves(3)[3]]);
    const fan = buildPoleFan(one, DOMAIN, PATCH, 64, frame, 1024, 0);
    expect(fan.stats.leaves).toBe(1);
    const { first, rays, rings } = fan.layout[0];
    // The pole ring is the last vertex of each ray; the map frame's y is `basis.up` of the body position, relative to the camera.
    const up = frame.basis.up;
    const heights: number[] = [];
    for (let j = 0; j < rays; j++) {
      const base = (first + j * rings + rings - 1) * 3;
      heights.push(fan.positions[base] * up[0] + fan.positions[base + 1] * up[1] + fan.positions[base + 2] * up[2]);
    }
    expect(heights.length).toBeGreaterThan(200);
    // Every pole vertex is at the map's top edge: the same height along up (all within a few metres of one another).
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    expect(max - min).toBeLessThan(2000);
  });
});

describe('morph-fan: the interior case (centre 20, 35)', () => {
  const frame = computeMorphFrame(viewOf(20, 35, 0.5), DOMAIN, STEPS);
  const leaf = interiorLeaf(3, 20, 35);
  const selector = fakeSelector([leaf]);

  it('builds one closed fan whose first and last ray are the same meridian on the map\'s two edges', () => {
    const fan = buildPoleFan(selector, DOMAIN, PATCH, 64, frame, 1024, 0);
    expect(fan.stats.leaves).toBe(1);
    expect(fan.stats.interior).toBe(1);
    expect(fan.positions.every(Number.isFinite)).toBeTrue();
    const { rays, rings } = fan.layout[0];
    expect(rays * rings).toBe(fan.stats.vertices);
    expect(rays).toBeGreaterThanOrEqual(1025);
    expect(fan.stats.triangles).toBe((rays - 1) * (rings - 1) * 2);
    // The first and the last ray hold the same lattice point on the cut: their outer vertices differ by a map width (2 pi R p cos-ish) - at least a quarter of it.
    const first: number[] = [0, 1, 2].map((a) => fan.positions[a]);
    const last: number[] = [0, 1, 2].map((a) => fan.positions[(fan.stats.vertices - rings) * 3 + a]);
    expect(Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2])).toBeGreaterThan(Math.PI * RADIUS * 0.25);
  });

  it('puts a boundary corner where the vertex stage\'s reference puts it', () => {
    const fan = buildPoleFan(selector, DOMAIN, PATCH, 64, frame, 256, 0);
    const span = (1 << (MAX_LEVEL - leaf.level)) * PATCH;
    const unit = latticeDirection(leaf.face, leaf.i * span, leaf.j * span, STEPS, DOMAIN);
    const lon = longitudeOf(frame.basis, unit);
    const expected = referenceVertex(frame, unit, lon >= 0 ? 1 : -1, 0, undefined, lon).rel;
    let best = Infinity;
    for (let v = 0; v < fan.positions.length; v += 3) {
      best = Math.min(best, Math.hypot(fan.positions[v] - expected[0], fan.positions[v + 1] - expected[1], fan.positions[v + 2] - expected[2]));
    }
    expect(best).toBeLessThan(1e-6 * Math.hypot(expected[0], expected[1], expected[2]) + 1e-3);
  });
});
