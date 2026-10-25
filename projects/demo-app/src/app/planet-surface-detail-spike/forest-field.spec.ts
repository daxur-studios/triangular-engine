import {
  FOREST_CANOPY_COVER,
  FOREST_CLEARANCE_M,
  FOREST_CROWN_WIDTH_M,
  FOREST_SPACING_M,
  forestClearance,
  forestFadeBand,
  forestFieldDensity,
  forestHash,
  forestNoise,
  scatterForest,
  SCATTER_STRIDE,
} from './forest-field';
import { RUNWAY_APRON_M, RUNWAY_LENGTH_M, runwayFrame, type IRunwaySite, type Vec3 } from './runway-site';

const RADIUS_M = 600_000;
const centre: Vec3 = [0, 0, 1];
const { along, across } = runwayFrame(centre, 0.4);
const site: IRunwaySite = { centre, along, across, heightM: 100 };

describe('forest density field', () => {
  it('hashes lattice points deterministically into [0, 1)', () => {
    expect(forestHash(3, -7, 12)).toBe(forestHash(3, -7, 12));
    let min = 1;
    let max = 0;
    for (let i = -20; i < 20; i += 1) {
      const h = forestHash(i, i * 3, -i);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(max - min).toBeGreaterThan(0.5);
  });

  it('is continuous: a step of a metre moves the noise by a hair', () => {
    for (const cell of [120, 1500, 6000]) {
      const a = forestNoise(600_000, 1234, -4321, cell, 1);
      const b = forestNoise(600_001, 1234, -4321, cell, 1);
      expect(Math.abs(a - b)).toBeLessThan(2 / cell);
    }
  });

  it('stays within [0, 1] and covers a share of land between bare and solid', () => {
    let forest = 0;
    let solid = 0;
    const n = 4000;
    for (let i = 0; i < n; i += 1) {
      const lon = i * 0.7;
      const x = Math.sin(lon) * RADIUS_M;
      const z = Math.cos(lon) * RADIUS_M;
      const d = forestFieldDensity(x, 300 + i * 11, z, 200);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      if (d > 0) forest += 1;
      if (d === 1) solid += 1;
    }
    expect(forest / n).toBeGreaterThan(0.2);
    expect(forest / n).toBeLessThan(0.8);
    expect(solid).toBeGreaterThan(0);
  });

  it('keeps forest off the coast, off water level and above the tree line', () => {
    const p = [RADIUS_M * 0.6, 100, RADIUS_M * 0.8] as const;
    for (let k = 0; k < 50; k += 1) {
      expect(forestFieldDensity(p[0] + k * 700, p[1], p[2], 0)).toBe(0);
      expect(forestFieldDensity(p[0] + k * 700, p[1], p[2], 3000)).toBe(0);
    }
  });

  it('derives the fade band from the tree size, not a constant', () => {
    const small = forestFadeBand(4);
    const large = forestFadeBand(8);
    expect(large.startM).toBeCloseTo(small.startM * 2, 6);
    expect(large.endM).toBeGreaterThan(large.startM);
    // 8 m crown, 12 px at 1 px = 0.001 distance
    expect(large.startM).toBeCloseTo(666.7, 0);
  });

  it('derives the far form cover from the instance spacing and crown width', () => {
    expect(FOREST_CANOPY_COVER).toBeCloseTo(Math.min(0.9, (Math.PI * (FOREST_CROWN_WIDTH_M / 2) ** 2) / FOREST_SPACING_M ** 2), 9);
    expect(FOREST_CANOPY_COVER).toBeGreaterThan(0.5);
    expect(FOREST_CANOPY_COVER).toBeLessThanOrEqual(0.9);
  });

  it('clears the runway and its apron, and nothing farther than the clearance', () => {
    const at = (a: number, b: number): Vec3 => {
      const x = centre[0] + (along[0] * a + across[0] * b) / RADIUS_M;
      const y = centre[1] + (along[1] * a + across[1] * b) / RADIUS_M;
      const z = centre[2] + (along[2] * a + across[2] * b) / RADIUS_M;
      const l = Math.hypot(x, y, z);
      return [x / l, y / l, z / l];
    };
    expect(forestClearance(site, at(0, 0), RADIUS_M)).toBe(0);
    expect(forestClearance(site, at(RUNWAY_LENGTH_M / 2 + RUNWAY_APRON_M - 5, 0), RADIUS_M)).toBe(0);
    expect(forestClearance(site, at(0, 22.5 + FOREST_CLEARANCE_M[1] + 10), RADIUS_M)).toBe(1);
    expect(forestClearance(null, at(0, 0), RADIUS_M)).toBe(1);
  });
});

describe('scatterForest', () => {
  const heightAt = () => 200;
  const options = { centre, radiusM: RADIUS_M, areaRadiusM: 1500, spacingM: 15, densityScale: 1, site: null, heightAt };

  it('is deterministic', () => {
    expect(Array.from(scatterForest(options))).toEqual(Array.from(scatterForest(options)));
  });

  it('puts trees where the field is dense and none where it is empty', () => {
    const trees = scatterForest(options);
    expect(trees.length / SCATTER_STRIDE).toBeGreaterThan(50);
    let dense = 0;
    let bare = 0;
    for (let i = 0; i < trees.length; i += SCATTER_STRIDE) {
      const x = trees[i] + centre[0] * RADIUS_M;
      const y = trees[i + 1] + centre[1] * RADIUS_M;
      const z = trees[i + 2] + centre[2] * RADIUS_M;
      const d = forestFieldDensity(x, y, z, 200);
      if (d > 0.5) dense += 1;
      if (d === 0) bare += 1;
    }
    expect(bare).toBe(0);
    expect(dense / (trees.length / SCATTER_STRIDE)).toBeGreaterThan(0.5);
  });

  it('scales with the density scale and drops to nothing at zero', () => {
    const full = scatterForest(options).length;
    const half = scatterForest({ ...options, densityScale: 0.5 }).length;
    expect(half).toBeLessThan(full);
    expect(scatterForest({ ...options, densityScale: 0 }).length).toBe(0);
  });

  it('skips water, and keeps trees off the runway', () => {
    expect(scatterForest({ ...options, heightAt: () => null }).length).toBe(0);
    const trees = scatterForest({ ...options, site, areaRadiusM: 1800 });
    for (let i = 0; i < trees.length; i += SCATTER_STRIDE) {
      const px = trees[i] + centre[0] * RADIUS_M;
      const py = trees[i + 1] + centre[1] * RADIUS_M;
      const pz = trees[i + 2] + centre[2] * RADIUS_M;
      const a = px * along[0] + py * along[1] + pz * along[2];
      const b = px * across[0] + py * across[1] + pz * across[2];
      const outside = Math.hypot(Math.max(Math.abs(a) - RUNWAY_LENGTH_M / 2, 0), Math.max(Math.abs(b) - 22.5, 0));
      // The apron is cleared too (a few metres of slack for the flat-tangent approximation).
      expect(outside).toBeGreaterThanOrEqual(RUNWAY_APRON_M - 5);
    }
  });
});
