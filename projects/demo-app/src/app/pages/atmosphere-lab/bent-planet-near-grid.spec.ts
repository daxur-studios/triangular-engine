import { blendedProjection } from 'triangular-engine/atmosphere';
import {
  NEAR_CELLS,
  NEAR_SUBDIVISIONS,
  NEAR_VERTICES,
  coarseSurfacePoint,
  fillNearGrid,
  mapToLonLat,
  nearCoarseWeight,
  nearIndices,
  nearWindow,
  type NearWindow,
} from './bent-planet-near-grid';

const R = 6_371_000;
const LON_SEGMENTS = 360;
const LAT_SEGMENTS = 180;
const ROW = LON_SEGMENTS + 1;
const D2R = Math.PI / 180;

type Vec3 = [number, number, number];

/** A point of the globe, x east, y north, z up at lon 0 / lat 0. */
function sphere(lon: number, lat: number): Vec3 {
  return [R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat), R * Math.cos(lat) * Math.cos(lon)];
}

function coarseGlobe(): Float64Array {
  const positions = new Float64Array(ROW * (LAT_SEGMENTS + 1) * 3);
  for (let iy = 0; iy <= LAT_SEGMENTS; iy++) {
    for (let ix = 0; ix <= LON_SEGMENTS; ix++) {
      positions.set(sphere(-Math.PI + (2 * Math.PI * ix) / LON_SEGMENTS, -Math.PI / 2 + (Math.PI * iy) / LAT_SEGMENTS), (iy * ROW + ix) * 3);
    }
  }
  return positions;
}

function nearGlobe(window: NearWindow, coarse: Float64Array): Float64Array {
  const positions = new Float64Array(NEAR_VERTICES * NEAR_VERTICES * 3);
  fillNearGrid(
    window,
    LON_SEGMENTS,
    LAT_SEGMENTS,
    coarse,
    ROW,
    (lon, lat) => [lon, lat],
    (lon, lat, out, at) => {
      const p = sphere(lon, lat);
      out[at] = p[0];
      out[at + 1] = p[1];
      out[at + 2] = p[2];
    },
    { positions, mapXY: new Float64Array(NEAR_VERTICES * NEAR_VERTICES * 2), lonLat: new Float64Array(NEAR_VERTICES * NEAR_VERTICES * 2) },
  );
  return positions;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function hitsTriangle(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-30) return false;
  const t = sub(o, a);
  const u = dot(t, p) / det;
  if (u < 0 || u > 1) return false;
  const q = cross(t, e1);
  const v = dot(d, q) / det;
  return v >= 0 && u + v <= 1 && dot(e2, q) / det > 0;
}

/** How far below the horizon the shallowest ray is that meets the mesh, minus the sphere's own horizon dip, in degrees. */
function stripDegrees(triangles: Vec3[][], altitudeM: number, azimuthDeg: number): number {
  const origin: Vec3 = [0, 0, R + altitudeM];
  const dip = Math.acos(R / (R + altitudeM));
  const az = azimuthDeg * D2R;
  const dirAt = (depression: number): Vec3 => [Math.cos(depression) * Math.sin(az), Math.cos(depression) * Math.cos(az), -Math.sin(depression)];
  const hits = (depression: number): boolean => {
    const d = dirAt(depression);
    return triangles.some((t) => hitsTriangle(origin, d, t[0], t[1], t[2]));
  };
  let lo = dip;
  let hi = 3 * D2R;
  if (!hits(hi)) return Infinity;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (hits(mid)) hi = mid;
    else lo = mid;
  }
  return (hi - dip) / D2R;
}

/** The 1 degree cells around lon 0 / lat 0 as triangles, without the cells in `skip`. */
function coarseTriangles(coarse: Float64Array, reach: number, skip: (ix: number, iy: number) => boolean): Vec3[][] {
  const at = (ix: number, iy: number): Vec3 => {
    const i = (iy * ROW + ix) * 3;
    return [coarse[i], coarse[i + 1], coarse[i + 2]];
  };
  const triangles: Vec3[][] = [];
  for (let iy = LAT_SEGMENTS / 2 - reach; iy < LAT_SEGMENTS / 2 + reach; iy++) {
    for (let ix = LON_SEGMENTS / 2 - reach; ix < LON_SEGMENTS / 2 + reach; ix++) {
      if (skip(ix, iy)) continue;
      triangles.push([at(ix, iy), at(ix + 1, iy), at(ix, iy + 1)], [at(ix + 1, iy), at(ix + 1, iy + 1), at(ix, iy + 1)]);
    }
  }
  return triangles;
}

