import type { LodDomain, Vec3 } from './lod-domain';
import { createHeightSource, bumpsFor } from './lod-height';
import { latticeOfPosition } from './lod-height-bake';
import { runBake } from './lod-height-noise';
import { createTextureHeightSource } from './lod-height-texture';
import { createGroundSample, defaultGroundStepM, groundAt } from './lod-ground-query';
import { detailBoundM } from './lod-detail-noise';
import { LodTerrainBody } from './lod-terrain-body';

const sphere: LodDomain = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' };
const plane: LodDomain = { kind: 'plane', sizeM: 20_000, warp: 'equal-angle' };

const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scaled = (dir: Vec3, distance: number): Vec3 => {
  const n = length(dir);
  return [(dir[0] / n) * distance, (dir[1] / n) * distance, (dir[2] / n) * distance];
};

/** Directions on cube faces, edges, corners and the poles. */
const DIRECTIONS: Vec3[] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, -1], [1, 1, 1], [-1, 1, -1], [0, 1, 1], [1, 1, 0], [1e-9, 1, 0], [0.0004, 0.99999, 0.0002], [0.3, -0.8, 0.5]];

/** Analytic gradient of the bumps source at a base-surface position (3D, as the vertex stage's gradient node). */
function bumpsGradient(kind: 'plane' | 'sphere', p: Vec3): Vec3 {
  const g: Vec3 = [0, 0, 0];
  for (const { axis, wavelengthM, amplitudeM, phase } of bumpsFor(kind)) {
    const k = (2 * Math.PI) / wavelengthM;
    const c = amplitudeM * k * Math.cos(k * dot(axis, p) + phase);
    for (let i = 0; i < 3; i++) g[i] += c * axis[i];
  }
  return g;
}

