import { computeMorphFrame, type MorphFrame } from './morph-frame';
import { FAN_SPEC_STRIDE, SPEC, buildFanSpecs, fanContext, fanLeafSignature, fanLeavesOf, placeFanSpecs, type FanSpecs } from './morph-fan';
import {
  FAN_ATTRIBUTES, colatitudeE, fanFrameUniforms, fanFrameValues, fanPolarPosition, packVertexFan, polarParamsOf, splitDouble, type FanFrameNodes, type FanPolarParams,
} from './morph-fan-vertex';
import { DOUBLE_LIB, FLOAT32_LIB, liftAnchor, type Num } from './morph-math';
import {
  FAN_PATCH, FAN_RADIUS, FAN_STEPS, cornerLeavesOf, fakeSelector, fanDomain, fanView, interiorLeafOf,
} from './morph-fan.fixtures';

const FOCAL_PX = 1080 / (2 * Math.tan(Math.PI / 6));

type Lib = typeof DOUBLE_LIB;

/** The per-frame fan values as the library's numbers. */
function frameNodes(lib: Lib, frame: MorphFrame): FanFrameNodes<Num> {
  const u = fanFrameUniforms(fanFrameValues(frame));
  return {
    psHiP: lib.num(u.ps[0]), psHiM: lib.num(u.ps[1]), psLoP: lib.num(u.ps[2]), psLoM: lib.num(u.ps[3]),
    colHiP: lib.num(u.colat[0]), colHiM: lib.num(u.colat[1]), colLoP: lib.num(u.colat[2]), colLoM: lib.num(u.colat[3]),
    lamHi: lib.num(u.lam[0]), lamLo: lib.num(u.lam[1]),
  };
}

function lifted(lib: Lib, p: FanPolarParams<number>): FanPolarParams<Num> {
  return {
    lonHi: lib.num(p.lonHi), lonLo: lib.num(p.lonLo), cHi: lib.num(p.cHi), cLo: lib.num(p.cLo), eHi: lib.num(p.eHi), eLo: lib.num(p.eLo), sgn: lib.num(p.sgn),
  };
}

interface Setup {
  readonly frame: MorphFrame;
  readonly specs: FanSpecs;
  readonly reference: Float64Array;
}

function setup(radiusM: number, centre: [number, number], morph: number, pose: 'pole-200m' | 'pole-2m', rays = 256): Setup {
  const domain = fanDomain(radiusM);
  const frame = computeMorphFrame(fanView(radiusM, centre[0], centre[1], morph, pose), domain, FAN_STEPS);
  const leaves = centre[0] === 0 && centre[1] === 0 ? cornerLeavesOf(3) : [interiorLeafOf(3, centre[0], centre[1])];
  const fanLeaves = fanLeavesOf(fakeSelector(leaves), domain, FAN_PATCH, 64, frame.basis);
  const ctx = fanContext(domain, FAN_PATCH, frame.basis, radiusM, morph);
  const specs = buildFanSpecs(ctx, fanLeaves, rays);
  return { frame, specs, reference: placeFanSpecs(ctx, specs, 0) };
}

/** Evaluates every `stride`-th polar vertex through `fanPolarPosition` and returns the largest error in metres and in pixels against the reference. */
function polarError(lib: Lib, s: Setup, stride: number): { metres: number; pixels: number; count: number } {
  const A = liftAnchor(lib, s.frame.values);
  const F = frameNodes(lib, s.frame);
  const h = lib.num(0);
  let metres = 0;
  let pixels = 0;
  let count = 0;
  for (let v = 0; v < s.specs.vertexCount; v += stride) {
    const o = v * FAN_SPEC_STRIDE;
    if (s.specs.data[o + SPEC.KIND] !== 1) continue;
    const params = lifted(lib, polarParamsOf(s.specs.data[o + SPEC.LON], s.specs.data[o + SPEC.C], s.specs.data[o + SPEC.SGN]));
    const rel = fanPolarPosition(lib, A, F, params, h).rel;
    const rx = s.reference[v * 3] - s.frame.camBody[0];
    const ry = s.reference[v * 3 + 1] - s.frame.camBody[1];
    const rz = s.reference[v * 3 + 2] - s.frame.camBody[2];
    const err = Math.hypot(rel[0].v - rx, rel[1].v - ry, rel[2].v - rz);
    metres = Math.max(metres, err);
    pixels = Math.max(pixels, (err / Math.max(0.01, Math.hypot(rx, ry, rz))) * FOCAL_PX);
    count++;
  }
  return { metres, pixels, count };
}

