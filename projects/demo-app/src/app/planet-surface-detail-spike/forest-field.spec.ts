import { measureScatterPlanetCover, scatterPlanetLattice, type IScatterPlanetLatticeResult } from 'triangular-engine/scatter';
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
  treeScatterLayer,
} from './forest-field';
import { ROCK_COVER, ROCK_SIZE_RANGE_M, rockBands, rockFieldDensity, scatterRocks } from './rock-field';
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

  it('keeps the far form cover equal to the crown cover the scatter measures from above', () => {
    // Union area of the crown discs of a solid stand of the tree layer, measured on the scatter itself.
    const layer = { ...treeScatterLayer(FOREST_SPACING_M, 1, null, RADIUS_M), density: () => 1 };
    const solid = scatterPlanetLattice(layer, { centre, radiusM: RADIUS_M, windowRadiusM: 500, heightAt: () => 100 });
    const cover = measureScatterPlanetCover(solid, { footprintRadiusM: FOREST_CROWN_WIDTH_M / 2, sampleRadiusM: 200 });
    expect(Math.abs(cover - FOREST_CANOPY_COVER)).toBeLessThan(0.03);
    expect(FOREST_CANOPY_COVER).toBeLessThan((Math.PI * (FOREST_CROWN_WIDTH_M / 2) ** 2) / FOREST_SPACING_M ** 2);
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

/** Absolute body-fixed position of instance `i` of a result. */
function absolute(result: IScatterPlanetLatticeResult, i: number): Vec3 {
  return [
    result.offsetsM[i * 3] + result.originM[0],
    result.offsetsM[i * 3 + 1] + result.originM[1],
    result.offsetsM[i * 3 + 2] + result.originM[2],
  ];
}

/** Arc distance in metres on the datum sphere from a direction to a body-fixed point. */
function arcTo(point: Vec3, direction: Vec3): number {
  const l = Math.hypot(point[0], point[1], point[2]);
  return RADIUS_M * Math.acos(Math.min((point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2]) / l, 1));
}

function around(origin: Vec3, metresAlong: number, metresAcross: number): Vec3 {
  const x = origin[0] + (along[0] * metresAlong + across[0] * metresAcross) / RADIUS_M;
  const y = origin[1] + (along[1] * metresAlong + across[1] * metresAcross) / RADIUS_M;
  const z = origin[2] + (along[2] * metresAlong + across[2] * metresAcross) / RADIUS_M;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Lattice cell keys of a result. */
const cellKeys = (result: IScatterPlanetLatticeResult): string[] =>
  Array.from({ length: result.scale.length }, (_, i) => [result.cells[i * 3], result.cells[i * 3 + 1], result.cells[i * 3 + 2]].join());

/** Instances of a result clear of the runway rectangle plus its apron (a few metres of slack for the flat tangent). */
function expectClearOfRunway(result: IScatterPlanetLatticeResult): void {
  for (let i = 0; i < result.scale.length; i += 1) {
    const [px, py, pz] = absolute(result, i);
    const a = px * along[0] + py * along[1] + pz * along[2];
    const b = px * across[0] + py * across[1] + pz * across[2];
    const outside = Math.hypot(Math.max(Math.abs(a) - RUNWAY_LENGTH_M / 2, 0), Math.max(Math.abs(b) - 22.5, 0));
    expect(outside).toBeGreaterThanOrEqual(RUNWAY_APRON_M - 5);
  }
}

describe('scatterForest (library planet lattice with the forest field)', () => {
  const heightAt = (): number | null => 200;
  const options = { centre, radiusM: RADIUS_M, areaRadiusM: 1500, spacingM: 15, densityScale: 1, site: null as IRunwaySite | null, heightAt };
  const scatter = (o: Partial<Omit<typeof options, 'site'>> & { site?: IRunwaySite | null } = {}) => scatterForest({ ...options, ...o });

  it('puts trees where the field is dense and none where it is empty', () => {
    const trees = scatter();
    expect(trees.scale.length).toBeGreaterThan(50);
    let dense = 0;
    let bare = 0;
    for (let i = 0; i < trees.scale.length; i += 1) {
      const [x, y, z] = absolute(trees, i);
      const d = forestFieldDensity(x, y, z, 200);
      if (d > 0.5) dense += 1;
      if (d === 0) bare += 1;
    }
    expect(bare).toBe(0);
    expect(dense / trees.scale.length).toBeGreaterThan(0.5);
  });

  it('scales with the density scale and drops to nothing at zero', () => {
    const full = scatter().scale.length;
    expect(scatter({ densityScale: 0.5 }).scale.length).toBeLessThan(full);
    expect(scatter({ densityScale: 0 }).scale.length).toBe(0);
  });

  it('skips water, and keeps trees off the runway', () => {
    expect(scatter({ heightAt: () => null }).scale.length).toBe(0);
    expectClearOfRunway(scatter({ site, areaRadiusM: 1800 }));
  });

  it('keeps the same trees after a recentre (zoom) and for any window size', () => {
    const common = { ...options, spacingM: 12, densityScale: 1.4, areaRadiusM: 1200 };
    const centreB = around(centre, 310, -170);
    const a = scatterForest({ ...common, centre });
    const b = new Set(cellKeys(scatterForest({ ...common, centre: centreB })));
    let checked = 0;
    cellKeys(a).forEach((key, i) => {
      const point = absolute(a, i);
      if (arcTo(point, centre) > 850 || arcTo(point, centreB) > 850) return;
      expect(b.has(key)).toBeTrue();
      checked += 1;
    });
    expect(checked).toBeGreaterThan(100);
    const large = new Set(cellKeys(scatterForest({ ...common, centre, areaRadiusM: 2000 })));
    for (const key of cellKeys(scatterForest({ ...common, centre, areaRadiusM: 600 }))) expect(large.has(key)).toBeTrue();
  });
});

describe('density parity between the CPU and a float32 evaluation', () => {
  // The GPU evaluates the same noise in float32 on body-fixed metres. A planet-scale coordinate carries about
  // 0.03 m of float32 error; the field must not care. (The shader twin itself is checked on the page: `__psd.parity()`.)
  const f32 = Math.fround;

  it('agrees to a hair at planet scale', () => {
    let worst = 0;
    let differing = 0;
    const n = 3000;
    for (let i = 0; i < n; i += 1) {
      const lon = i * 0.37;
      const lat = Math.sin(i * 0.11) * 1.2;
      const h = 120 + (i % 50) * 30;
      const r = RADIUS_M + h;
      const x = Math.cos(lat) * Math.sin(lon) * r;
      const y = Math.sin(lat) * r;
      const z = Math.cos(lat) * Math.cos(lon) * r;
      const d = Math.abs(forestFieldDensity(x, y, z, h) - forestFieldDensity(f32(x), f32(y), f32(z), f32(h)));
      worst = Math.max(worst, d);
      if (d > 0.02) differing += 1;
    }
    expect(worst).toBeLessThan(0.1);
    expect(differing / n).toBeLessThan(0.005);
  });
});

describe('rocks', () => {
  const heightAt = () => 120;
  const options = { centre, radiusM: RADIUS_M, areaRadiusM: 900, site: null, heightAt };

  it('derives the bands from the rock size with the tree pixel rule', () => {
    const b = rockBands(2);
    expect(b.meshStartM).toBeCloseTo(166.7, 0);
    expect(b.meshEndM).toBeCloseTo(500, 6);
    expect(b.speckleStartM).toBeCloseTo(1000, 6);
    expect(b.speckleEndM).toBeCloseTo(2000, 6);
    expect(rockBands(4).meshStartM).toBeCloseTo(b.meshStartM * 2, 6);
    expect(b.meshEndM).toBeGreaterThan(b.meshStartM);
    expect(b.speckleStartM).toBeGreaterThan(b.meshEndM);
  });

  it('keeps the rock size in the 1 to 3 m the brief asks for', () => {
    expect(ROCK_SIZE_RANGE_M).toEqual([1, 3]);
    expect(ROCK_COVER).toBeGreaterThan(0.02);
    expect(ROCK_COVER).toBeLessThan(0.2);
  });

  it('scatters on its own field, deterministically and independent of the window centre', () => {
    const a = scatterRocks(options);
    expect(a.scale.length).toBeGreaterThan(20);
    expect(Array.from(scatterRocks(options).offsetsM)).toEqual(Array.from(a.offsetsM));
    for (const size of a.scale) {
      expect(size).toBeGreaterThanOrEqual(ROCK_SIZE_RANGE_M[0]);
      expect(size).toBeLessThanOrEqual(ROCK_SIZE_RANGE_M[1]);
    }
    const shifted = around(centre, 200, 150);
    const inB = new Set(cellKeys(scatterRocks({ ...options, centre: shifted })));
    let checked = 0;
    cellKeys(a).forEach((key, i) => {
      const point = absolute(a, i);
      if (arcTo(point, shifted) > 650 || arcTo(point, centre) > 650) return;
      checked += 1;
      expect(inB.has(key)).toBeTrue();
    });
    expect(checked).toBeGreaterThan(10);
  });

  it('thins rocks under solid forest and respects the coast and the runway', () => {
    let underForest = 0;
    let open = 0;
    let forestSamples = 0;
    let openSamples = 0;
    for (let i = 0; i < 6000; i += 1) {
      const lon = i * 0.71;
      const x = Math.sin(lon) * RADIUS_M;
      const z = Math.cos(lon) * RADIUS_M;
      const h = 200 + (i % 40) * 20;
      const y = h + 1000 * Math.sin(i);
      const f = forestFieldDensity(x, y, z, h);
      const r = rockFieldDensity(x, y, z, h);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      if (f > 0.95) {
        underForest += r;
        forestSamples += 1;
      } else if (f === 0) {
        open += r;
        openSamples += 1;
      }
    }
    expect(forestSamples).toBeGreaterThan(50);
    expect(openSamples).toBeGreaterThan(50);
    expect(underForest / forestSamples).toBeLessThan(open / openSamples);
    expect(rockFieldDensity(RADIUS_M * 0.6, 1, RADIUS_M * 0.8, 0)).toBe(0);
    expect(scatterRocks({ ...options, heightAt: () => null }).scale.length).toBe(0);
    expectClearOfRunway(scatterRocks({ ...options, site, areaRadiusM: 1500 }));
  });
});
