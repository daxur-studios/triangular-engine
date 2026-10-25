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
  cellHash,
  scatterCells,
  scatterForest,
  SCATTER_STRIDE,
  TREE_SEED,
} from './forest-field';
import { TREE_SHAPE } from './forest-instances';
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
    // Union area of the crown discs of a solid stand, by Monte Carlo on a fixed sequence of points.
    const solid = scatterCells({ centre, radiusM: RADIUS_M, areaRadiusM: 500, spacingM: FOREST_SPACING_M, seed: TREE_SEED, heightAt: () => 100, densityAt: () => 1 });
    const trees: [number, number, number][] = [];
    for (let i = 0; i < solid.instances.length; i += SCATTER_STRIDE) {
      const [x, y, z] = [solid.instances[i], solid.instances[i + 1], solid.instances[i + 2]];
      trees.push([x * along[0] + y * along[1] + z * along[2], x * across[0] + y * across[1] + z * across[2], (FOREST_CROWN_WIDTH_M / 2) * TREE_SHAPE.scale(solid.instances[i + 3])]);
    }
    let covered = 0;
    const n = 4000;
    for (let k = 0; k < n; k += 1) {
      const r = 200 * Math.sqrt((k + 0.5) / n);
      const angle = k * 2.399963229728653;
      const px = r * Math.cos(angle);
      const py = r * Math.sin(angle);
      if (trees.some(([tx, ty, radius]) => Math.hypot(tx - px, ty - py) < radius)) covered += 1;
    }
    expect(Math.abs(covered / n - FOREST_CANOPY_COVER)).toBeLessThan(0.03);
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

