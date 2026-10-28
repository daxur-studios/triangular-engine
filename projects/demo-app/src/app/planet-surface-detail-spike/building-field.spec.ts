import {
  BUILDING_CLEARANCE_M,
  BUILDING_GAP_M,
  BUILDING_HEIGHT_RANGE_M,
  BUILDING_RUNWAY_GAP_M,
  BUILDING_SIZE_RANGE_M,
  boxDistance,
  buildingBands,
  buildingClearance,
  buildingFarBand,
  buildingInstances,
  buildingsFromInstances,
  footprintShadowDistance,
  footprintShadowOffset,
  placeBuildings,
  siteDirection,
} from './building-field';
import { scatterForest } from './forest-field';
import type { IScatterPlanetLatticeResult } from 'triangular-engine/scatter';
import { scatterRocks } from './rock-field';
import { RUNWAY_APRON_M, RUNWAY_LENGTH_M, RUNWAY_WIDTH_M, runwayFrame, type IRunwaySite, type Vec3 } from './runway-site';

const RADIUS_M = 600_000;
const centre: Vec3 = [0, 0, 1];
const { along, across } = runwayFrame(centre, 0.4);
const site: IRunwaySite = { centre, along, across, heightM: 100 };
const deg = (d: number): number => (d * Math.PI) / 180;

describe('building placement', () => {
  const buildings = placeBuildings(site, RADIUS_M);

  it('places a few dozen seeded boxes of 50-200 m', () => {
    expect(buildings.length).toBeGreaterThanOrEqual(20);
    expect(buildings.length).toBeLessThanOrEqual(64);
    expect(placeBuildings(site, RADIUS_M)).toEqual(buildings);
    for (const o of buildings) {
      for (const half of [o.hx, o.hy]) {
        expect(half * 2).toBeGreaterThanOrEqual(BUILDING_SIZE_RANGE_M[0]);
        expect(half * 2).toBeLessThanOrEqual(BUILDING_SIZE_RANGE_M[1]);
      }
      expect(o.heightM).toBeGreaterThanOrEqual(BUILDING_HEIGHT_RANGE_M[0]);
      expect(o.heightM).toBeLessThanOrEqual(BUILDING_HEIGHT_RANGE_M[1]);
    }
  });

  it('keeps clear of the runway apron and of each other', () => {
    const apronX = RUNWAY_LENGTH_M / 2 + RUNWAY_APRON_M;
    const apronY = RUNWAY_WIDTH_M / 2 + RUNWAY_APRON_M;
    buildings.forEach((o, i) => {
      expect(boxDistance(o.a, o.b, apronX + o.hx, apronY + o.hy)).toBeGreaterThanOrEqual(BUILDING_RUNWAY_GAP_M);
      buildings.slice(i + 1).forEach((p) => expect(boxDistance(o.a - p.a, o.b - p.b, o.hx + p.hx, o.hy + p.hy)).toBeGreaterThanOrEqual(BUILDING_GAP_M));
    });
  });

  it('drops a building over water', () => {
    const dry = placeBuildings(site, RADIUS_M, (d) => (d[0] * along[0] + d[1] * along[1] + d[2] * along[2] > 0 ? null : 50));
    expect(dry.length).toBeLessThan(buildings.length);
    for (const o of dry) expect(o.a + o.hx).toBeLessThan(1);
  });

  it('round-trips through the mesh records', () => {
    const records = buildingInstances(buildings, site, RADIUS_M, () => 120);
    const back = buildingsFromInstances(records);
    expect(back.length).toBe(buildings.length);
    back.forEach((o, i) => {
      expect(o.a).toBeCloseTo(buildings[i].a, 2);
      expect(o.hx).toBeCloseTo(buildings[i].hx, 3);
      expect(o.heightM).toBeCloseTo(buildings[i].heightM, 3);
    });
  });

  it('keeps trees and rocks off the footprints', () => {
    const clearanceAt = (d: Vec3): number => buildingClearance(buildings, site, d, RADIUS_M);
    const target = buildings[0];
    const at = siteDirection(site, RADIUS_M, target.a, target.b);
    expect(clearanceAt(at)).toBe(0);
    const common = { centre: at, radiusM: RADIUS_M, areaRadiusM: 260, site, heightAt: () => 100, clearanceAt };
    const check = (scatter: IScatterPlanetLatticeResult): void => {
      for (let i = 0; i < scatter.scale.length; i += 1) {
        const p = [0, 1, 2].map((k) => scatter.offsetsM[i * 3 + k] + scatter.originM[k]);
        const l = Math.hypot(p[0], p[1], p[2]);
        const d: Vec3 = [p[0] / l, p[1] / l, p[2] / l];
        const a = (d[0] * along[0] + d[1] * along[1] + d[2] * along[2]) * RADIUS_M;
        const b = (d[0] * across[0] + d[1] * across[1] + d[2] * across[2]) * RADIUS_M;
        for (const o of buildings) expect(boxDistance(a - o.a, b - o.b, o.hx, o.hy)).toBeGreaterThan(BUILDING_CLEARANCE_M - 0.01);
      }
    };
    check(scatterForest({ ...common, spacingM: 12, densityScale: 2 }));
    check(scatterRocks(common));
  });
});