describe('groundAt', () => {
  it('stands a point on flat ground: height 0, normal = up, altitude signed', () => {
    const flat = createHeightSource('flat', 'sphere');
    const above = groundAt(flat, sphere, scaled([1, 2, 3], 10_002));
    expect(above.heightM).toBe(0);
    expect(above.altitudeM).toBeCloseTo(2, 9);
    expect(length(above.point)).toBeCloseTo(10_000, 8);
    for (let i = 0; i < 3; i++) expect(above.normal[i]).toBeCloseTo(above.up[i], 12);
    expect(groundAt(flat, sphere, scaled([1, 2, 3], 9_997)).altitudeM).toBeCloseTo(-3, 9);

    const flatPlane = createHeightSource('flat', 'plane');
    const onPlane = groundAt(flatPlane, plane, [120, 5, -40]);
    expect(onPlane.point).toEqual([120, 0, -40]);
    expect(onPlane.altitudeM).toBe(5);
    expect(onPlane.up).toEqual([0, 1, 0]);
    expect(onPlane.normal.map(Math.abs)).toEqual([0, 1, 0]);
    expect(groundAt(flatPlane, plane, [120, -7, -40]).altitudeM).toBe(-7);
  });

  it('returns heightAt of the base point, with the ground point on the surface', () => {
    const bumps = createHeightSource('bumps', 'sphere');
    for (const dir of DIRECTIONS) {
      const sample = groundAt(bumps, sphere, scaled(dir, 10_030), undefined, 0.05);
      const base = scaled(dir, 10_000);
      expect(sample.heightM).toBeCloseTo(bumps.heightAt(base[0], base[1], base[2]), 8);
      expect(length(sample.point)).toBeCloseTo(10_000 + sample.heightM, 8);
      expect(groundAt(bumps, sphere, sample.point, undefined, 0.05).altitudeM).toBeCloseTo(0, 8);
      expect(sample.altitudeM).toBeCloseTo(30 - sample.heightM, 8);
    }
    const bumpsPlane = createHeightSource('bumps', 'plane');
    const sample = groundAt(bumpsPlane, plane, [731, 50, -2_912], undefined, 0.05);
    expect(sample.heightM).toBe(bumpsPlane.heightAt(731, 0, -2_912));
    expect(sample.point).toEqual([731, sample.heightM, -2_912]);
    expect(sample.altitudeM).toBeCloseTo(50 - sample.heightM, 12);
  });

  it('matches the analytic gradient of the bumps source on the sphere', () => {
    const bumps = createHeightSource('bumps', 'sphere');
    for (const dir of DIRECTIONS) {
      const sample = groundAt(bumps, sphere, scaled(dir, 10_001), undefined, 0.05);
      expect(length(sample.normal)).toBeCloseTo(1, 12);
      // The 3D gradient's tangential part, over the radial stretch k = 1 + h / R: n is proportional to up - Gt / k.
      const g = bumpsGradient('sphere', scaled(dir, 10_000));
      const gu = dot(g, sample.up);
      const k = 1 + sample.heightM / 10_000;
      const expected: Vec3 = [0, 1, 2].map((i) => sample.up[i] - (g[i] - gu * sample.up[i]) / k) as Vec3;
      const n = length(expected);
      for (let i = 0; i < 3; i++) expect(sample.normal[i]).toBeCloseTo(expected[i] / n, 4);
    }
  });

  it('matches the analytic gradient on the plane, and ignores a gradient it cannot step across at the edge', () => {
    const bumps = createHeightSource('bumps', 'plane');
    for (const [x, z] of [[0, 0], [731, -2_912], [-5_000, 9_000]]) {
      const sample = groundAt(bumps, plane, [x, 3, z], undefined, 0.05);
      const g = bumpsGradient('plane', [x, 0, z]);
      const n = Math.hypot(g[0], g[2], 1);
      expect(sample.normal[0]).toBeCloseTo(-g[0] / n, 4);
      expect(sample.normal[1]).toBeCloseTo(1 / n, 4);
      expect(sample.normal[2]).toBeCloseTo(-g[2] / n, 4);
    }
    // At the corner the step is one-sided but still finite and unit length.
    const corner = groundAt(bumps, plane, [10_000, 0, -10_000], undefined, 0.05);
    expect(corner.normal.every(Number.isFinite)).toBeTrue();
    expect(length(corner.normal)).toBeCloseTo(1, 12);
  });

  it('clamps a query outside the plane to the nearest edge point', () => {
    const bumps = createHeightSource('bumps', 'plane');
    const outside = groundAt(bumps, plane, [15_000, 4, -90_000]);
    expect(outside.point[0]).toBe(10_000);
    expect(outside.point[2]).toBe(-10_000);
    expect(outside.heightM).toBe(bumps.heightAt(10_000, 0, -10_000));
    expect(outside.altitudeM).toBeCloseTo(4 - outside.heightM, 12);
  });

  it('gives a finite unit normal pointing out at the poles, cube edges, corners and the centre', () => {
    const bumps = createHeightSource('bumps', 'sphere');
    const baked = createTextureHeightSource('noise', runBake('noise', { kind: 'sphere', warp: 'equal-angle', sizeM: 10_000, k: 4 }).baked);
    for (const source of [bumps, baked]) {
      for (const dir of DIRECTIONS) {
        const sample = groundAt(source, sphere, scaled(dir, 10_000.5));
        for (const v of [sample.normal, sample.up, sample.point]) expect(v.every(Number.isFinite)).toBeTrue();
        expect(Number.isFinite(sample.heightM) && Number.isFinite(sample.altitudeM)).toBeTrue();
        expect(length(sample.normal)).toBeCloseTo(1, 12);
        expect(dot(sample.normal, sample.up)).toBeGreaterThan(0.5);
      }
      const centre = groundAt(source, sphere, [0, 0, 0]);
      expect(centre.up).toEqual([0, 1, 0]);
      expect(centre.normal.every(Number.isFinite)).toBeTrue();
      expect(centre.altitudeM).toBeCloseTo(-(10_000 + centre.heightM), 9);
    }
    baked.dispose();
  });

  it('does not flip or jump across a cube-face edge', () => {
    const bumps = createHeightSource('bumps', 'sphere');
    const a = groundAt(bumps, sphere, scaled([1, 0.3, 1 - 1e-6], 10_000), undefined, 0.5);
    const b = groundAt(bumps, sphere, scaled([1, 0.3, 1 + 1e-6], 10_000), undefined, 0.5);
    expect(dot(a.normal, b.normal)).toBeGreaterThan(0.999999);
    expect(Math.abs(a.heightM - b.heightM)).toBeLessThan(1e-3);
  });

  it('reuses `out` and writes nothing else', () => {
    const bumps = createHeightSource('bumps', 'sphere');
    const out = createGroundSample();
    const point = out.point;
    const normal = out.normal;
    const first = groundAt(bumps, sphere, scaled([1, 1, 1], 10_010), out);
    expect(first).toBe(out);
    expect(out.point).toBe(point);
    expect(out.normal).toBe(normal);
    const heightA = out.heightM;
    groundAt(bumps, sphere, scaled([0, 1, 1], 10_010), out);
    expect(out.heightM).not.toBe(heightA);
    expect(groundAt(createHeightSource('bumps', 'plane'), plane, [1, 2, 3], out)).toBe(out);
  });

  it('reads the baked texels: heightM equals the lattice height at the base point', () => {
    const layout = { kind: 'sphere', warp: 'equal-angle', sizeM: 10_000, k: 4 } as const;
    const baked = createTextureHeightSource('noise', runBake('noise', layout).baked);
    const place = { face: 0, u: 0, v: 0 };
    for (const dir of DIRECTIONS) {
      const base = scaled(dir, 10_000);
      latticeOfPosition(layout, base[0], base[1], base[2], place);
      const sample = groundAt(baked, sphere, scaled(dir, 10_040));
      expect(sample.heightM).toBeCloseTo(baked.heightAtLattice(place.face, place.u, place.v), 5);
    }
    baked.dispose();
  });

  it('has a default step of half a texel of the default bake', () => {
    expect(defaultGroundStepM(sphere)).toBeCloseTo((Math.PI / 2 * 10_000) / 1024 / 2, 9);
    expect(defaultGroundStepM(plane)).toBeCloseTo(20_000 / 1024 / 2, 9);
  });
});

