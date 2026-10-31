import { type LodDomain, type Vec3 } from './lod-domain';
import { cubeLattice } from './lod-lattice';
import { bendPoint, computeMorphFrame, createMorphMap, mapVectorToBody, morphMapXY, projectionBasis, type MorphFrame, type MorphMap, type MorphProjection } from './lod-morph-frame';
import {
  FAN_COLUMN, FAN_SPEC_STRIDE, buildPoleFanSpecs, colatitudeE, fanFrameNumbers, fanFrameWords, fanPolarPosition, foldFanGrid, packPoleFanVertices,
  poleFanContext, poleFanLeavesOf, polarParamsOf, splitDouble, type FanFrameNodes, type PoleFanLeaf, type PoleFanSpecs, type FanPolarParams,
} from './lod-morph-fan';
import { FAN_ATTRIBUTES } from './lod-morph-fan-stage';
import { DOUBLE_LIB, FLOAT32_LIB, liftAnchor, type Num, type NumLib } from './lod-morph-math';
import { evaluateVertex, exactRel, liftFrame, sceneCameraAt, type LiftedFrame } from './lod-morph.testing';
import {
  FAN_DOMAIN, FAN_PATCH, FAN_RADIUS, FAN_STEPS, cornerLeavesOf, fakeSelector, interiorLeafOf, type FakeLeaf,
} from './lod-morph-fan.testing';

/**
 * The pole fan's vertex stage as a CPU twin (Plan 059 G6d): the polar path through P2 and the chord's lattice path, evaluated over
 * `DOUBLE_LIB` (the algebra) and `FLOAT32_LIB` (every operation rounded to float32, where cancellation shows), against the definition in
 * doubles. Ported from the spike's `morph-fan-vertex.spec.ts` (suite v6): the same poses, tolerances and pixel scale. The GPU's own
 * arithmetic is not run here; `lod-morph-gpu.spec.ts` covers the lattice stage on the GPU.
 */

const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
/** Focal length in pixels of a 1,080-pixel-high view with a 60 degree vertical field of view (the spike's scale). */
const FOCAL_PX = 1080 / (2 * Math.tan(Math.PI / 6));

interface Case {
  readonly name: string;
  readonly radiusM: number;
  readonly centre: [number, number];
  readonly morph: number;
  /** The camera: projected longitude and latitude (degrees, in the projection basis) and its altitude (metres). */
  readonly pose: { readonly lonDeg: number; readonly latDeg: number; readonly altitudeM: number };
  /** True for the four leaves around a lattice-vertex pole, false for the one leaf that holds it strictly inside. Defaults to the (0, 0) centre. */
  readonly corner?: boolean;
  readonly projection?: MorphProjection;
}

/** The spike's 'pole-200m' view: 0.1 degrees (about 11 km) from the pole, 200 m up. */
const POLE_200M = { lonDeg: 20, latDeg: 89.9, altitudeM: 200 };
/** The spike's 'pole-2m' view: 2 m up, about 55 km from the pole. */
const POLE_2M = { lonDeg: 20, latDeg: 89.5, altitudeM: 2 };

/** A fan set up for one case: its frame, the leaves it came from and its descriptions. */
interface Setup {
  readonly map: MorphMap;
  readonly domain: LodDomain;
  readonly frame: MorphFrame;
  readonly specs: PoleFanSpecs;
}

function setup(c: Case, rays = 256): Setup {
  const domain: LodDomain = { kind: 'sphere', sizeM: c.radiusM, warp: 'equal-angle' };
  const map = createMorphMap({ morph: c.morph, projection: c.projection ?? 'equal-earth', projectionCentre: { lonDeg: c.centre[0], latDeg: c.centre[1] } }, c.radiusM);
  const camera = sceneCameraAt(map, (c.pose.lonDeg * Math.PI) / 180, (c.pose.latDeg * Math.PI) / 180, c.pose.altitudeM);
  const frame = computeMorphFrame(map, domain, FAN_STEPS, camera);
  const corner = c.corner ?? (c.centre[0] === 0 && c.centre[1] === 0);
  const leaves = corner ? cornerLeavesOf(3, c.centre[0], c.centre[1]) : [interiorLeafOf(3, c.centre[0], c.centre[1])];
  const selected = poleFanLeavesOf(fakeSelector(leaves), domain, FAN_PATCH, 64, projectionBasis(c.centre[0], c.centre[1]));
  expect(selected.length).toBe(leaves.length);
  return { map, domain, frame, specs: buildPoleFanSpecs(poleFanContext(map, domain, FAN_PATCH), selected, rays) };
}

