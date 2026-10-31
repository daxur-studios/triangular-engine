import { createMorphMap, projectionBasis, type MorphMap } from './lod-morph-frame';
import { leafPoleCorner, leafTorn } from './lod-morph-leaves';
import {
  FAN_COLUMN, FAN_SPEC_STRIDE, PoleFanTopology, buildPoleFanSpecs, poleFanLeafPole, poleFanContext, poleFanLeavesOf, ringFractions, sameFanLeaf,
  type PoleFanContext,
} from './lod-morph-fan';
import {
  FAN_DOMAIN, FAN_PATCH, FAN_RADIUS, FAN_STEPS, FAN_MAX_LEVEL, cornerLeavesOf, fakeSelector, interiorLeafOf,
} from './lod-morph-fan.testing';

const TWO_PI = 2 * Math.PI;

function mapOf(lonDeg: number, latDeg: number, morph = 0.5, projection: 'equal-earth' | 'equirectangular' = 'equal-earth', radius = FAN_RADIUS): MorphMap {
  return createMorphMap({ morph, projection, projectionCentre: { lonDeg, latDeg } }, radius);
}

function ctxOf(lonDeg: number, latDeg: number, morph = 0.5, projection: 'equal-earth' | 'equirectangular' = 'equal-earth'): PoleFanContext {
  return poleFanContext(mapOf(lonDeg, latDeg, morph, projection), FAN_DOMAIN, FAN_PATCH);
}

/** The pole leaves of a selector at a projection centre, as the fan sees them. */
function leavesOf(leaves: ReturnType<typeof cornerLeavesOf>, lonDeg: number, latDeg: number) {
  return poleFanLeavesOf(fakeSelector(leaves), FAN_DOMAIN, FAN_PATCH, 64, projectionBasis(lonDeg, latDeg));
}

describe('lod-morph-fan: which leaves', () => {
  it('finds the four leaves around a lattice-vertex pole as corners and a tilted pole as one interior leaf', () => {
    const basis = projectionBasis(0, 0);
    const span = (1 << (FAN_MAX_LEVEL - 3)) * FAN_PATCH;
    for (const leaf of cornerLeavesOf(3)) {
      const pole = poleFanLeafPole(basis, FAN_STEPS, leaf.face, leaf.i * span, leaf.j * span, span, FAN_DOMAIN.warp);
      expect(pole?.kind).toBe('corner');
      expect(leafPoleCorner(basis, FAN_STEPS, leaf.face, leaf.i * span, leaf.j * span, span, FAN_DOMAIN.warp)).toBeDefined();
    }
    const tilted = projectionBasis(20, 35);
    const leaf = interiorLeafOf(3, 20, 35);
    expect(poleFanLeafPole(tilted, FAN_STEPS, leaf.face, leaf.i * span, leaf.j * span, span, FAN_DOMAIN.warp)?.kind).toBe('interior');
    expect(leafTorn(tilted, FAN_STEPS, leaf.face, leaf.i * span, leaf.j * span, span, FAN_DOMAIN.warp)).toBeTrue();
  });

  it('takes the pole leaves of a selector in its order, with the leaf longitude and the corner\'s edges', () => {
    const leaves = leavesOf(cornerLeavesOf(3), 0, 0);
    expect(leaves.length).toBe(4);
    for (const leaf of leaves) {
      expect(leaf.pole.kind).toBe('corner');
      expect(leaf.cap).toBeDefined();
      expect(Number.isFinite(leaf.leafLon)).toBeTrue();
    }
    // A plain leaf far from the pole is no fan leaf.
    const plain = leavesOf([{ face: 0, level: 3, i: 1, j: 1 }], 0, 0);
    expect(plain.length).toBe(0);
    expect(leavesOf([...cornerLeavesOf(3), interiorLeafOf(3, 20, 35)], 0, 0).length).toBe(4);
  });

  it('keeps the set of pole leaves and their masks as the rebuild rule sees them', () => {
    const a = leavesOf(cornerLeavesOf(3), 0, 0);
    const b = leavesOf(cornerLeavesOf(3).map((l, k) => (k === 0 ? { ...l, mask: 1 } : l)), 0, 0);
    expect(sameFanLeaf(a[0], a[0])).toBeTrue();
    expect(sameFanLeaf(a[0], b[0])).toBeFalse();
    expect(sameFanLeaf(a[1], b[1])).toBeTrue();
  });
});

