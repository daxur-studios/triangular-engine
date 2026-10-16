import { float, vec3, vec4 } from 'three/tsl';
import {
  EQUAL_EARTH_PROJECTION,
  EQUIRECTANGULAR_PROJECTION,
  IDENTITY_PROJECTION_BASIS,
  projectedLongitude,
  triangleCrossesAntimeridian,
  type IProjectionBasis,
} from 'triangular-engine/worldgen/render';
import { evaluateOnGpu } from './gpu-eval.testing';
import {
  equalEarthFlat,
  equirectangularFlat,
  seamProjectedLon,
  seamTriangleCrosses,
} from './projection-nodes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Deterministic unit vectors spread over the sphere, including both poles and the seam. */
function sampleDirections(): [number, number, number][] {
  const out: [number, number, number][] = [
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [-1, 0, 0],
    [0.001, 0.2, -0.98],
    [-0.001, -0.3, -0.95],
  ];
  for (let i = 0; i < 40; i++) {
    const t = (i + 0.5) / 40;
    const lat = Math.asin(1 - 2 * t);
    const lon = i * 2.399963229728653; // golden angle
    out.push([Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]);
  }
  return out.map(([x, y, z]) => {
    const n = Math.hypot(x, y, z);
    return [x / n, y / n, z / n];
  });
}

/** A rotated frame (not identity), orthonormal, so the dynamic-basis path is exercised. */
function rotatedBasis(): IProjectionBasis {
  const a = 0.7;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Rotate about +X by `a`: forward = (0, -s, c)... any proper rotation works.
  return {
    forward: { x: 0, y: -s, z: c },
    up: { x: 0, y: c, z: s },
    right: { x: 1, y: 0, z: 0 },
  };
}