describe('LodTerrainBody.groundAt', () => {
  const settings = (over = {}) => ({
    domain: sphere, heights: createHeightSource('bumps', 'sphere'), detailNoise: 0.04, leafCap: 256, cellPixels: 4, patchCells: 16 as const, hysteresis: 0.15, cull: true, ...over,
  });

  it('includes the detail noise, within its bound', () => {
    const body = new LodTerrainBody(settings());
    const bound = detailBoundM({ domain: sphere, cells: 1024, share: 0.04 });
    expect(bound).toBeGreaterThan(0);
    let differs = 0;
    for (const dir of DIRECTIONS) {
      const position = scaled(dir, 10_020);
      const sample = body.groundAt(position);
      const raw = body.settings.heights.heightAt(...scaled(dir, 10_000));
      expect(Math.abs(sample.heightM - raw)).toBeLessThanOrEqual(bound + 1e-9);
      if (Math.abs(sample.heightM - raw) > 1e-6) differs++;
      expect(length(sample.normal)).toBeCloseTo(1, 12);
    }
    expect(differs).toBeGreaterThan(DIRECTIONS.length / 2);

    const off = new LodTerrainBody(settings({ detailNoise: 0 }));
    const position = scaled([1, 2, 3], 10_020);
    expect(off.groundAt(position).heightM).toBeCloseTo(off.settings.heights.heightAt(...scaled([1, 2, 3], 10_000)), 8);
    expect(body.groundAt(position, createGroundSample()).heightM).not.toBe(off.groundAt(position).heightM);
    body.dispose();
    off.dispose();
  });

  it('works on a plane body', () => {
    const body = new LodTerrainBody(settings({ domain: plane, heights: createHeightSource('flat', 'plane'), detailNoise: 0 }));
    const sample = body.groundAt([5, 2, 5]);
    expect(sample.altitudeM).toBe(2);
    expect(sample.normal.map(Math.abs)).toEqual([0, 1, 0]);
    body.dispose();
  });
});
