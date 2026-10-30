import { Vector3 } from 'three';
import { float, mix, select, vec2, vec4 } from 'three/tsl';
import {
  EQUAL_EARTH_PROJECTION,
  bendPlanetSurfacePoint,
  evaluateBentTransform,
  recoverStaticEquirectXY,
} from 'triangular-engine/worldgen/render';
import { evaluateOnGpu } from './gpu-eval.testing';
import {
  PLANET_MAP_EQUAL_EARTH_SCALE,
  planetEqualEarthRow,
  planetMapExtents,
  planetMapRowHalfWidth,
  planetMapRows,
  planetMapXY,
  type PlanetMapProjection,
} from './planet-map';
import {
  EQUAL_EARTH_RAW_X_MAX,
  equalEarthFlat,
  equirectangularFlat,
} from './projection-nodes';
import {
  createPlanetMorphUniforms,
  planetBentSurfaceNodes,
  setPlanetMapExtent,
} from './planet-morph-nodes';

const PROJECTIONS: PlanetMapProjection[] = ['equirectangular', 'equal-earth'];
const MORPHS = [0, 0.25, 0.5, 1];

/** Longitude/latitude samples across the map, including the cut (+-pi), the equator, and both poles. */
function samplePoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (const lon of [-Math.PI, -2.4, -1, -0.2, 0, 0.7, 1.9, Math.PI]) {
    for (const lat of [-Math.PI / 2, -1.2, -0.6, -0.05, 0, 0.3, 0.9, 1.4, Math.PI / 2]) {
      pts.push([lon, lat]);
    }
  }
  return pts;
}