describe('projection-nodes (TSL) vs the CPU references', () => {
  const dirs = sampleDirections();
  const bases: [string, IProjectionBasis][] = [
    ['identity', IDENTITY_PROJECTION_BASIS],
    ['rotated', rotatedBasis()],
  ];

  for (const [name, basis] of bases) {
    it(`seamProjectedLon matches projectedLongitude (${name} basis)`, async () => {
      const rows = dirs.map((d) => [
        [d[0], d[1], d[2], 0],
        [basis.forward.x, basis.forward.y, basis.forward.z, 0],
        [basis.right.x, basis.right.y, basis.right.z, 0],
      ]);
      const out = await evaluateOnGpu(rows, (at) =>
        vec4(seamProjectedLon(at(0).xyz, at(1).xyz, at(2).xyz), 0, 0, 1),
      );
      dirs.forEach((d, i) => {
        const cpu = projectedLongitude({ x: d[0], y: d[1], z: d[2] }, basis);
        // At exactly +/-pi the branch is ambiguous: accept either side of the seam.
        const gpu = out[i * 4];
        const delta = Math.abs(gpu - cpu);
        expect(Math.min(delta, Math.abs(delta - 2 * Math.PI)))
          .withContext(`dir ${d} gpu ${gpu} cpu ${cpu}`)
          .toBeLessThan(2e-4);
      });
    });
  }

  it('seamTriangleCrosses matches triangleCrossesAntimeridian', async () => {
    // Triangles built from neighbouring samples on a ring around the seam plus some far-apart sets.
    const triples: [number, number, number][] = [];
    for (let i = 0; i + 2 < dirs.length; i += 1) triples.push([i, i + 1, i + 2]);
    for (let i = 0; i + 7 < dirs.length; i += 5) triples.push([i, i + 3, i + 7]);
    const seamTri: [number[], number[], number[]][] = [
      [[0.05, 0, -1], [-0.05, 0, -1], [0, 0.1, -1]], // straddles the antimeridian
      [[0.05, 0, 1], [-0.05, 0, 1], [0, 0.1, 1]], // straddles lon 0, no crossing
    ];
    const norm = (v: number[]) => {
      const n = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / n, v[1] / n, v[2] / n];
    };
    const all: number[][][] = [
      ...triples.map(([a, b, c]) => [dirs[a], dirs[b], dirs[c]]),
      ...seamTri.map((t) => t.map(norm)),
    ];
    const basis = IDENTITY_PROJECTION_BASIS;
    const rows = all.map((t) => [
      [t[0][0], t[0][1], t[0][2], 0],
      [t[1][0], t[1][1], t[1][2], 0],
      [t[2][0], t[2][1], t[2][2], 0],
    ]);
    const out = await evaluateOnGpu(rows, (at) => {
      const crosses = seamTriangleCrosses(
        at(0).xyz,
        at(1).xyz,
        at(2).xyz,
        vec3(basis.forward.x, basis.forward.y, basis.forward.z),
        vec3(basis.right.x, basis.right.y, basis.right.z),
      );
      return vec4(crosses.select(float(1), float(0)), 0, 0, 1);
    });
    let crossing = 0;
    all.forEach((t, i) => {
      const v = (k: number) => ({ x: t[k][0], y: t[k][1], z: t[k][2] });
      const cpu = triangleCrossesAntimeridian(v(0), v(1), v(2), basis);
      if (cpu) crossing++;
      expect(out[i * 4] > 0.5).withContext(`triangle ${i}`).toBe(cpu);
    });
    // The fixture must exercise both outcomes, or the comparison proves nothing.
    expect(crossing).toBeGreaterThan(0);
    expect(crossing).toBeLessThan(all.length);
  });

  it('equirectangularFlat matches EQUIRECTANGULAR_PROJECTION', async () => {
    const width = 1000;
    const height = 500;
    const pts: [number, number][] = [];
    for (let lon = -Math.PI; lon <= Math.PI; lon += Math.PI / 6) {
      for (let lat = -Math.PI / 2; lat <= Math.PI / 2; lat += Math.PI / 6) pts.push([lon, lat]);
    }
    const rows = pts.map(([lon, lat]) => [[lon, lat, width, height]]);
    const out = await evaluateOnGpu(rows, (at) => {
      const v = at(0);
      const xy = equirectangularFlat(v.x, v.y, v.z, v.w);
      return vec4(xy.x, xy.y, 0, 1);
    });
    pts.forEach(([lon, lat], i) => {
      const cpu = EQUIRECTANGULAR_PROJECTION.project(lon, lat, width, height);
      // GLSL/TSL flat space is centred and y-up; the CPU's is canvas space.
      expect(out[i * 4]).withContext(`x @ ${lon},${lat}`).toBeCloseTo(cpu.x - width / 2, 2);
      expect(out[i * 4 + 1]).withContext(`y @ ${lon},${lat}`).toBeCloseTo(height / 2 - cpu.y, 2);
    });
  });

  it('equalEarthFlat matches EQUAL_EARTH_PROJECTION', async () => {
    const width = 1000;
    const height = 500;
    const pts: [number, number][] = [];
    for (let lon = -Math.PI; lon <= Math.PI + 1e-9; lon += Math.PI / 6) {
      for (let lat = -Math.PI / 2; lat <= Math.PI / 2 + 1e-9; lat += Math.PI / 6) pts.push([lon, lat]);
    }
    const rows = pts.map(([lon, lat]) => [[lon, lat, width, height]]);
    const out = await evaluateOnGpu(rows, (at) => {
      const v = at(0);
      const xy = equalEarthFlat(v.x, v.y, v.z);
      return vec4(xy.x, xy.y, 0, 1);
    });
    pts.forEach(([lon, lat], i) => {
      const cpu = EQUAL_EARTH_PROJECTION.project(lon, lat, width, height);
      expect(out[i * 4]).withContext(`x @ ${lon},${lat}`).toBeCloseTo(cpu.x - width / 2, 1);
      expect(out[i * 4 + 1]).withContext(`y @ ${lon},${lat}`).toBeCloseTo(height / 2 - cpu.y, 1);
    });
  });
});