describe('lod-morph-fan: ring fractions', () => {
  it('run from the boundary (1) to the pole (0), strictly descending, linear then geometric', () => {
    const f = ringFractions(FAN_PATCH, 0.1, FAN_RADIUS);
    expect(f[0]).toBe(1);
    expect(f[f.length - 1]).toBe(0);
    for (let k = 1; k < f.length; k++) expect(f[k]).toBeLessThan(f[k - 1]);
    expect(f[FAN_PATCH / 2]).toBeCloseTo(0.5, 12);
    expect(f[FAN_PATCH / 2 + 1]).toBeCloseTo(0.25, 12);
    expect(f.length).toBeGreaterThan(FAN_PATCH / 2 + 8);
  });
});

describe('lod-morph-fan: the corner case (centre 0, 0)', () => {
  const leaves = leavesOf(cornerLeavesOf(3), 0, 0);

  it('builds four quarter fans with the counts of its grid, all in range and finite', () => {
    const specs = buildPoleFanSpecs(ctxOf(0, 0), leaves, 1024);
    expect(specs.leaves.length).toBe(4);
    expect(specs.corner).toBe(4);
    expect(specs.interior).toBe(0);
    expect(specs.copies).toBe(0);
    expect(specs.layout.length).toBe(4);
    expect(specs.data.length).toBe(specs.vertexCount * FAN_SPEC_STRIDE);
    // NaN is a legal value of the chord's pole longitude column (no pole longitude); every other value is finite.
    expect(Array.from(specs.data).filter((x) => !Number.isNaN(x)).every((x) => Number.isFinite(x))).toBeTrue();
    expect(specs.index.length % 6).toBe(0);
    expect(specs.index.length / 3).toBeGreaterThan(0);
    let top = 0;
    for (const k of specs.index) top = Math.max(top, k);
    expect(top).toBeLessThan(specs.vertexCount);
    // 1,024 rays per turn: each quarter has about 256 plus the boundary samples.
    expect(specs.vertexCount).toBeGreaterThan(4 * 256 * 20);
    expect(specs.buildMs).toBeGreaterThanOrEqual(0);
  });

  it('has more rays and vertices at 4,096 than at 256', () => {
    const ctx = ctxOf(0, 0);
    const small = buildPoleFanSpecs(ctx, leaves, 256);
    const large = buildPoleFanSpecs(ctx, leaves, 4096);
    expect(large.vertexCount).toBeGreaterThan(small.vertexCount * 4);
    expect(large.index.length).toBeGreaterThan(small.index.length * 4);
  });

  it('has the pole ring as the last ring of every ray, at the pole (colatitude 0, or a chord through the pole corner)', () => {
    const specs = buildPoleFanSpecs(ctxOf(0, 0), leavesOf(cornerLeavesOf(3).slice(3), 0, 0), 256);
    const { first, rays, rings } = specs.layout[0];
    for (let j = 0; j < rays; j++) {
      const v = (first + j * rings + rings - 1) * FAN_SPEC_STRIDE;
      if (specs.data[v + FAN_COLUMN.KIND] === 1) expect(specs.data[v + FAN_COLUMN.C]).toBe(0);
      else expect(Number.isNaN(specs.data[v + FAN_COLUMN.POLE_LON])).toBeFalse();
    }
  });
});

