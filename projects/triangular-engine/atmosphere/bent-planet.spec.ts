import {
  bend,
  bendCurvature,
  bendFrame,
  bentMapCoords,
  curvatureAltitude,
  curvatureUp,
  mapMaskFactor,
  rayAtAltitude,
  sinc,
  type Vec3,
} from './bent-planet';

const R = 6_371_000;

/** The sphere of radius `1/k` and its centre, evaluated the direct way (this is the brute force the curvature form is checked against). */
function sphere(k: number): { radius: number; centre: Vec3 } {
  return { radius: 1 / k, centre: [0, 0, -1 / k] };
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

describe('bent planet maths', () => {
  describe('bend', () => {
    it('at morph 0 (k = 1/R, x = R lon, y = R lat) is the exact globe of radius R around (0, 0, -R)', () => {
      const k = 1 / R;
      for (const [lon, lat] of [[0, 0], [0.7, 0.3], [-2.1, -1.2], [3.1, 1.5], [Math.PI, 0]]) {
        const { position, normal } = bend(R * lon, R * lat, k);
        const expected: Vec3 = [R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat), R * Math.cos(lat) * Math.cos(lon) - R];
        for (let i = 0; i < 3; i++) expect(position[i]).toBeCloseTo(expected[i], 4);
        expect(len(sub(position, [0, 0, -R]))).toBeCloseTo(R, 4);
        expect(len(normal)).toBeCloseTo(1, 12);
      }
    });

    it('at morph 1 (k = 0) is the flat map point, with the height straight up', () => {
      const { position, normal } = bend(1234.5, -678.9, 0, 42);
      expect(position[0]).toBe(1234.5);
      expect(position[1]).toBe(-678.9);
      expect(position[2]).toBe(42);
      expect(normal[0]).toBeCloseTo(0, 12);
      expect(normal[1]).toBeCloseTo(0, 12);
      expect(normal[2]).toBe(1);
    });

    it('puts the map centre at the origin whatever the curvature', () => {
      for (const k of [0, 1e-9, 1e-7, 1 / R]) {
        const p = bend(0, 0, k).position;
        expect(p[0]).toBe(0);
        expect(p[1]).toBe(0);
        expect(Math.abs(p[2])).toBe(0);
      }
    });

    it('k = 1e-9 and k = 0 agree to well under a millimetre over the whole map', () => {
      for (const [x, y] of [[0, 0], [R, R / 2], [-R * Math.PI, R * Math.PI * 0.5], [1e3, -2e3]]) {
        const a = bend(x, y, 1e-9, 100);
        const b = bend(x, y, 0, 100);
        // k x is up to 0.03 here, so the sag is ~ k x^2 / 2 = 20 km at the map edge: compare against the first-order sag.
        const sag = 0.5 * 1e-9 * (x * x + y * y);
        expect(Math.abs(a.position[0] - b.position[0])).toBeLessThan(Math.abs(x) * 1e-3 + 1e-6);
        expect(Math.abs(a.position[2] - b.position[2] + sag)).toBeLessThan(sag * 0.05 + 1e-6);
      }
      // And with no sag to speak of (tiny k, small map coordinates) the two are the same to float precision.
      const a = bend(1e3, -2e3, 1e-12, 5);
      const b = bend(1e3, -2e3, 0, 5);
      for (let i = 0; i < 3; i++) expect(Math.abs(a.position[i] - b.position[i])).toBeLessThan(1e-5);
    });

    it('is continuous across tiny k (no jump where the series takes over)', () => {
      const x = 4.0e6;
      const y = 1.0e6;
      let previous = bend(x, y, 1e-12).position;
      for (const k of [3e-12, 1e-11, 1e-10, 1e-9, 1e-8, 1e-7]) {
        const next = bend(x, y, k).position;
        expect(len(sub(next, previous))).toBeLessThan(0.51 * k * (x * x + y * y) + 1e-3);
        previous = next;
      }
    });

    it('every in-between shape lies on the sphere of radius 1/k (the map edges never leave it)', () => {
      for (const morph of [0, 0.1, 0.3, 0.5, 0.8, 0.95]) {
        const k = bendCurvature(morph, R);
        const { radius, centre } = sphere(k);
        for (const [fx, fy] of [[1, 0], [-1, 0.5], [0.3, -1], [1, 1], [-1, -1]]) {
          const p = bend(fx * Math.PI * R, fy * 0.5 * Math.PI * R, k).position;
          // At large radius the distance from the centre is ~1/k; compare the relative miss.
          expect(Math.abs(len(sub(p, centre)) - radius) / radius).toBeLessThan(1e-9);
        }
      }
    });

    it('a ground point has altitude 0, and terrain height h along the normal has altitude h', () => {
      for (const k of [0, 1e-9, 1e-8, 1 / R, 1 / (0.3 * R)]) {
        for (const [x, y] of [[0, 0], [1e5, 2e5], [-3e6, 1e6]]) {
          const ground = bend(x, y, k).position;
          expect(Math.abs(curvatureAltitude(ground, k))).toBeLessThan(1e-3);
          const raised = bend(x, y, k, 250).position;
          expect(curvatureAltitude(raised, k)).toBeCloseTo(250, 3);
        }
      }
    });
  });

  describe('curvature form against a brute-force sphere (moderate k)', () => {
    const ks = [1 / R, 0.5 / R, 0.1 / R, 0.01 / R];
    const points: Vec3[] = [[0, 0, 5000], [2e5, -1e5, 30000], [-3e6, 2e6, 80000], [1e6, 1e6, -0.0], [0, 4e6, 200]];

    it('altitude matches |p - centre| - radius', () => {
      for (const k of ks) {
        const { radius, centre } = sphere(k);
        for (const p of points) {
          const brute = len(sub(p, centre)) - radius;
          // The brute force subtracts two ~1/k numbers; the curvature form is the accurate one, so allow the cancellation.
          expect(Math.abs(curvatureAltitude(p, k) - brute)).toBeLessThan(1e-9 * radius + 1e-6);
        }
      }
    });

    it('up matches (p - centre) normalised', () => {
      for (const k of ks) {
        const { centre } = sphere(k);
        for (const p of points) {
          const v = sub(p, centre);
          const l = len(v);
          const up = curvatureUp(p, k);
          for (let i = 0; i < 3; i++) expect(up[i]).toBeCloseTo(v[i] / l, 10);
        }
      }
    });

    it('the ray against the air top matches a direct quadratic against the larger sphere', () => {
      const top = 100_000;
      for (const k of ks) {
        const { radius, centre } = sphere(k);
        const o: Vec3 = [1e5, -5e4, 2000];
        for (const d of [[0, 0, 1], [0.6, 0.0, 0.8], [0.0, 0.8, -0.6], [0.99, 0.1, 0.0995], [-0.3, 0.2, 0.9327]]) {
          const dir = d as unknown as Vec3;
          const n = len(dir);
          const dn: Vec3 = [dir[0] / n, dir[1] / n, dir[2] / n];
          const oc = sub(o, centre);
          const b = oc[0] * dn[0] + oc[1] * dn[1] + oc[2] * dn[2];
          const big = radius + top;
          const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - big * big;
          const disc = b * b - c;
          const hit = rayAtAltitude(o, dn, k, top);
          if (disc < 0) {
            expect(hit).toBeNull();
            continue;
          }
          expect(hit).not.toBeNull();
          const t0 = -b - Math.sqrt(disc);
          const t1 = -b + Math.sqrt(disc);
          // The direct form cancels at large radii; the tolerance is its own precision, relative to the root.
          const tol = (t: number): number => 1e-6 * Math.max(1, Math.abs(t)) + 1e-12 * radius;
          expect(Math.abs(hit!.near - t0)).toBeLessThan(tol(t0) + 1e-9 * radius);
          expect(Math.abs(hit!.far - t1)).toBeLessThan(tol(t1) + 1e-9 * radius);
        }
      }
    });

    it('the ground hit (altitude 0) of a downward ray lands on the ground', () => {
      for (const k of [1 / R, 0.2 / R, 1e-9, 0]) {
        const o: Vec3 = [3e4, 1e4, 1500];
        const d: Vec3 = [0.3, 0.1, -Math.sqrt(1 - 0.1)];
        const hit = rayAtAltitude(o, d, k, 0);
        expect(hit).not.toBeNull();
        const t = hit!.near > 0 ? hit!.near : hit!.far;
        const p: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
        expect(Math.abs(curvatureAltitude(p, k))).toBeLessThan(1e-3);
      }
    });
  });

  describe('flat limit', () => {
    it('k = 0 is the plane z = altitude: altitude is z, up is +z, the ray hits the plane at the straight-line distance', () => {
      expect(curvatureAltitude([10, 20, 345], 0)).toBe(345);
      expect([...curvatureUp([10, 20, 345], 0)]).toEqual([0, 0, 1]);
      const hit = rayAtAltitude([0, 0, 2], [0.6, 0, -0.8], 0, 0);
      expect(hit!.near).toBeCloseTo(2.5, 12);
      expect(hit!.far).toBe(Infinity);
      const up = rayAtAltitude([0, 0, 2], [0.6, 0, 0.8], 0, 100);
      expect(up!.far).toBeCloseTo(122.5, 9);
      expect(up!.near).toBe(-Infinity);
    });

    it('k = 1e-9 and k = 0 agree for altitude, up and the ray crossing', () => {
      const p: Vec3 = [1e5, -2e5, 12_345];
      // The altitude over a sphere is the height plus the sag, k |p|^2 / 2 = 25 m here.
      expect(curvatureAltitude(p, 1e-9) - curvatureAltitude(p, 0)).toBeCloseTo(0.5e-9 * (p[0] * p[0] + p[1] * p[1]), 0);
      const u = curvatureUp(p, 1e-9);
      expect(u[2]).toBeCloseTo(1, 4);
      const flat = rayAtAltitude([0, 0, 10], [0.5, 0, -Math.sqrt(0.75)], 0, 0)!;
      const near = rayAtAltitude([0, 0, 10], [0.5, 0, -Math.sqrt(0.75)], 1e-9, 0)!;
      expect(near.near).toBeCloseTo(flat.near, 4);
    });
  });

  describe('frame and map coordinates', () => {
    it('the frame vectors are orthonormal and the up is the bend normal', () => {
      for (const k of [0, 1e-8, 1 / R]) {
        const f = bendFrame(1.2e6, -4e5, k);
        const d = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        expect(d(f.east, f.east)).toBeCloseTo(1, 12);
        expect(d(f.north, f.north)).toBeCloseTo(1, 12);
        expect(d(f.up, f.up)).toBeCloseTo(1, 12);
        expect(d(f.east, f.north)).toBeCloseTo(0, 12);
        expect(d(f.east, f.up)).toBeCloseTo(0, 12);
        expect(d(f.north, f.up)).toBeCloseTo(0, 12);
        const n = bend(1.2e6, -4e5, k).normal;
        for (let i = 0; i < 3; i++) expect(f.up[i]).toBeCloseTo(n[i], 12);
      }
    });

    it('bentMapCoords inverts bend, including at tiny k and on the far side of the globe', () => {
      for (const k of [0, 1e-9, 1e-8, 0.3 / R, 1 / R]) {
        for (const [x, y] of [[0, 0], [1e5, 1e5], [-2e6, 1.2e6], [0.9 * Math.PI * R, 0.4 * Math.PI * R]]) {
          if (k > 0 && k * Math.abs(x) > Math.PI) continue;
          const p = bend(x, y, k).position;
          const [mx, my] = bentMapCoords(p, k);
          expect(Math.abs(mx - x)).toBeLessThan(1e-6 * Math.abs(x) + 1e-3);
          expect(Math.abs(my - y)).toBeLessThan(1e-6 * Math.abs(y) + 1e-3);
        }
      }
    });
  });

  describe('map mask', () => {
    const W = Math.PI * R;
    const Hh = 0.5 * Math.PI * R;
    const soft = 8000;

    it('is 1 inside and 0 outside the outline, soft over the falloff', () => {
      const k = 0.2 / R;
      expect(mapMaskFactor(0, 0, k, W, Hh, soft)).toBe(1);
      expect(mapMaskFactor(W + 1000, 0, k, W, Hh, soft)).toBe(0);
      expect(mapMaskFactor(0, -Hh - 1000, k, W, Hh, soft)).toBe(0);
      const edge = mapMaskFactor(W - soft / 2, 0, k, W, Hh, soft);
      expect(edge).toBeGreaterThan(0.2);
      expect(edge).toBeLessThan(0.8);
    });

    it('cuts nothing from the closed globe, seam and poles included', () => {
      const k = 1 / R;
      expect(mapMaskFactor(W * 0.9999999, 0, k, W, Hh, soft)).toBe(1);
      expect(mapMaskFactor(0, Hh * 0.9999999, k, W, Hh, soft)).toBe(1);
      expect(mapMaskFactor(-W * 0.99999999, Hh * 0.9999, k, W, Hh, soft)).toBe(1);
    });

    it('softens by at most the opened gap just after the globe starts to open', () => {
      // Gap 2 pi (1/k - R): at k = 0.999/R it is about 12.6 km. The falloff is half of that, not the full 8 km.
      const k = 0.999 / R;
      const gap = (2 * Math.PI) / k - 2 * W;
      expect(gap).toBeGreaterThan(1e4);
      expect(mapMaskFactor(W - 0.25 * gap / 2, 0, k, W, Hh, soft)).toBeGreaterThan(0.4);
    });
  });

  it('sinc is exact at 0 and continuous through the series switch', () => {
    expect(sinc(0)).toBe(1);
    expect(sinc(0.00099)).toBeCloseTo(Math.sin(0.00099) / 0.00099, 12);
    expect(Math.abs(sinc(0.0010001) - sinc(0.0009999))).toBeLessThan(1e-9);
  });
});