describe('morph-fan-vertex: double-floats and the per-frame values', () => {
  it('splits a double into a float32 high part and a float32 remainder that sum back to it', () => {
    for (const x of [0, 1, -1, Math.PI, 1.5707963267948966 - 1e-9, 6_371_000.123456789, 1e-7 * Math.E, 123.456]) {
      const [hi, lo] = splitDouble(x);
      expect(hi).toBe(Math.fround(hi));
      expect(lo).toBe(Math.fround(lo));
      expect(Math.abs(hi + lo - x)).toBeLessThanOrEqual(Math.abs(x) * 2 ** -46 + 1e-300);
    }
  });

  it('takes the anchor\'s colatitudes and one-minus-sine values from the frame, not from a rounded latitude', () => {
    const frame = computeMorphFrame(fanView(FAN_RADIUS, 0, 0, 0.5, 'pole-2m'), fanDomain(FAN_RADIUS), FAN_STEPS);
    const v = fanFrameValues(frame);
    expect(v.ps[0]).toBe(frame.values.omsA);
    expect(v.ps[1]).toBe(frame.values.opsA);
    expect(v.colat[0]).toBeCloseTo(Math.PI / 2 - Math.atan2(frame.values.sA, frame.values.cA), 12);
    expect(v.colat[0] + v.colat[1]).toBeCloseTo(Math.PI, 12);
    expect(v.lamA).toBe(frame.values.lamA);
    const u = fanFrameUniforms(v);
    expect(u.ps[0]).toBe(Math.fround(v.ps[0]));
    expect(u.ps[2]).toBe(Math.fround(v.ps[0] - u.ps[0]));
    expect(u.lam[0] + u.lam[1]).toBeCloseTo(v.lamA, 14);
  });

  it('writes e = 1 - cos(c) without the cancellation', () => {
    expect(colatitudeE(0)).toBe(0);
    expect(colatitudeE(1e-8)).toBeCloseTo(0.5e-16, 24);
    expect(colatitudeE(Math.PI / 2)).toBeCloseTo(1, 15);
  });
});

describe('morph-fan-vertex: the polar vertex through P2 (the CPU twin of the vertex stage)', () => {
  const cases: { name: string; radiusM: number; centre: [number, number]; morph: number; pose: 'pole-200m' | 'pole-2m' }[] = [
    { name: 'corner pole, 6,371 km, morph 0.5, pole view at 200 m', radiusM: FAN_RADIUS, centre: [0, 0], morph: 0.5, pose: 'pole-200m' },
    { name: 'corner pole, 6,371 km, morph 1, pole view at 200 m', radiusM: FAN_RADIUS, centre: [0, 0], morph: 1, pose: 'pole-200m' },
    { name: 'interior pole, 6,371 km, morph 0.5, pole view at 200 m', radiusM: FAN_RADIUS, centre: [20, 35], morph: 0.5, pose: 'pole-200m' },
    { name: 'interior pole, 6,371 km, morph 1, pole view at 200 m', radiusM: FAN_RADIUS, centre: [20, 35], morph: 1, pose: 'pole-200m' },
    { name: 'corner pole, 600 km, morph 0.5, 2 m pole preset', radiusM: 600_000, centre: [0, 0], morph: 0.5, pose: 'pole-2m' },
    { name: 'interior pole, 600 km, morph 1, 2 m pole preset', radiusM: 600_000, centre: [20, 35], morph: 1, pose: 'pole-2m' },
  ];

  for (const c of cases) {
    it(`matches the double placement in doubles: ${c.name}`, () => {
      const s = setup(c.radiusM, c.centre, c.morph, c.pose);
      const got = polarError(DOUBLE_LIB, s, 5);
      expect(got.count).toBeGreaterThan(500);
      expect(got.metres).toBeLessThan(2e-3);
    });

    it(`stays under a pixel in float32 arithmetic: ${c.name}`, () => {
      const s = setup(c.radiusM, c.centre, c.morph, c.pose);
      const got = polarError(FLOAT32_LIB, s, 5);
      expect(got.count).toBeGreaterThan(500);
      expect(got.pixels).toBeLessThan(1);
    });
  }

  it('keeps centimetres 2 m from the anchor next to the pole where a naive latitude would not', () => {
    const s = setup(FAN_RADIUS, [0, 0], 1, 'pole-2m', 4096);
    const f32 = polarError(FLOAT32_LIB, s, 3);
    // The camera is 2 m up and 55 km from the pole: the polar vertices near it are far in metres, the error stays a small share of the distance.
    expect(f32.pixels).toBeLessThan(0.5);
    expect(Number.isFinite(f32.metres)).toBeTrue();
  });
});