/** The frame's polar values and anchor in a number library. */
function polarInputs(lib: NumLib, frame: MorphFrame): { A: ReturnType<typeof liftAnchor>; F: FanFrameNodes<Num> } {
  const numbers = fanFrameNumbers(fanFrameWords(frame.values, new Float64Array(10)));
  const F = {} as Record<string, Num>;
  for (const key of Object.keys(numbers) as (keyof FanFrameNodes<number>)[]) F[key] = lib.num(numbers[key]);
  return { A: liftAnchor(lib, frame.values), F: F as unknown as FanFrameNodes<Num> };
}

/** The camera-relative body position of the point at basis longitude `lon` and latitude `lat`, `h` above the base sphere, by the definition. */
function referenceAt(frame: MorphFrame, lon: number, lat: number, h = 0): Vec3 {
  const map = frame.map;
  const [x, y] = morphMapXY(lon, lat, map);
  const bent = bendPoint(x, y, map.k, h).position;
  return mapVectorToBody(map.basis, [bent[0] - frame.camMap[0], bent[1] - frame.camMap[1], bent[2] - frame.camMap[2]]) as Vec3;
}

/** The lattice vector T of grid point (gx, gy) of a fan leaf, after the vertex stage's folding for the leaf's mask. */
function latticeT(leaf: PoleFanLeaf, gx: number, gy: number): Vec3 {
  const [fx, fy] = foldFanGrid(leaf.mask, FAN_PATCH, gx, gy);
  return cubeLattice(leaf.face, leaf.u0 + fx * leaf.step, leaf.v0 + fy * leaf.step, FAN_STEPS);
}

/**
 * The error of one end of a chord (grid vertex (gx, gy) of a fan leaf, placed near longitude `ref`, the exact pole taking `poleLon` where the
 * leaf has a pole corner): the vertex stage's lattice path against the definition, in metres and in pixels.
 */
function endError(lib: NumLib, s: Setup, lifted: LiftedFrame, leaf: PoleFanLeaf, gx: number, gy: number, ref: number, poleLon: number | undefined) {
  const t = latticeT(leaf, gx, gy);
  const isPole = s.frame.poles.some((p) => p !== undefined && p[0] === t[0] && p[1] === t[1] && p[2] === t[2]);
  const got = evaluateVertex(lib, s.frame, lifted, s.domain, t, 1, 0, ref, poleLon).rel;
  const want = exactRel(s.frame, s.domain, t, 1, 0, ref, isPole ? poleLon : undefined);
  const err = Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
  return { metres: err, pixels: (err / Math.max(0.01, Math.hypot(want[0], want[1], want[2]))) * FOCAL_PX };
}

/**
 * The largest error of the polar vertices (every `stride`-th one), in metres and pixels: P2 on the fan's double-float inputs against the
 * definition in doubles.
 */
function polarError(lib: NumLib, s: Setup, stride: number): { metres: number; pixels: number; count: number } {
  const { A, F } = polarInputs(lib, s.frame);
  const h = lib.num(0);
  let metres = 0;
  let pixels = 0;
  let count = 0;
  const data = s.specs.data;
  for (let v = 0; v < s.specs.vertexCount; v += stride) {
    const o = v * FAN_SPEC_STRIDE;
    if (data[o + FAN_COLUMN.KIND] !== 1) continue;
    const p = polarParamsOf(data[o + FAN_COLUMN.LON], data[o + FAN_COLUMN.C], data[o + FAN_COLUMN.SGN]);
    const params = {
      lonHi: lib.num(p.lonHi), lonLo: lib.num(p.lonLo), cHi: lib.num(p.cHi), cLo: lib.num(p.cLo), eHi: lib.num(p.eHi), eLo: lib.num(p.eLo), sgn: lib.num(p.sgn),
    } as FanPolarParams<Num>;
    const rel = fanPolarPosition(lib, A, F, params, h).rel;
    const lat = data[o + FAN_COLUMN.SGN] * (HALF_PI - data[o + FAN_COLUMN.C]);
    const want = referenceAt(s.frame, data[o + FAN_COLUMN.LON], lat);
    const err = Math.hypot(rel[0].v - want[0], rel[1].v - want[1], rel[2].v - want[2]);
    metres = Math.max(metres, err);
    pixels = Math.max(pixels, (err / Math.max(0.01, Math.hypot(want[0], want[1], want[2]))) * FOCAL_PX);
    count++;
  }
  return { metres, pixels, count };
}