describe('planetMapXY', () => {
  const R = 6_371_000;

  it('is (lon R, lat R) at morph 0, for both projections', () => {
    for (const projection of PROJECTIONS) {
      for (const [lon, lat] of samplePoints()) {
        const [x, y] = planetMapXY(lon, lat, 0, projection, R);
        expect(x).withContext(`${projection} x ${lon},${lat}`).toBeCloseTo(lon * R, 6);
        expect(y).withContext(`${projection} y ${lon},${lat}`).toBeCloseTo(lat * R, 6);
      }
    }
  });

  it('is (lon R, lat R) at every morph for equirectangular, with no blend', () => {
    for (const morph of MORPHS) {
      for (const [lon, lat] of samplePoints()) {
        const [x, y] = planetMapXY(lon, lat, morph, 'equirectangular', R);
        expect(x).toBe(lon * R);
        expect(y).toBe(lat * R);
      }
    }
  });

  it('is 2 pi R wide at the equator for Equal Earth at morph 1, and the equator row is not stretched in y', () => {
    const east = planetMapXY(Math.PI, 0, 1, 'equal-earth', R);
    const west = planetMapXY(-Math.PI, 0, 1, 'equal-earth', R);
    expect(east[0] - west[0]).toBeCloseTo(2 * Math.PI * R, 3);
    expect(east[0]).toBeCloseTo(Math.PI * R, 3);
    expect(east[1]).toBe(0);
  });

  it('matches the Equal Earth formula the material and the CPU projection use at morph 1', () => {
    const width = 2 * Math.PI * R;
    const height = Math.PI * R;
    for (const [lon, lat] of samplePoints()) {
      const cpu = EQUAL_EARTH_PROJECTION.project(lon, lat, width, height);
      const [x, y] = planetMapXY(lon, lat, 1, 'equal-earth', R);
      // The CPU projection is in canvas space (y down, origin at the corner); the material's is centred, y up.
      expect(x).withContext(`x ${lon},${lat}`).toBeCloseTo(cpu.x - width / 2, 3);
      expect(y).withContext(`y ${lon},${lat}`).toBeCloseTo(height / 2 - cpu.y, 3);
    }
  });

  it('blends linearly in morph between the two ends', () => {
    for (const [lon, lat] of samplePoints()) {
      const a = planetMapXY(lon, lat, 0, 'equal-earth', R);
      const b = planetMapXY(lon, lat, 1, 'equal-earth', R);
      const m = planetMapXY(lon, lat, 0.25, 'equal-earth', R);
      expect(m[0]).toBeCloseTo(a[0] * 0.75 + b[0] * 0.25, 4);
      expect(m[1]).toBeCloseTo(a[1] * 0.75 + b[1] * 0.25, 4);
    }
  });

  it('clamps the morph to 0..1 and reuses `out`', () => {
    const out: [number, number] = [0, 0];
    expect(planetMapXY(1, 0.5, -3, 'equal-earth', R, out)).toBe(out);
    expect(out).toEqual(planetMapXY(1, 0.5, 0, 'equal-earth', R));
    expect(planetMapXY(1, 0.5, 7, 'equal-earth', R)).toEqual(planetMapXY(1, 0.5, 1, 'equal-earth', R));
  });

  it('is symmetric: odd in longitude and in latitude', () => {
    for (const projection of PROJECTIONS) {
      const p = planetMapXY(1.3, 0.8, 0.6, projection, R);
      const q = planetMapXY(-1.3, -0.8, 0.6, projection, R);
      expect(q[0]).toBeCloseTo(-p[0], 6);
      expect(q[1]).toBeCloseTo(-p[1], 6);
    }
  });

  it('agrees with the cell-planet CPU twin: recoverStaticEquirectXY undoes the flat map', () => {
    const width = 2 * Math.PI * R;
    for (const [lon, lat] of samplePoints()) {
      if (Math.abs(lat) > 1.45) continue; // the recovery divides by the row's x per lon, which is stable but loses digits at the pole
      const flat = planetMapXY(lon, lat, 1, 'equal-earth', R);
      const [ex, ey] = recoverStaticEquirectXY(Math.sin(lat), flat[0], flat[1], R, width, true);
      const eq = planetMapXY(lon, lat, 0, 'equal-earth', R);
      expect(ex).withContext(`x ${lon},${lat}`).toBeCloseTo(eq[0], 0);
      expect(ey).withContext(`y ${lon},${lat}`).toBeCloseTo(eq[1], 0);
    }
  });

  it('agrees with bendPlanetSurfacePoint (the CPU twin of the baked-projection bend) through the bend', () => {
    const width = 2 * Math.PI * R;
    for (const morph of [0.25, 0.5, 0.75]) {
      for (const [lon, lat] of [
        [0.4, 0.3],
        [-2.2, -0.9],
        [1.1, 1.2],
        [3, 0.1],
      ] as [number, number][]) {
        const dir = new Vector3(
          Math.cos(lat) * Math.sin(lon),
          Math.sin(lat),
          Math.cos(lat) * Math.cos(lon),
        );
        const flat = planetMapXY(lon, lat, 1, 'equal-earth', R);
        const twin = bendPlanetSurfacePoint(
          dir.clone().multiplyScalar(R),
          new Vector3(flat[0], flat[1], 0),
          R,
          morph,
          width,
          true,
        );
        const [mx, my] = planetMapXY(lon, lat, morph, 'equal-earth', R);
        const bent = evaluateBentTransform(mx, my, (1 - morph) / R, 0, (1 - morph) * R);
        // `bendPlanetSurfacePoint` takes the sphere's own height from |spherePos| - R, which is 0 here.
        expect(bent.position.distanceTo(twin)).withContext(`morph ${morph} @ ${lon},${lat}`).toBeLessThan(1e-3);
      }
    }
  });
});

describe('planetEqualEarthRow and PLANET_MAP_EQUAL_EARTH_SCALE', () => {
  it('has the scale pi / rawXMax that projection-nodes fits the equator by', () => {
    expect(PLANET_MAP_EQUAL_EARTH_SCALE).toBeCloseTo(Math.PI / EQUAL_EARTH_RAW_X_MAX, 12);
    expect(PLANET_MAP_EQUAL_EARTH_SCALE).toBeCloseTo(1.1607026717777467, 12);
  });

  it('puts the equator at c(0) = 1 / scale and no y, so scale * c(0) = 1', () => {
    const row = planetEqualEarthRow(0);
    expect(row.y).toBe(0);
    expect(PLANET_MAP_EQUAL_EARTH_SCALE * row.c).toBeCloseTo(1, 12);
  });
});