describe('scatterForest', () => {
  const heightAt = () => 200;
  const options = { centre, radiusM: RADIUS_M, areaRadiusM: 1500, spacingM: 15, densityScale: 1, site: null as IRunwaySite | null, heightAt };
  const scatter = (o: Partial<Omit<typeof options, 'site'>> & { site?: IRunwaySite | null } = {}) => scatterForest({ ...options, ...o }).instances;

  it('is deterministic', () => {
    expect(Array.from(scatter())).toEqual(Array.from(scatter()));
  });

  it('puts trees where the field is dense and none where it is empty', () => {
    const trees = scatter();
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
    const full = scatter().length;
    const half = scatter({ densityScale: 0.5 }).length;
    expect(half).toBeLessThan(full);
    expect(scatter({ densityScale: 0 }).length).toBe(0);
  });

  it('skips water, and keeps trees off the runway', () => {
    expect(scatterForest({ ...options, heightAt: () => null }).instances.length).toBe(0);
    const trees = scatter({ site, areaRadiusM: 1800 });
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

/** Absolute body-fixed position of instance `i` in a result scattered around `from`. */
function absolute(offset: Float32Array, i: number, from: Vec3): Vec3 {
  return [offset[i] + from[0] * RADIUS_M, offset[i + 1] + from[1] * RADIUS_M, offset[i + 2] + from[2] * RADIUS_M];
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

/** Instances of two windows that lie within `within` metres of both centres, paired with B's nearest instance of the same random draw. */
function overlap(a: { centre: Vec3; result: Float32Array }, b: { centre: Vec3; result: Float32Array }, within: number) {
  // The draw is 24 bits, so a window of tens of thousands holds a few repeats: pair by draw, then by position.
  const inB = new Map<number, Vec3[]>();
  for (let i = 0; i < b.result.length; i += SCATTER_STRIDE) {
    const list = inB.get(b.result[i + 3]) ?? [];
    list.push(absolute(b.result, i, b.centre));
    inB.set(b.result[i + 3], list);
  }
  const pairs: { a: Vec3; b: Vec3 | undefined; random: number }[] = [];
  for (let i = 0; i < a.result.length; i += SCATTER_STRIDE) {
    const point = absolute(a.result, i, a.centre);
    if (arcTo(point, a.centre) > within || arcTo(point, b.centre) > within) continue;
    const candidates = inB.get(a.result[i + 3]) ?? [];
    const distance = (q: Vec3) => Math.hypot(point[0] - q[0], point[1] - q[1], point[2] - q[2]);
    const nearest = candidates.sort((p, q) => distance(p) - distance(q))[0];
    pairs.push({ a: point, b: nearest, random: a.result[i + 3] });
  }
  return pairs;
}

describe('deterministic placement (same body-fixed place, same object)', () => {
  const heightAt = (direction: Vec3) => 150 + 40 * direction[0];
  const common = { radiusM: RADIUS_M, areaRadiusM: 1200, spacingM: 12, densityScale: 1.4, site: null, heightAt };

  it('returns identical trees in the overlap of two windows with different centres', () => {
    const centreB = around(centre, 310, -170);
    const a = { centre, result: scatterForest({ ...common, centre }).instances };
    const b = { centre: centreB, result: scatterForest({ ...common, centre: centreB }).instances };
    const pairs = overlap(a, b, 850);
    expect(pairs.length).toBeGreaterThan(100);
    for (const pair of pairs) {
      expect(pair.b).toBeDefined();
      expect(Math.hypot(pair.a[0] - pair.b![0], pair.a[1] - pair.b![1], pair.a[2] - pair.b![2])).toBeLessThan(0.02);
    }
    // And nothing extra: no tree of B inside the overlap is missing from A.
    expect(overlap(b, a, 850).every((pair) => pair.b !== undefined)).toBeTrue();
  });

  it('does not depend on the window size or on a second request', () => {
    const small = scatterForest({ ...common, centre, areaRadiusM: 600 }).instances;
    const large = scatterForest({ ...common, centre, areaRadiusM: 2000 }).instances;
    const again = scatterForest({ ...common, centre, areaRadiusM: 600 }).instances;
    expect(Array.from(again)).toEqual(Array.from(small));
    const inLarge = new Set<number>();
    for (let i = 0; i < large.length; i += SCATTER_STRIDE) inLarge.add(large[i + 3]);
    for (let i = 0; i < small.length; i += SCATTER_STRIDE) expect(inLarge.has(small[i + 3])).toBeTrue();
  });

  it('is not tied to the dominant axis: a solid window anywhere on the sphere holds one object per cell', () => {
    for (const c of [[1, 0.2, 0.1], [-0.3, 0.9, 0.2], [0.1, -0.2, -1], [0.6, -0.6, 0.5], [-0.5, -0.5, -0.7]] as Vec3[]) {
      const l = Math.hypot(...c);
      const centreN: Vec3 = [c[0] / l, c[1] / l, c[2] / l];
      const result = scatterCells({ centre: centreN, radiusM: RADIUS_M, areaRadiusM: 800, spacingM: 12, seed: 4, heightAt, densityAt: () => 1 });
      const expected = (Math.PI * 800 ** 2) / 12 ** 2;
      expect(result.accepted).toBeGreaterThan(expected * 0.9);
      expect(result.accepted).toBeLessThan(expected * 1.1);
      for (let i = 0; i < result.instances.length; i += SCATTER_STRIDE) {
        expect(arcTo(absolute(result.instances, i, centreN), centreN)).toBeLessThanOrEqual(801);
      }
    }
  });

  it('holds about one candidate per cell: a solid stand is a tree every spacing, not clumps or rows', () => {
    const solid = scatterCells({
      centre,
      radiusM: RADIUS_M,
      areaRadiusM: 1000,
      spacingM: 12,
      seed: 9,
      heightAt: () => 100,
      densityAt: () => 1,
    });
    const expected = (Math.PI * 1000 ** 2) / 12 ** 2;
    expect(solid.accepted).toBeGreaterThan(expected * 0.9);
    expect(solid.accepted).toBeLessThan(expected * 1.1);
  });

  it('keeps the nearest when the buffer is short, so what is lost is the far edge', () => {
    const all = scatterForest({ ...common, centre });
    const cut = scatterForest({ ...common, centre, maxCount: 300 });
    expect(cut.accepted).toBe(all.accepted);
    expect(cut.instances.length / SCATTER_STRIDE).toBe(300);
    const kept = new Set<number>();
    let farthestKept = 0;
    for (let i = 0; i < cut.instances.length; i += SCATTER_STRIDE) {
      kept.add(cut.instances[i + 3]);
      farthestKept = Math.max(farthestKept, arcTo(absolute(cut.instances, i, centre), centre));
    }
    let nearestDropped = Infinity;
    for (let i = 0; i < all.instances.length; i += SCATTER_STRIDE) {
      if (!kept.has(all.instances[i + 3])) nearestDropped = Math.min(nearestDropped, arcTo(absolute(all.instances, i, centre), centre));
    }
    expect(nearestDropped).toBeGreaterThanOrEqual(farthestKept - 0.01);
  });

  it('gives each class its own draws: a rock cell is not a tree cell', () => {
    expect(cellHash(5, 6, 7, 8)).not.toBe(cellHash(5, 6, 7, 16));
    expect(cellHash(5, 6, 7, 8)).toBe(cellHash(5, 6, 7, 8));
    let min = 1;
    let max = 0;
    for (let i = 0; i < 500; i += 1) {
      const h = cellHash(i, -i * 7, i * 13, 3);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(min).toBeLessThan(0.05);
    expect(max).toBeGreaterThan(0.95);
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
    expect(a.instances.length / SCATTER_STRIDE).toBeGreaterThan(20);
    expect(Array.from(scatterRocks(options).instances)).toEqual(Array.from(a.instances));
    const shifted = around(centre, 200, 150);
    const b = scatterRocks({ ...options, centre: shifted });
    const inB = new Set<number>();
    for (let i = 0; i < b.instances.length; i += SCATTER_STRIDE) inB.add(b.instances[i + 3]);
    let checked = 0;
    for (let i = 0; i < a.instances.length; i += SCATTER_STRIDE) {
      const point = absolute(a.instances, i, centre);
      if (arcTo(point, shifted) > 650 || arcTo(point, centre) > 650) continue;
      checked += 1;
      expect(inB.has(a.instances[i + 3])).toBeTrue();
    }
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
    expect(scatterRocks({ ...options, heightAt: () => null }).instances.length).toBe(0);
    const rocks = scatterRocks({ ...options, site, areaRadiusM: 1500 }).instances;
    for (let i = 0; i < rocks.length; i += SCATTER_STRIDE) {
      const [px, py, pz] = absolute(rocks, i, centre);
      const a = px * along[0] + py * along[1] + pz * along[2];
      const b = px * across[0] + py * across[1] + pz * across[2];
      const outside = Math.hypot(Math.max(Math.abs(a) - RUNWAY_LENGTH_M / 2, 0), Math.max(Math.abs(b) - 22.5, 0));
      expect(outside).toBeGreaterThanOrEqual(RUNWAY_APRON_M - 5);
    }
  });
});