/**
 * The rim: every boundary (ring 0) vertex of every patch, both chord ends through the lattice path. Returns the largest error in metres and
 * pixels and the number of ends checked.
 */
function rimError(lib: NumLib, s: Setup): { pixels: number; metres: number; count: number } {
  const lifted = liftFrame(lib, s.frame);
  const data = s.specs.data;
  let pixels = 0;
  let metres = 0;
  let count = 0;
  s.specs.layout.forEach(({ first, rays, rings }, patch) => {
    const leaf = s.specs.patches[patch].leaf;
    for (let j = 0; j < rays; j++) {
      const o = (first + j * rings) * FAN_SPEC_STRIDE;
      expect(data[o + FAN_COLUMN.KIND]).toBe(0);
      const poleLon = data[o + FAN_COLUMN.POLE_LON];
      const pole = Number.isNaN(poleLon) || leaf.pole.kind !== 'corner' ? undefined : poleLon;
      const ends: [number, number, number][] = [
        [data[o + FAN_COLUMN.GXA], data[o + FAN_COLUMN.GYA], data[o + FAN_COLUMN.REFA]],
        [data[o + FAN_COLUMN.GXB], data[o + FAN_COLUMN.GYB], data[o + FAN_COLUMN.REFB]],
      ];
      for (const [gx, gy, ref] of ends) {
        const e = endError(lib, s, lifted, leaf, gx, gy, ref, pole);
        pixels = Math.max(pixels, e.pixels);
        metres = Math.max(metres, e.metres);
        count++;
      }
    }
  });
  return { pixels, metres, count };
}

/**
 * The holes of a fan's triangulation. An edge used by one triangle only is open; an open edge must lie on the rim (ring 0), on the pole ring
 * (the last ring: the map's top or bottom edge), or on the first or last ray of its patch (a leaf's own meridian edge, or the map's two edges
 * for an interior pole). Any other open edge is a hole. Returns the holes and the open edges.
 */