describe('planetMapExtents and planetMapRowHalfWidth', () => {
  const R = 1000;

  it('gives the equirectangular outline pi R by pi R / 2 at every morph', () => {
    for (const morph of MORPHS) {
      const e = planetMapExtents(morph, 'equirectangular', R);
      expect(e.halfWidth).toBeCloseTo(Math.PI * R, 9);
      expect(e.halfHeight).toBeCloseTo((Math.PI / 2) * R, 9);
      for (const lat of [-1.5, 0, 0.7]) {
        expect(planetMapRowHalfWidth(lat, morph, 'equirectangular', R)).toBeCloseTo(Math.PI * R, 9);
      }
    }
  });

  it('gives the globe outline (pi R by pi R / 2, every row full width) at morph 0 for Equal Earth too', () => {
    const e = planetMapExtents(0, 'equal-earth', R);
    expect(e.halfWidth).toBeCloseTo(Math.PI * R, 9);
    expect(e.halfHeight).toBeCloseTo((Math.PI / 2) * R, 9);
    expect(planetMapRowHalfWidth(1.2, 0, 'equal-earth', R)).toBeCloseTo(Math.PI * R, 9);
  });

  it('gives Equal Earth at morph 1: pi R at the equator, narrowing to about 0.592 pi R at the poles, 1.529 R tall', () => {
    const e = planetMapExtents(1, 'equal-earth', R);
    expect(e.halfWidth).toBeCloseTo(Math.PI * R, 9);
    expect(e.halfHeight).toBeCloseTo(1.529066474 * R, 4);
    expect(planetMapRowHalfWidth(0, 1, 'equal-earth', R)).toBeCloseTo(Math.PI * R, 9);
    expect(planetMapRowHalfWidth(Math.PI / 2, 1, 'equal-earth', R)).toBeCloseTo(0.5924668898 * Math.PI * R, 4);
  });

  it('the row half-width is where the cut meridian lands, and the pole row holds the half height', () => {
    for (const morph of MORPHS) {
      const e = planetMapExtents(morph, 'equal-earth', R);
      for (const lat of [-1.3, -0.4, 0, 0.6, 1.5]) {
        const cut = planetMapXY(Math.PI, lat, morph, 'equal-earth', R);
        expect(cut[0]).toBeCloseTo(planetMapRowHalfWidth(lat, morph, 'equal-earth', R), 6);
      }
      expect(planetMapXY(0, Math.PI / 2, morph, 'equal-earth', R)[1]).toBeCloseTo(e.halfHeight, 6);
    }
  });

  it('planetMapRows inverts y to latitude and reports the half-width on each row', () => {
    for (const projection of PROJECTIONS) {
      for (const morph of [0.5, 1]) {
        const rows = planetMapRows(morph, projection, R, 33);
        expect(rows.lat.length).toBe(33);
        expect(rows.extents).toEqual(planetMapExtents(morph, projection, R));
        for (let i = 0; i < 33; i++) {
          const y = -rows.extents.halfHeight + (2 * rows.extents.halfHeight * i) / 32;
          expect(planetMapXY(0, rows.lat[i], morph, projection, R)[1]).toBeCloseTo(y, 6);
          expect(rows.halfWidth[i]).toBeCloseTo(planetMapRowHalfWidth(rows.lat[i], morph, projection, R), 6);
        }
        expect(rows.lat[0]).toBeCloseTo(-Math.PI / 2, 6);
        expect(rows.lat[32]).toBeCloseTo(Math.PI / 2, 6);
      }
    }
  });
});

/**
 * The TSL, evaluated on a real GPU backend (WebGL2 through `WebGPURenderer`, float32): the CPU function against the
 * graph `planetBentSurfaceNodes` builds in dynamic mode.
 */