describe('lod-morph-fan: the interior case (centre 20, 35)', () => {
  const leaves = leavesOf([interiorLeafOf(3, 20, 35)], 20, 35);

  it('builds one closed fan with rays x rings vertices and a strip of quads between them', () => {
    const specs = buildPoleFanSpecs(ctxOf(20, 35), leaves, 1024);
    expect(specs.leaves.length).toBe(1);
    expect(specs.interior).toBe(1);
    expect(specs.copies).toBe(0);
    const { rays, rings } = specs.layout[0];
    expect(rays * rings).toBe(specs.vertexCount);
    expect(rays).toBeGreaterThanOrEqual(1025);
    expect(specs.index.length / 3).toBe((rays - 1) * (rings - 1) * 2);
  });

  it('lies on one meridian at its first and last ray (the map\'s two edges), which carry the same leaf', () => {
    const specs = buildPoleFanSpecs(ctxOf(20, 35), leaves, 256);
    const { first, rays, rings } = specs.layout[0];
    const lonAt = (j: number) => specs.data[(first + j * rings + rings - 1) * FAN_SPEC_STRIDE + FAN_COLUMN.LON];
    expect(lonAt(0)).toBeCloseTo(-Math.PI, 12);
    expect(lonAt(rays - 1)).toBeCloseTo(Math.PI, 12);
  });
});

describe('lod-morph-fan: a leaf that straddles the cut gets a second copy shifted by 2 pi', () => {
  // With the projection centre at longitude 45 degrees the pole's four leaves are the quarters [45, 135], [135, 225], [225, 315] and [-45, 45]
  // of the map's longitude: the one at [135, 225] runs past +pi.
  const leaves = leavesOf(cornerLeavesOf(3, 45, 0), 45, 0);
  const specs = buildPoleFanSpecs(ctxOf(45, 0), leaves, 256);

  it('draws the straddling leaf twice: one copy as it is and one shifted by 2 pi (its sign follows the side it overhangs), and nothing else', () => {
    expect(leaves.length).toBe(4);
    expect(specs.copies).toBe(1);
    expect(specs.patches.length).toBe(5);
    const shifted = specs.patches.filter((p) => p.shift !== 0);
    expect(shifted.length).toBe(1);
    expect(Math.abs(shifted[0].shift)).toBeCloseTo(TWO_PI, 12);
    expect(specs.layout.length).toBe(5);
  });

  it('gives the copy the same sweep with every longitude it writes shifted by exactly the copy\'s shift', () => {
    const k = specs.patches.findIndex((p) => p.shift !== 0);
    const original = specs.patches.findIndex((p) => p.leaf === specs.patches[k].leaf && p.shift === 0);
    const a = specs.layout[original];
    const b = specs.layout[k];
    const shift = specs.patches[k].shift;
    expect(a.rays).toBe(b.rays);
    expect(a.rings).toBe(b.rings);
    let polar = 0;
    let chord = 0;
    for (let v = 0; v < a.rays * a.rings; v++) {
      const va = (a.first + v) * FAN_SPEC_STRIDE;
      const vb = (b.first + v) * FAN_SPEC_STRIDE;
      expect(specs.data[vb + FAN_COLUMN.KIND]).toBe(specs.data[va + FAN_COLUMN.KIND]);
      expect(specs.data[vb + FAN_COLUMN.C]).toBe(specs.data[va + FAN_COLUMN.C]);
      if (specs.data[va + FAN_COLUMN.KIND] === 1) {
        polar++;
        expect(specs.data[vb + FAN_COLUMN.LON] - specs.data[va + FAN_COLUMN.LON]).toBeCloseTo(shift, 12);
      } else {
        chord++;
        expect(specs.data[vb + FAN_COLUMN.REFA] - specs.data[va + FAN_COLUMN.REFA]).toBeCloseTo(shift, 12);
        expect(specs.data[vb + FAN_COLUMN.REFB] - specs.data[va + FAN_COLUMN.REFB]).toBeCloseTo(shift, 12);
        const pa = specs.data[va + FAN_COLUMN.POLE_LON];
        if (!Number.isNaN(pa)) expect(specs.data[vb + FAN_COLUMN.POLE_LON] - pa).toBeCloseTo(shift, 12);
      }
    }
    expect(polar).toBeGreaterThan(0);
    expect(chord).toBeGreaterThan(0);
  });

  it('puts the original leaf\'s longitudes past the map edge its copy is shifted from, so the copy is the part of it drawn on the other edge', () => {
    const k = specs.patches.findIndex((p) => p.shift !== 0);
    const original = specs.patches.findIndex((p) => p.shift === 0 && p.leaf === specs.patches[k].leaf);
    const cap = specs.patches[original].leaf.cap!;
    const lo = Math.min(cap[0], cap[1]);
    const hi = Math.max(cap[0], cap[1]);
    if (specs.patches[k].shift < 0) expect(hi).toBeGreaterThan(Math.PI);
    else expect(lo).toBeLessThan(-Math.PI);
    expect(hi - lo).toBeLessThan(TWO_PI);
  });
});