function holesOf(specs: PoleFanSpecs): { holes: number; open: number } {
  const n = specs.vertexCount;
  const ray = new Int32Array(n).fill(-1);
  const ring = new Int32Array(n).fill(-1);
  const patch = new Int32Array(n).fill(-1);
  specs.layout.forEach(({ first, rays, rings }, p) => {
    for (let j = 0; j < rays; j++) {
      for (let r = 0; r < rings; r++) {
        const v = first + j * rings + r;
        ray[v] = j;
        ring[v] = r;
        patch[v] = p;
      }
    }
  });
  const uses = new Map<number, number>();
  const idx = specs.index;
  for (let t = 0; t < idx.length; t += 3) {
    for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      const key = Math.min(a, b) * n + Math.max(a, b);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let holes = 0;
  let open = 0;
  for (const [key, count] of uses) {
    if (count !== 1) continue;
    open++;
    const a = Math.floor(key / n);
    const b = key % n;
    const layout = specs.layout[patch[a]];
    const sameP = patch[a] === patch[b];
    const onRim = ring[a] === 0 && ring[b] === 0;
    const onPole = ring[a] === layout.rings - 1 && ring[b] === layout.rings - 1;
    const onFirst = sameP && ray[a] === 0 && ray[b] === 0;
    const onLast = sameP && ray[a] === layout.rays - 1 && ray[b] === layout.rays - 1;
    if (!(onRim || onPole || onFirst || onLast)) holes++;
  }
  return { holes, open };
}

const CASES: Case[] = [
  { name: 'corner pole, 6,371 km, morph 0.5, pole view at 200 m', radiusM: FAN_RADIUS, centre: [0, 0], morph: 0.5, pose: POLE_200M },
  { name: 'corner pole, 6,371 km, morph 1, pole view at 200 m', radiusM: FAN_RADIUS, centre: [0, 0], morph: 1, pose: POLE_200M },
  { name: 'interior pole, 6,371 km, morph 0.5, pole view at 200 m', radiusM: FAN_RADIUS, centre: [20, 35], morph: 0.5, pose: POLE_200M },
  { name: 'interior pole, 6,371 km, morph 1, pole view at 200 m', radiusM: FAN_RADIUS, centre: [20, 35], morph: 1, pose: POLE_200M },
  { name: 'corner pole, 600 km, morph 0.5, 2 m pole view', radiusM: 600_000, centre: [0, 0], morph: 0.5, pose: POLE_2M },
  { name: 'interior pole, 600 km, morph 1, 2 m pole view', radiusM: 600_000, centre: [20, 35], morph: 1, pose: POLE_2M },
  { name: 'equirectangular, corner pole, 6,371 km, morph 0.5, pole view at 200 m', radiusM: FAN_RADIUS, centre: [0, 0], morph: 0.5, pose: POLE_200M, projection: 'equirectangular' },
  { name: 'equirectangular, interior pole, 6,371 km, morph 1, 2 m pole view', radiusM: FAN_RADIUS, centre: [20, 35], morph: 1, pose: POLE_2M, projection: 'equirectangular' },
];

/** A leaf that straddles the cut: the projection centre at longitude 45 degrees puts a pole leaf over the map's edge. */
const STRADDLE: Case = { name: 'straddling leaf, centre 45 degrees, morph 0.5', radiusM: FAN_RADIUS, centre: [45, 0], morph: 0.5, pose: POLE_200M, corner: true };

describe('lod-morph-fan-vertex: double-floats and the per-frame values', () => {
  it('splits a double into a float32 high part and a float32 remainder that sum back to it', () => {
    for (const x of [0, 1, -1, Math.PI, HALF_PI - 1e-9, 6_371_000.123456789, 1e-7 * Math.E, 123.456]) {
      const [hi, lo] = splitDouble(x);
      expect(hi).toBe(Math.fround(hi));
      expect(lo).toBe(Math.fround(lo));
      expect(Math.abs(hi + lo - x)).toBeLessThanOrEqual(Math.abs(x) * 2 ** -46 + 1e-300);
    }
  });

  it('takes the anchor\'s one-minus-sine values and colatitudes from the frame, and writes into the array it is given', () => {
    const s = setup(CASES[0]);
    const out = new Float64Array(10);
    const words = fanFrameWords(s.frame.values, out);
    expect(words).toBe(out);
    expect(words[0]).toBe(Math.fround(s.frame.values.omsA));
    expect(words[1]).toBe(Math.fround(s.frame.values.opsA));
    // The double-float pairs sum back to the colatitudes from each pole, which add to pi.
    expect(words[4] + words[6]).toBeCloseTo(Math.atan2(s.frame.values.cA, s.frame.values.sA), 14);
    expect(words[4] + words[6] + words[5] + words[7]).toBeCloseTo(Math.PI, 12);
    expect(words[8] + words[9]).toBeCloseTo(s.frame.values.lamA, 14);
  });

  it('writes e = 1 - cos(c) without the cancellation', () => {
    expect(colatitudeE(0)).toBe(0);
    expect(colatitudeE(1e-8)).toBeCloseTo(0.5e-16, 24);
    expect(colatitudeE(HALF_PI)).toBeCloseTo(1, 15);
  });
});

describe('lod-morph-fan-vertex: the polar vertex through P2 (the CPU twin of the vertex stage)', () => {
  for (const c of CASES) {
    it(`matches the definition in doubles: ${c.name}`, () => {
      const got = polarError(DOUBLE_LIB, setup(c), 5);
      expect(got.count).toBeGreaterThan(500);
      expect(got.metres).toBeLessThan(2e-3);
    });

    it(`stays under a pixel in float32 arithmetic: ${c.name}`, () => {
      const got = polarError(FLOAT32_LIB, setup(c), 5);
      expect(got.count).toBeGreaterThan(500);
      expect(got.pixels).toBeLessThan(1);
    });
  }

  it('keeps centimetres 2 m from the anchor next to the pole, where the anchor\'s latitude alone would not', () => {
    const f32 = polarError(FLOAT32_LIB, setup({ ...CASES[0], morph: 1, pose: POLE_2M }, 4096), 3);
    expect(f32.pixels).toBeLessThan(0.5);
    expect(Number.isFinite(f32.metres)).toBeTrue();
  });
});

describe('lod-morph-fan-vertex: the rim, the chord\'s lattice path and the holes', () => {
  for (const c of CASES) {
    it(`the rim is within a pixel in float32 arithmetic, and the triangulation has no hole: ${c.name}`, () => {
      const s = setup(c);
      const rim = rimError(FLOAT32_LIB, s);
      expect(rim.count).toBe(2 * s.specs.layout.reduce((a, l) => a + l.rays, 0));
      expect(rim.pixels).toBeLessThan(1);
      const holes = holesOf(s.specs);
      expect(holes.holes).toBe(0);
      expect(holes.open).toBeGreaterThan(0);
    });
  }

  it('the rim matches the definition in doubles to a millimetre', () => {
    const rim = rimError(DOUBLE_LIB, setup(CASES[1]));
    expect(rim.metres).toBeLessThan(1e-3);
  });

  it('a fan with a copy across the cut has no hole, and its rim is within a pixel (the copy is its own patch)', () => {
    const s = setup(STRADDLE, 256);
    expect(s.specs.copies).toBe(1);
    expect(holesOf(s.specs).holes).toBe(0);
    expect(rimError(FLOAT32_LIB, s).pixels).toBeLessThan(1);
  });

  it('the copy across the cut sweeps past the map edge on the side its shift says (the part past the edge is the outline clip\'s)', () => {
    const s = setup(STRADDLE, 256);
    const shifted = s.specs.patches.findIndex((p) => p.shift !== 0);
    const { first, rays, rings } = s.specs.layout[shifted];
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < rays; j++) {
      const o = (first + j * rings + rings - 1) * FAN_SPEC_STRIDE;
      if (s.specs.data[o + FAN_COLUMN.KIND] !== 1) continue;
      lo = Math.min(lo, s.specs.data[o + FAN_COLUMN.LON]);
      hi = Math.max(hi, s.specs.data[o + FAN_COLUMN.LON]);
    }
    if (s.specs.patches[shifted].shift < 0) expect(lo).toBeLessThan(-Math.PI);
    else expect(hi).toBeGreaterThan(Math.PI);
    expect(hi - lo).toBeLessThan(TWO_PI);
  });
});