describe('planetMapXY vs the TSL (dynamic mode)', () => {
  const R = 100;
  const W = 2 * Math.PI * R;
  const H = Math.PI * R;
  // The GPU backend's float32 `asin`/`sin` are good to about 1e-4 of the radius (the Equal Earth `y` near the equator is
  // off by 0.01 m at R = 100), so compare to 2e-4 R. A wrong map (a different Equal Earth scale, say) is off by percent.
  const TOL = 2e-4 * R;

  /** The points the graph is fed: away from the exact poles and from lon +-pi, where atan2 and the cut are ambiguous. */
  const pts: [number, number][] = [];
  for (const lon of [-3.0, -2.0, -0.9, 0, 0.35, 1.7, 3.0]) {
    for (const lat of [-1.5, -0.8, -0.1, 0, 0.4, 1.0, 1.5]) pts.push([lon, lat]);
  }

  for (const projection of PROJECTIONS) {
    for (const morph of [0.25, 0.5, 1]) {
      it(`the map (mix of the projection's flat map and R lon, R lat) matches: ${projection}, morph ${morph}`, async () => {
        const type = projection === 'equal-earth' ? 1 : 0;
        const rows = pts.map(([lon, lat]) => [[lon, lat, 0, 0]]);
        const out = await evaluateOnGpu(rows, (at) => {
          const v = at(0);
          // Exactly the lines of `planetMorphGraph` / `planetBentSurfaceNodes` that build `mapXY` in dynamic mode.
          const flat = select(
            float(type).lessThan(0.5),
            equirectangularFlat(v.x, v.y, float(W), float(H)),
            equalEarthFlat(v.x, v.y, float(W)),
          );
          const eq = vec2(v.x.mul(R), v.y.mul(R));
          const map = mix(eq, flat, float(morph));
          return vec4(map.x, map.y, 0, 1);
        });
        pts.forEach(([lon, lat], i) => {
          const [x, y] = planetMapXY(lon, lat, morph, projection, R);
          expect(Math.abs(out[i * 4] - x)).withContext(`x @ ${lon},${lat}`).toBeLessThan(TOL);
          expect(Math.abs(out[i * 4 + 1] - y)).withContext(`y @ ${lon},${lat}`).toBeLessThan(TOL);
        });
      });

      it(`the bent surface point (the whole planetBentSurfaceNodes graph) matches: ${projection}, morph ${morph}`, async () => {
        const uniforms = createPlanetMorphUniforms();
        setPlanetMapExtent(uniforms, R);
        uniforms.uMorph.value = morph;
        uniforms.uProjMode.value = 1; // dynamic, identity basis
        uniforms.uProjectionType.value = projection === 'equal-earth' ? 1 : 0;
        const rows = pts.map(([lon, lat]) => [
          [lon, lat, 0, 0],
          [
            R * Math.cos(lat) * Math.sin(lon),
            R * Math.sin(lat),
            R * Math.cos(lat) * Math.cos(lon),
            0,
          ],
        ]);
        const out = await evaluateOnGpu(rows, (at) => {
          const v = at(0);
          const sphere = at(1).xyz;
          const flatXY = select(
            float(projection === 'equal-earth' ? 1 : 0).lessThan(0.5),
            equirectangularFlat(v.x, v.y, float(W), float(H)),
            equalEarthFlat(v.x, v.y, float(W)),
          );
          const bent = planetBentSurfaceNodes(uniforms, {
            sphere,
            dir: sphere.div(R),
            flatXY,
            flatHeight: float(0),
            projLon: v.x,
            projLat: v.y,
          });
          return vec4(bent.pos, 1);
        });
        pts.forEach(([lon, lat], i) => {
          const [x, y] = planetMapXY(lon, lat, morph, projection, R);
          const cpu = evaluateBentTransform(x, y, (1 - morph) / R, 0, (1 - morph) * R);
          const gpu = new Vector3(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]);
          expect(gpu.distanceTo(cpu.position))
            .withContext(`@ ${lon},${lat}: gpu ${gpu.toArray()} cpu ${cpu.position.toArray()}`)
            .toBeLessThan(TOL);
        });
      });
    }
  }
});