describe('lod-morph-fan: the topology\'s rebuild rule', () => {
  const map = mapOf(0, 0, 0.5);
  const selector = fakeSelector(cornerLeavesOf(3));

  it('builds once, then not for a camera move (a new selector of the same pole leaves) or a morph change', () => {
    const topology = new PoleFanTopology();
    expect(topology.specs).toBeUndefined();
    expect(topology.update(selector, FAN_DOMAIN, FAN_PATCH, 64, map, 1024)).toBeTrue();
    expect(topology.rebuilds).toBe(1);
    const built = topology.specs;
    // A camera move: the selector's version changes, its pole leaves do not.
    expect(topology.update(fakeSelector(cornerLeavesOf(3), 2), FAN_DOMAIN, FAN_PATCH, 64, map, 1024)).toBeFalse();
    // A morph change: the morph is not an input of the topology.
    expect(topology.update(selector, FAN_DOMAIN, FAN_PATCH, 64, mapOf(0, 0, 0.9), 1024)).toBeFalse();
    // A projection change (equirectangular): the descriptions do not depend on the map's weights.
    expect(topology.update(selector, FAN_DOMAIN, FAN_PATCH, 64, mapOf(0, 0, 0.5, 'equirectangular'), 1024)).toBeFalse();
    expect(topology.rebuilds).toBe(1);
    expect(topology.specs).toBe(built);
  });

  it('rebuilds for a change of the projection centre, the radius, the ray count or the pole-leaf set', () => {
    const topology = new PoleFanTopology();
    topology.update(selector, FAN_DOMAIN, FAN_PATCH, 64, map, 1024);
    expect(topology.update(selector, FAN_DOMAIN, FAN_PATCH, 64, mapOf(0.5, 0, 0.5), 1024)).toBeTrue();
    expect(topology.update(selector, FAN_DOMAIN, FAN_PATCH, 64, mapOf(0.5, 0, 0.5, 'equal-earth', 6_000_000), 1024)).toBeTrue();
    expect(topology.update(selector, FAN_DOMAIN, FAN_PATCH, 64, mapOf(0.5, 0, 0.5, 'equal-earth', 6_000_000), 256)).toBeTrue();
    const masked = fakeSelector(cornerLeavesOf(3).map((l, k) => (k === 2 ? { ...l, mask: 4 } : l)));
    expect(topology.update(masked, FAN_DOMAIN, FAN_PATCH, 64, mapOf(0.5, 0, 0.5, 'equal-earth', 6_000_000), 256)).toBeTrue();
    const fewer = fakeSelector(cornerLeavesOf(3).slice(1));
    expect(topology.update(fewer, FAN_DOMAIN, FAN_PATCH, 64, mapOf(0.5, 0, 0.5, 'equal-earth', 6_000_000), 256)).toBeTrue();
    expect(topology.rebuilds).toBe(6);
  });

  it('builds an empty fan when no drawn leaf is a pole leaf, does not rebuild for that again, and reset forgets the descriptions', () => {
    const topology = new PoleFanTopology();
    const plain = fakeSelector([{ face: 0, level: 3, i: 1, j: 1 }]);
    expect(topology.update(plain, FAN_DOMAIN, FAN_PATCH, 64, map, 1024)).toBeTrue();
    expect(topology.specs?.vertexCount).toBe(0);
    expect(topology.update(plain, FAN_DOMAIN, FAN_PATCH, 64, map, 1024)).toBeFalse();
    topology.reset();
    expect(topology.specs).toBeUndefined();
    expect(topology.update(plain, FAN_DOMAIN, FAN_PATCH, 64, map, 1024)).toBeTrue();
  });
});