describe('lod-morph-fan-vertex: what the descriptions depend on, and what they pack', () => {
  it('builds the same descriptions at every morph: the morph never reaches them', () => {
    const a = setup({ ...CASES[2], morph: 0.2 });
    const b = setup({ ...CASES[2], morph: 1 });
    expect(Array.from(a.specs.data)).toEqual(Array.from(b.specs.data));
    expect(Array.from(a.specs.index)).toEqual(Array.from(b.specs.index));
  });

  it('packs six vec4 per vertex, the leaf\'s lattice origin, step, face and mask, and the triangles', () => {
    const s = setup(CASES[0]);
    const data = packPoleFanVertices(s.specs);
    const n = s.specs.vertexCount;
    expect(data.vertexCount).toBe(n);
    for (const array of [data.leaf, data.grid, data.ref, data.polar1, data.polar2, data.misc]) expect(array.length).toBe(n * 4);
    expect(FAN_ATTRIBUTES.length).toBe(6);
    expect(data.index).toBe(s.specs.index);
    const leaf = s.specs.patches[s.specs.data[FAN_COLUMN.PATCH]].leaf;
    expect(data.leaf[2]).toBe(leaf.step);
    expect(data.leaf[3]).toBe(leaf.face);
  });

  it('marks polar vertices with kind 1 and their double-floats, chord vertices with kind 0 and their grid ends', () => {
    const s = setup(CASES[0]);
    const data = packPoleFanVertices(s.specs);
    let polar = 0;
    let chord = 0;
    for (let v = 0; v < data.vertexCount; v++) {
      const o = v * FAN_SPEC_STRIDE;
      const q = v * 4;
      if (s.specs.data[o + FAN_COLUMN.KIND] === 1) {
        polar++;
        expect(data.polar2[q + 3]).toBe(1);
        expect(data.polar1[q] + data.polar1[q + 1]).toBeCloseTo(s.specs.data[o + FAN_COLUMN.LON], 13);
        expect(data.polar1[q + 2] + data.polar1[q + 3]).toBeCloseTo(s.specs.data[o + FAN_COLUMN.C], 13);
        expect(data.polar2[q + 2]).toBe(s.specs.data[o + FAN_COLUMN.SGN]);
      } else {
        chord++;
        expect(data.polar2[q + 3]).toBe(0);
        expect(data.grid[q + 2]).toBe(s.specs.data[o + FAN_COLUMN.GXB]);
        expect(data.grid[q + 3]).toBe(s.specs.data[o + FAN_COLUMN.GYB]);
        expect(data.ref[q + 2]).toBeLessThan(1);
      }
    }
    expect(polar).toBeGreaterThan(chord);
    expect(chord).toBeGreaterThan(0);
  });

  it('stores a chord that reaches its far end as that end with share 0, so a grid vertex is the lattice stage\'s output exactly', () => {
    const s = setup(CASES[0]);
    const data = packPoleFanVertices(s.specs);
    let seen = 0;
    for (let v = 0; v < data.vertexCount; v++) {
      const o = v * FAN_SPEC_STRIDE;
      if (s.specs.data[o + FAN_COLUMN.KIND] !== 0 || s.specs.data[o + FAN_COLUMN.W] < 1) continue;
      seen++;
      const q = v * 4;
      expect(data.ref[q + 2]).toBe(0);
      expect(data.grid[q]).toBe(s.specs.data[o + FAN_COLUMN.GXB]);
      expect(data.grid[q + 1]).toBe(s.specs.data[o + FAN_COLUMN.GYB]);
      expect(data.ref[q]).toBe(Math.fround(s.specs.data[o + FAN_COLUMN.REFB]));
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('gives a corner leaf its edges\' corner indices (misc.y, misc.z >= 0) and an interior pole -1', () => {
    const corner = packPoleFanVertices(setup(CASES[0]).specs);
    let withCorner = 0;
    for (let v = 0; v < corner.vertexCount; v++) if (corner.misc[v * 4 + 1] >= 0) withCorner++;
    expect(withCorner).toBeGreaterThan(0);
    const tilted = packPoleFanVertices(setup(CASES[2]).specs);
    for (let v = 0; v < tilted.vertexCount; v++) {
      expect(tilted.misc[v * 4 + 1]).toBe(-1);
      expect(tilted.misc[v * 4 + 2]).toBe(-1);
    }
    expect(tilted.leaf[2]).toBeGreaterThan(0);
  });

  it('writes the pole longitude as 0 where the chord has none (NaN) and as the meridian edge\'s where it has one', () => {
    const s = setup(CASES[0]);
    const data = packPoleFanVertices(s.specs);
    let none = 0;
    let given = 0;
    for (let v = 0; v < data.vertexCount; v++) {
      const o = v * FAN_SPEC_STRIDE;
      if (s.specs.data[o + FAN_COLUMN.KIND] !== 0) continue;
      const lon = s.specs.data[o + FAN_COLUMN.POLE_LON];
      if (Number.isNaN(lon)) {
        none++;
        expect(data.ref[v * 4 + 3]).toBe(0);
        expect(data.misc[v * 4 + 1]).toBe(-1);
        expect(data.misc[v * 4 + 2]).toBe(-1);
      } else {
        given++;
        expect(data.ref[v * 4 + 3]).toBe(Math.fround(lon));
      }
    }
    expect(none + given).toBeGreaterThan(0);
  });
});