describe('building far form', () => {
  it('draws meshes to about 4 km and the footprint until it is under a pixel', () => {
    const bands = buildingBands();
    expect(bands.meshEndM).toBeLessThanOrEqual(4000);
    expect(bands.meshStartM).toBeLessThan(bands.meshEndM);
    const far = buildingFarBand({ hx: 25, hy: 60 });
    expect(far.startM).toBeCloseTo(25_000, 6);
    expect(far.endM).toBeCloseTo(50_000, 6);
  });

  it('offsets the footprint shadow away from the sun by height / tan(elevation)', () => {
    // Sun along +a at 45 degrees: a 100 m building throws its roof edge 100 m toward -a.
    const s = Math.sin(deg(45));
    const c = Math.cos(deg(45));
    const [va, vb] = footprintShadowOffset(100, c, 0, s);
    expect(va).toBeCloseTo(-100, 6);
    expect(vb).toBeCloseTo(0, 6);
    // Sun at 10 degrees across the runway (-b side lit from +b).
    const low = footprintShadowOffset(50, 0, Math.cos(deg(10)), Math.sin(deg(10)));
    expect(low[1]).toBeCloseTo(-50 / Math.tan(deg(10)), 4);
    // Floored like the trees' shadows; and no offset with the sun overhead.
    expect(Math.hypot(...footprintShadowOffset(50, 1, 0, 0.0001))).toBeCloseTo(50 / 0.035, 4);
    expect(footprintShadowOffset(50, 0, 0, 1)).toEqual([0, 0]);
  });

  it('covers the swept footprint and nothing on the sun side', () => {
    const v = footprintShadowOffset(100, Math.cos(deg(30)), Math.cos(deg(30)) * 0.0, Math.sin(deg(30)));
    // A 60 x 40 m box (half 30 x 20): the shadow reaches to -30 + v.
    expect(footprintShadowDistance(0, 0, 30, 20, v)).toBeLessThan(0);
    expect(footprintShadowDistance(v[0] - 29, 0, 30, 20, v)).toBeLessThan(0);
    expect(footprintShadowDistance(v[0] - 31, 0, 30, 20, v)).toBeGreaterThan(0);
    expect(footprintShadowDistance(31, 0, 30, 20, v)).toBeCloseTo(1, 6);
    expect(footprintShadowDistance(v[0] / 2, 21, 30, 20, v)).toBeCloseTo(1, 6);
    // Diagonal sun: the hull's slanted edges (normals across the offset).
    const diagonal = footprintShadowOffset(100, 0.6, 0.6, 0.53);
    const mid: [number, number] = [diagonal[0] / 2, diagonal[1] / 2];
    expect(footprintShadowDistance(mid[0], mid[1], 30, 20, diagonal)).toBeLessThan(-15);
    const corner = footprintShadowDistance(mid[0] + 40, mid[1] - 40, 30, 20, diagonal);
    expect(corner).toBeGreaterThan(0);
  });
});