describe('morph-fan-vertex: what the descriptions depend on', () => {
  it('builds the same descriptions at every morph and height: the camera and the morph never reach them', () => {
    const domain = fanDomain(FAN_RADIUS);
    const frame = computeMorphFrame(fanView(FAN_RADIUS, 20, 35, 0.5), domain, FAN_STEPS);
    const leaves = fanLeavesOf(fakeSelector([interiorLeafOf(3, 20, 35)]), domain, FAN_PATCH, 64, frame.basis);
    const a = buildFanSpecs(fanContext(domain, FAN_PATCH, frame.basis, FAN_RADIUS, 0.2), leaves, 256);
    const b = buildFanSpecs(fanContext(domain, FAN_PATCH, frame.basis, FAN_RADIUS, 1), leaves, 256);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(a.index)).toEqual(Array.from(b.index));
  });

  it('has the same leaf signature for the same leaves wherever the camera is, and another one when a mask or a leaf changes', () => {
    const domain = fanDomain(FAN_RADIUS);
    const near = computeMorphFrame(fanView(FAN_RADIUS, 0, 0, 0.5, 'pole-200m'), domain, FAN_STEPS);
    const far = computeMorphFrame(fanView(FAN_RADIUS, 0, 0, 1, 'pole-2m'), domain, FAN_STEPS);
    const leavesAt = (frame: MorphFrame, level: number, mask: number) => fanLeavesOf(fakeSelector(cornerLeavesOf(level).map((l) => ({ ...l, mask }))), domain, FAN_PATCH, 64, frame.basis);
    expect(fanLeafSignature(leavesAt(near, 3, 0))).toBe(fanLeafSignature(leavesAt(far, 3, 0)));
    expect(fanLeafSignature(leavesAt(near, 3, 0))).not.toBe(fanLeafSignature(leavesAt(near, 3, 1)));
    expect(fanLeafSignature(leavesAt(near, 3, 0))).not.toBe(fanLeafSignature(leavesAt(near, 4, 0)));
  });
});

describe('morph-fan-vertex: the packed attributes', () => {
  const s = setup(FAN_RADIUS, [0, 0], 0.5, 'pole-200m');
  const data = packVertexFan(s.specs);

  it('holds six vec4 per vertex and the fan\'s triangles', () => {
    const n = s.specs.vertexCount;
    expect(data.vertexCount).toBe(n);
    for (const array of [data.leaf, data.grid, data.ref, data.polar1, data.polar2, data.misc]) expect(array.length).toBe(n * 4);
    expect(FAN_ATTRIBUTES.length).toBe(6);
    expect(data.index).toBe(s.specs.index);
  });

  it('marks polar vertices with kind 1 and their double-floats, chord vertices with kind 0 and their grid ends', () => {
    let polar = 0;
    let chord = 0;
    for (let v = 0; v < data.vertexCount; v++) {
      const o = v * FAN_SPEC_STRIDE;
      const q = v * 4;
      if (s.specs.data[o + SPEC.KIND] === 1) {
        polar++;
        expect(data.polar2[q + 3]).toBe(1);
        expect(data.polar1[q] + data.polar1[q + 1]).toBeCloseTo(s.specs.data[o + SPEC.LON], 13);
        expect(data.polar1[q + 2] + data.polar1[q + 3]).toBeCloseTo(s.specs.data[o + SPEC.C], 13);
        expect(data.polar2[q + 2]).toBe(s.specs.data[o + SPEC.SGN]);
      } else {
        chord++;
        expect(data.polar2[q + 3]).toBe(0);
        expect(data.grid[q + 2]).toBe(s.specs.data[o + SPEC.GXB]);
        expect(data.grid[q + 3]).toBe(s.specs.data[o + SPEC.GYB]);
        expect(data.ref[q + 2]).toBeLessThan(1);
      }
    }
    expect(polar).toBeGreaterThan(chord);
    expect(chord).toBeGreaterThan(0);
  });

  it('stores a chord that reaches its far end as that end with share 0, so a grid vertex is the lattice stage\'s output exactly', () => {
    let seen = 0;
    for (let v = 0; v < data.vertexCount; v++) {
      const o = v * FAN_SPEC_STRIDE;
      if (s.specs.data[o + SPEC.KIND] !== 0 || s.specs.data[o + SPEC.W] < 1) continue;
      seen++;
      const q = v * 4;
      expect(data.ref[q + 2]).toBe(0);
      expect(data.grid[q]).toBe(s.specs.data[o + SPEC.GXB]);
      expect(data.grid[q + 1]).toBe(s.specs.data[o + SPEC.GYB]);
      expect(data.ref[q]).toBe(Math.fround(s.specs.data[o + SPEC.REFB]));
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('gives the leaf\'s lattice origin, step and face, its edge mask and its pole corner (-1: strictly inside)', () => {
    const corner = packVertexFan(setup(FAN_RADIUS, [0, 0], 0.5, 'pole-200m').specs);
    expect(corner.misc[1]).toBeGreaterThanOrEqual(0);
    const tilted = packVertexFan(setup(FAN_RADIUS, [20, 35], 0.5, 'pole-200m').specs);
    expect(tilted.misc[1]).toBe(-1);
    expect(tilted.misc[2]).toBe(-1);
    expect(tilted.leaf[2]).toBeGreaterThan(0);
  });

  it('writes the pole longitude as 0 where the chord has none (NaN) and as the meridian edge\'s where it has one', () => {
    let none = 0;
    let given = 0;
    for (let v = 0; v < data.vertexCount; v++) {
      const o = v * FAN_SPEC_STRIDE;
      if (s.specs.data[o + SPEC.KIND] !== 0) continue;
      const lon = s.specs.data[o + SPEC.POLE_LON];
      if (Number.isNaN(lon)) {
        none++;
        expect(data.ref[v * 4 + 3]).toBe(0);
      } else {
        given++;
        expect(data.ref[v * 4 + 3]).toBe(Math.fround(lon));
      }
    }
    expect(none + given).toBeGreaterThan(0);
  });
});