describe('bent planet near grid', () => {
  describe('nearWindow', () => {
    it('is centred on the camera cell', () => {
      const w = nearWindow(180.4, 90.9, LON_SEGMENTS, LAT_SEGMENTS);
      expect([w.ix0, w.iy0]).toEqual([179, 89]);
      expect([w.openWest, w.openEast, w.openSouth, w.openNorth]).toEqual([true, true, true, true]);
    });

    it('moves inwards at the map edge and does not ease there', () => {
      const w = nearWindow(0.2, 179.9, LON_SEGMENTS, LAT_SEGMENTS);
      expect([w.ix0, w.iy0]).toEqual([0, LAT_SEGMENTS - NEAR_CELLS]);
      expect([w.openWest, w.openEast, w.openSouth, w.openNorth]).toEqual([false, true, true, false]);
      const e = nearWindow(359.5, 0, LON_SEGMENTS, LAT_SEGMENTS);
      expect(e.ix0).toBe(LON_SEGMENTS - NEAR_CELLS);
      expect(e.openEast).toBeFalse();
    });
  });

  describe('nearCoarseWeight', () => {
    const open = nearWindow(180.5, 90.5, LON_SEGMENTS, LAT_SEGMENTS);

    it('is 0 in the middle cell and 1 on an open edge, easing in between', () => {
      expect(nearCoarseWeight(1.5, 1.5, open)).toBe(0);
      expect(nearCoarseWeight(1, 1, open)).toBe(0);
      expect(nearCoarseWeight(0, 1.5, open)).toBe(1);
      expect(nearCoarseWeight(1.5, NEAR_CELLS, open)).toBe(1);
      const mid = nearCoarseWeight(0.5, 1.5, open);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(1);
      expect(nearCoarseWeight(0.1, 1.5, open)).toBeGreaterThan(nearCoarseWeight(0.4, 1.5, open));
    });

    it('is 0 everywhere when the window has no open edge', () => {
      const closed: NearWindow = { ix0: 0, iy0: 0, openWest: false, openEast: false, openSouth: false, openNorth: false };
      expect(nearCoarseWeight(0, 0, closed)).toBe(0);
    });

    it('stays small where a camera at the middle cell edge sees its horizon at 2 m (5 km)', () => {
      // The camera on the middle cell's west edge: 1 cell from the window's edge.
      expect(nearCoarseWeight(1 - 5 / 111, 1.5, open)).toBeLessThan(0.01);
    });
  });

  describe('coarseSurfacePoint', () => {
    const coarse = coarseGlobe();
    const point = (ix: number, iy: number, u: number, v: number): Vec3 => {
      const out: number[] = [0, 0, 0];
      coarseSurfacePoint(coarse, ROW, ix, iy, u, v, out);
      return out as Vec3;
    };
    const vertex = (ix: number, iy: number): Vec3 => [coarse[(iy * ROW + ix) * 3], coarse[(iy * ROW + ix) * 3 + 1], coarse[(iy * ROW + ix) * 3 + 2]];

    it('returns the cell corners', () => {
      for (const [u, v, dx, dy] of [[0, 0, 0, 0], [1, 0, 1, 0], [0, 1, 0, 1], [1, 1, 1, 1]] as const) {
        const p = point(200, 100, u, v);
        const q = vertex(200 + dx, 100 + dy);
        for (let i = 0; i < 3; i++) expect(p[i]).toBeCloseTo(q[i], 6);
      }
    });

    it('lies on the chord along a cell edge and below the sphere inside the cell', () => {
      const mid = point(200, 100, 0.5, 0);
      const a = vertex(200, 100);
      const b = vertex(201, 100);
      for (let i = 0; i < 3; i++) expect(mid[i]).toBeCloseTo((a[i] + b[i]) / 2, 6);
      const centre = point(200, 100, 0.25, 0.25);
      expect(Math.hypot(...centre)).toBeLessThan(R - 1);
    });

    it('uses the triangle the coarse mesh uses, on both sides of the diagonal', () => {
      // The diagonal runs from the south-east to the north-west corner.
      const onDiagonal = point(200, 100, 0.5, 0.5);
      const se = vertex(201, 100);
      const nw = vertex(200, 101);
      for (let i = 0; i < 3; i++) expect(onDiagonal[i]).toBeCloseTo((se[i] + nw[i]) / 2, 6);
      const below = point(200, 100, 0.2, 0.2);
      const a = vertex(200, 100);
      const b = vertex(201, 100);
      const c = vertex(200, 101);
      for (let i = 0; i < 3; i++) expect(below[i]).toBeCloseTo(a[i] + 0.2 * (b[i] - a[i]) + 0.2 * (c[i] - a[i]), 6);
    });
  });

  describe('mapToLonLat', () => {
    it('reads blendedProjection backwards, for the globe, Equal Earth and between', () => {
      for (const p of [0, 0.5, 1]) {
        for (const [lon, lat] of [[0, 0], [0.3, 0.2], [-2.5, 1.1], [3, -1.4], [-1, -0.05]]) {
          const [x, y] = blendedProjection(lon, lat, p, R);
          const back = mapToLonLat(x, y, p, R);
          expect(back.lon).withContext(`p ${p} lon ${lon}`).toBeCloseTo(lon, 6);
          expect(back.lat).withContext(`p ${p} lat ${lat}`).toBeCloseTo(lat, 6);
        }
      }
    });
  });

  describe('window mesh', () => {
    const coarse = coarseGlobe();
    const window = nearWindow(LON_SEGMENTS / 2, LAT_SEGMENTS / 2, LON_SEGMENTS, LAT_SEGMENTS);
    const near = nearGlobe(window, coarse);
    const index = nearIndices();
    const fineTriangles: Vec3[][] = [];
    const vertex = (v: number): Vec3 => [near[v * 3], near[v * 3 + 1], near[v * 3 + 2]];
    for (let i = 0; i < index.length; i += 3) fineTriangles.push([vertex(index[i]), vertex(index[i + 1]), vertex(index[i + 2])]);
    const insideWindow = (ix: number, iy: number): boolean =>
      ix >= window.ix0 && ix < window.ix0 + NEAR_CELLS && iy >= window.iy0 && iy < window.iy0 + NEAR_CELLS;

    it('is two triangles per fine cell', () => {
      expect(index.length).toBe((NEAR_CELLS * NEAR_SUBDIVISIONS) ** 2 * 6);
    });

    it('meets the coarse mesh along its outer edge', () => {
      const chord = (i0: Vec3, i1: Vec3, t: number): Vec3 => [i0[0] + t * (i1[0] - i0[0]), i0[1] + t * (i1[1] - i0[1]), i0[2] + t * (i1[2] - i0[2])];
      const cv = (ix: number, iy: number): Vec3 => [coarse[(iy * ROW + ix) * 3], coarse[(iy * ROW + ix) * 3 + 1], coarse[(iy * ROW + ix) * 3 + 2]];
      for (let j = 0; j < NEAR_VERTICES; j++) {
        const cy = Math.min(Math.floor(j / NEAR_SUBDIVISIONS), NEAR_CELLS - 1);
        const t = j / NEAR_SUBDIVISIONS - cy;
        const west = vertex(j * NEAR_VERTICES);
        const expected = chord(cv(window.ix0, window.iy0 + cy), cv(window.ix0, window.iy0 + cy + 1), t);
        for (let i = 0; i < 3; i++) expect(west[i]).withContext(`row ${j}`).toBeCloseTo(expected[i], 3);
        const south = vertex(j);
        const expectedSouth = chord(cv(window.ix0 + cy, window.iy0), cv(window.ix0 + cy + 1, window.iy0), t);
        for (let i = 0; i < 3; i++) expect(south[i]).withContext(`column ${j}`).toBeCloseTo(expectedSouth[i], 3);
      }
    });

    it('leaves no strip of ground uncovered at the horizon 2 m up: under 0.005 degrees where the 1 degree mesh leaves 0.45 to 0.7', () => {
      const coarseOnly = coarseTriangles(coarse, 4, () => false);
      const withWindow = [...coarseTriangles(coarse, 4, insideWindow), ...fineTriangles];
      for (const azimuth of [0, 45, 90]) {
        expect(stripDegrees(coarseOnly, 2, azimuth)).withContext(`coarse, azimuth ${azimuth}`).toBeGreaterThan(0.4);
        expect(stripDegrees(withWindow, 2, azimuth)).withContext(`window, azimuth ${azimuth}`).toBeLessThan(0.005);
      }
    });

    it('does the same at 85 m, where the horizon is 33 km away', () => {
      const withWindow = [...coarseTriangles(coarse, 4, insideWindow), ...fineTriangles];
      expect(stripDegrees(withWindow, 85, 45)).toBeLessThan(0.005);
    });
  });
});
