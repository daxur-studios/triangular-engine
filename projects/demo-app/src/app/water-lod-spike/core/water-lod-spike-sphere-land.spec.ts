import { ISLANDS, SEABED_M, SEA_LEVEL_M, landHeightM } from './water-lod-spike-land';
import {
  SPHERE_HOME,
  SPHERE_ISLANDS,
  WATER_SPHERE_RADIUS_M,
  createSphereLandHeights,
  sphereDirectionAt,
  sphereIslandsFrom,
  sphereLandHeightM,
  sphereWaterDepthM,
} from './water-lod-spike-sphere-land';

const R = WATER_SPHERE_RADIUS_M;

/** The sphere-frame point `eastM` east and `northM` north of home, on the sphere. */
function pointAt(eastM: number, northM: number): [number, number, number] {
  const dir = sphereDirectionAt(eastM, northM);
  return [dir[0] * R, dir[1] * R, dir[2] * R];
}

describe('water-lod-spike sphere land', () => {
  it('puts a tangent offset on the sphere as a unit direction', () => {
    const dir = sphereDirectionAt(300, -500);
    expect(Math.hypot(...dir)).toBeCloseTo(1, 12);
    // Its angle from home is the offset's length over the radius (to the curvature correction of the chord).
    const home = SPHERE_HOME.up;
    const cosine = dir[0] * home[0] + dir[1] * home[1] + dir[2] * home[2];
    expect(Math.acos(cosine) * R).toBeCloseTo(Math.hypot(300, 500), 0);
  });

  it('places an east offset along the home east axis and a north offset along north', () => {
    const east = sphereDirectionAt(1000, 0);
    const north = sphereDirectionAt(0, 1000);
    const { east: e, north: n } = SPHERE_HOME;
    expect(east[0] * e[0] + east[1] * e[1] + east[2] * e[2]).toBeCloseTo(1000 / R, 6);
    expect(north[0] * n[0] + north[1] * n[1] + north[2] * n[2]).toBeCloseTo(1000 / R, 6);
  });

  it('maps the plane spike islands to the sphere with plane z pointing south', () => {
    const islands = sphereIslandsFrom();
    expect(islands.length).toBe(ISLANDS.length);
    islands.forEach((island, i) => {
      expect(island.sigmaM).toBe(ISLANDS[i].sigmaM);
      expect(island.peakM).toBe(ISLANDS[i].peakM);
      const expected = sphereDirectionAt(ISLANDS[i].x, -ISLANDS[i].z);
      expect(island.dir[0]).toBeCloseTo(expected[0], 12);
      expect(island.dir[1]).toBeCloseTo(expected[1], 12);
      expect(island.dir[2]).toBeCloseTo(expected[2], 12);
    });
  });

  it('matches the plane land near home, where the curvature is below a centimetre', () => {
    for (const [x, z] of [[0, -600], [100, -450], [700, -300], [-300, -700], [0, 0]]) {
      const [px, py, pz] = pointAt(x, -z);
      expect(Math.abs(sphereLandHeightM(px, py, pz) - landHeightM(x, z))).toBeLessThan(0.05);
    }
  });

  it('is the seabed far from every island and rises to the peak at an island centre', () => {
    // The antipode of home is far from every island.
    const home = SPHERE_HOME.up;
    expect(sphereLandHeightM(-home[0] * R, -home[1] * R, -home[2] * R)).toBeCloseTo(SEABED_M, 9);
    const first = SPHERE_ISLANDS[0];
    const height = sphereLandHeightM(first.dir[0] * R, first.dir[1] * R, first.dir[2] * R);
    expect(height).toBeGreaterThan(SEABED_M + first.peakM * 0.99);
  });

  it('ignores the distance from the centre: the height depends on the direction only', () => {
    const [x, y, z] = pointAt(100, -450);
    expect(sphereLandHeightM(x * 1.001, y * 1.001, z * 1.001)).toBeCloseTo(sphereLandHeightM(x, y, z), 12);
  });

  it('gives the water depth as the sea level minus the land height', () => {
    const [x, y, z] = pointAt(0, 300);
    expect(sphereWaterDepthM(x, y, z)).toBeCloseTo(SEA_LEVEL_M - sphereLandHeightM(x, y, z), 12);
  });

  it('gives a source whose CPU height is the land height and whose bound covers every height', () => {
    const source = createSphereLandHeights();
    const [x, y, z] = pointAt(50, 200);
    expect(source.heightAt(x, y, z)).toBeCloseTo(sphereLandHeightM(x, y, z), 12);
    let largest = 0;
    for (const island of SPHERE_ISLANDS) {
      largest = Math.max(largest, Math.abs(sphereLandHeightM(island.dir[0] * R, island.dir[1] * R, island.dir[2] * R)));
    }
    expect(source.boundM).toBeGreaterThanOrEqual(largest);
    expect(source.boundM).toBeGreaterThanOrEqual(Math.abs(SEABED_M));
  });
});
