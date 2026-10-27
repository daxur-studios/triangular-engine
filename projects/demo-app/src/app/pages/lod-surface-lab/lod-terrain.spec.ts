import { validateTestHistory } from 'triangular-engine/testing';
import { buildCellPlanetWorld } from 'triangular-engine/worldgen';
import { biomePathView, poseView, resolveCamera, type PoseId } from './lod-camera';
import { domainPreset, type CubeWarp, type DomainKind, type DomainPresetId } from './lod-domain';
import { sourceSupports, type HeightSource, type HeightSourceId } from './lod-height';
import {
  PROBE_COUNT, bakeHeights, bakeFaces, bakeSide, latticeOfPosition, latticePoint, percentile, probeLattice, sampleProbes, texelLattice, texelPoint, twinErrors,
  type BakeLayout, type BakedHeights,
} from './lod-height-bake';
import { bakeSourceFor, hash3, noiseSampler, runBake, samplerFor, valueNoise3, type BakedSourceId } from './lod-height-noise';
import {
  CELL_PLANET_CELLS, CELL_PLANET_RELAXATION, CELL_PLANET_SEED, CLIFF_AHEAD_M, CLIFF_HEIGHT_M, CLIFF_RAMP_M, cellPlanetFor, cellPlanetHeightScaleM,
  cellPlanetSampler, cellPlanetWorld, cliffHeightAt, cliffSampler, parseCellPlanet, type CellPlanetDescription,
} from './lod-height-terrain';
import { createTextureHeightSource, latticeHeightF32 } from './lod-height-texture';
import { crackExpectation, LOD_SURFACE_TEST_HISTORY, TERRAIN_CASES } from './lod-surface-tests';

const POSES: readonly PoseId[] = ['eye-2m', 'low-200m', 'mid-5km', 'horizon', 'orbit'];

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const layoutFor = (kind: DomainKind, k: number, warp: CubeWarp = 'equal-angle', sizeM = kind === 'plane' ? 100_000 : 10_000): BakeLayout => ({ kind, warp, sizeM, k });

/** A small cell planet (a few dozen cells builds in milliseconds) for specs; the suite's own is {@link cellPlanetFor}. */
const SMALL_PLANET: CellPlanetDescription = { seed: CELL_PLANET_SEED, cellCount: 120, relaxationIterations: 1, heightScaleM: 100 };

/** The value-noise blend as it was before the allocation-free rewrite: closures and all, for comparison only. */
function referenceValueNoise3(x: number, y: number, z: number, seed: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const [tx, ty, tz] = [smooth(x - fx), smooth(y - fy), smooth(z - fz)];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3((fx | 0) + dx, (fy | 0) + dy, (fz | 0) + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), tx), lerp(c(0, 1, 0), c(1, 1, 0), tx), ty),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), tx), lerp(c(0, 1, 1), c(1, 1, 1), tx), ty),
    tz,
  );
}

/** Every boundary texel of a six-face bake grouped by its exact position: the values of one position must be one value. */
function boundaryGroups(baked: BakedHeights): Map<string, number[]> {
  const side = baked.side;
  const groups = new Map<string, number[]>();
  for (let face = 0; face < baked.faces; face++) {
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        if (i > 0 && i < side - 1 && j > 0 && j < side - 1) continue;
        const p = texelPoint(baked.layout, face, i, j);
        const key = `${p[0]}|${p[1]}|${p[2]}`;
        const list = groups.get(key) ?? [];
        list.push(baked.texels[face * side * side + j * side + i]);
        groups.set(key, list);
      }
    }
  }
  return groups;
}

function expectSeamIdentical(baked: BakedHeights, k: number): void {
  const groups = boundaryGroups(baked);
  const sizes = [...groups.values()].map((values) => values.length);
  expect(sizes.filter((n) => n === 2).length).toBe(12 * (2 ** k - 1));
  expect(sizes.filter((n) => n === 3).length).toBe(8);
  for (const values of groups.values()) expect(values.every((value) => value === values[0])).toBeTrue();
}

describe('Plan 059 bake speed-up: allocation-free noise and texel positions', () => {
  it('computes value noise bit for bit like the closure form it replaced', () => {
    const random = rng(5);
    for (let n = 0; n < 2000; n++) {
      const x = (random() - 0.5) * 400;
      const y = (random() - 0.5) * 400;
      const z = (random() - 0.5) * 400;
      expect(valueNoise3(x, y, z, n % 7)).toBe(referenceValueNoise3(x, y, z, n % 7));
    }
    // Negative and exact-integer coordinates take the floor and lattice-corner paths.
    for (const [x, y, z] of [[0, 0, 0], [-1, -2, -3], [-0.5, 0.25, 7], [5, -5.5, 0]] as const) {
      expect(valueNoise3(x, y, z, 3)).toBe(referenceValueNoise3(x, y, z, 3));
    }
  });

  it('keeps value noise inside [-1, 1], equal to the lattice hash at a lattice point, and continuous', () => {
    const random = rng(9);
    for (let n = 0; n < 500; n++) {
      const x = (random() - 0.5) * 100;
      const y = (random() - 0.5) * 100;
      const z = (random() - 0.5) * 100;
      const v = valueNoise3(x, y, z, 2);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      // Quintic blend of values in [-1, 1]: the slope is at most 15/8 * 2 per unit, so a 1e-4 step moves it by under 4e-4.
      expect(Math.abs(valueNoise3(x + 1e-4, y, z, 2) - v)).toBeLessThan(4e-4);
      expect(Math.abs(valueNoise3(x, y + 1e-4, z, 2) - v)).toBeLessThan(4e-4);
      expect(Math.abs(valueNoise3(x, y, z + 1e-4, 2) - v)).toBeLessThan(4e-4);
    }
    expect(valueNoise3(3, -4, 5, 1)).toBe(hash3(3, -4, 5, 1));
  });

  for (const warp of ['equal-angle', 'none'] as const) {
    it(`gives a texel centre the same position through the table as through the general lattice point (${warp})`, () => {
      for (const kind of ['plane', 'sphere'] as const) {
        const layout = layoutFor(kind, 5, warp, 10_000);
        const unit = texelLattice(5);
        for (let face = 0; face < bakeFaces(kind); face++) {
          for (let j = 0; j <= 32; j++) {
            for (let i = 0; i <= 32; i++) {
              expect(texelPoint(layout, face, i, j)).toEqual(latticePoint(layout, face, i * unit, j * unit));
            }
          }
        }
      }
    });
  }

  it('bakes one face at a modest size deterministically, every texel the sampler\'s value at its position', () => {
    const layout = layoutFor('sphere', 6);
    const sampler = noiseSampler(layout);
    const a = bakeHeights(layout, sampler);
    const b = bakeHeights(layout, noiseSampler(layout));
    expect(a.texels.every((value, n) => Object.is(value, b.texels[n]))).toBeTrue();
    const side = bakeSide(6);
    const unit = texelLattice(6);
    for (const face of [0, 3]) {
      for (let n = 0; n < 200; n++) {
        const i = (n * 7) % side;
        const j = (n * 13) % side;
        const p = latticePoint(layout, face, i * unit, j * unit);
        expect(a.texels[face * side * side + j * side + i]).toBe(Math.fround(sampler(p[0], p[1], p[2])));
      }
    }
    expectSeamIdentical(a, 6);
    expect(a.bakeMsPerFace.length).toBe(6);
  });
});

describe('Plan 059 cell planet source', () => {
  it('describes the planet as plain data with a height scale per sphere, and round-trips it', () => {
    expect(cellPlanetHeightScaleM(10_000)).toBe(150);
    expect(cellPlanetHeightScaleM(600_000)).toBe(1200);
    const description = cellPlanetFor(600_000);
    expect(description).toEqual({ seed: CELL_PLANET_SEED, cellCount: CELL_PLANET_CELLS, relaxationIterations: CELL_PLANET_RELAXATION, heightScaleM: 1200 });
    expect(parseCellPlanet(JSON.parse(JSON.stringify(description)))).toEqual(description);
    expect(parseCellPlanet(structuredClone(description))).toEqual(description);
    for (const bad of [null, 3, {}, { ...description, cellCount: 3 }, { ...description, heightScaleM: Number.NaN }, { ...description, heightScaleM: -1 }, { ...description, seed: 1.5 }]) {
      expect(() => parseCellPlanet(bad)).toThrowError(/cell planet description/);
    }
  });

  it('builds one world per description and shares it between height scales, timing the build once', () => {
    let clock = 0;
    const now = () => (clock += 5);
    const description: CellPlanetDescription = { seed: 91, cellCount: 80, relaxationIterations: 1, heightScaleM: 10 };
    const first = cellPlanetWorld(description, now);
    expect(first.buildMs).toBe(5);
    expect(cellPlanetWorld(description, now)).toBe(first);
    expect(cellPlanetWorld({ ...description, heightScaleM: 99 }, now)).toBe(first);
    expect(cellPlanetWorld({ ...description, seed: 92 }, now)).not.toBe(first);
  });

  it('builds the same world and the same heights from the same description', () => {
    const a = buildCellPlanetWorld({ cellCount: SMALL_PLANET.cellCount, seed: SMALL_PLANET.seed, relaxationIterations: SMALL_PLANET.relaxationIterations });
    const b = cellPlanetWorld(SMALL_PLANET).world;
    const sa = cellPlanetSampler(a, 100);
    const sb = cellPlanetSampler(b, 100);
    const random = rng(3);
    for (let n = 0; n < 300; n++) {
      const x = random() - 0.5;
      const y = random() - 0.5;
      const z = random() - 0.5;
      expect(sa(x, y, z)).toBe(sb(x, y, z));
    }
  });

  it('is the surface sampler\'s elevation above sea level times the scale, whatever cell the walk started in', () => {
    const { world } = cellPlanetWorld(SMALL_PLANET);
    const walking = cellPlanetSampler(world, SMALL_PLANET.heightScaleM);
    const random = rng(11);
    for (let n = 0; n < 400; n++) {
      // Random order and magnitudes: a hint from a faraway cell must still find the nearest one.
      const d = { x: (random() - 0.5) * 20_000, y: (random() - 0.5) * 20_000, z: (random() - 0.5) * 20_000 };
      const sample = world.sampler.sample(d);
      expect(walking(d.x, d.y, d.z)).toBe((sample.elevation - sample.seaLevel) * SMALL_PLANET.heightScaleM);
    }
  });

  it('bakes seam-identical faces with the cell planet sampler', () => {
    const layout = layoutFor('sphere', 4);
    const baked = bakeHeights(layout, bakeSourceFor('cell-planet', layout, SMALL_PLANET).sampler);
    expectSeamIdentical(baked, 4);
    const again = bakeHeights(layout, bakeSourceFor('cell-planet', layout, SMALL_PLANET).sampler);
    expect(baked.texels.every((value, n) => Object.is(value, again.texels[n]))).toBeTrue();
    expect(baked.maxM - baked.minM).toBeGreaterThan(1);
  });

  it('is a sphere source: the plane is refused, the world build is reported', () => {
    expect(() => samplerFor('cell-planet', layoutFor('plane', 4), SMALL_PLANET)).toThrowError(/sphere/);
    expect(sourceSupports('cell-planet', 'plane')).toBeFalse();
    expect(sourceSupports('cell-planet', 'sphere')).toBeTrue();
    expect(sourceSupports('cliff', 'plane')).toBeTrue();
    const output = runBake('cell-planet', layoutFor('sphere', 3), SMALL_PLANET);
    expect(output.worldBuildMs).toBeGreaterThanOrEqual(0);
    expect(output.probes.direct.length).toBe(PROBE_COUNT);
    expect(runBake('noise', layoutFor('sphere', 3)).worldBuildMs).toBeUndefined();
  });

  it('puts the poses\' ground point on land, so every pose looks at real relief', () => {
    for (const sizeM of [10_000, 600_000]) {
      const description = cellPlanetFor(sizeM);
      const sampler = cellPlanetSampler(cellPlanetWorld(description).world, description.heightScaleM);
      const domain = domainPreset(sizeM === 10_000 ? 'sphere-10km' : 'sphere-600km');
      const [x, y, z] = poseView('eye-2m', domain).ground;
      expect(sampler(x, y, z)).toBeGreaterThan(0.1 * description.heightScaleM);
    }
  });
});

describe('Plan 059 cliff source', () => {
  it('is a C1 smoothstep: 0 below the ramp, half the step in the middle, 200 m above, steepest in the middle', () => {
    expect(cliffHeightAt(-CLIFF_RAMP_M / 2)).toBe(0);
    expect(cliffHeightAt(-500)).toBe(0);
    expect(cliffHeightAt(0)).toBe(CLIFF_HEIGHT_M / 2);
    expect(cliffHeightAt(CLIFF_RAMP_M / 2)).toBe(CLIFF_HEIGHT_M);
    expect(cliffHeightAt(5000)).toBe(CLIFF_HEIGHT_M);
    const steepest = (CLIFF_HEIGHT_M * 1.5) / CLIFF_RAMP_M;
    let previous = cliffHeightAt(-20);
    for (let s = -19.9; s <= 20; s += 0.1) {
      const h = cliffHeightAt(s);
      expect(h).toBeGreaterThanOrEqual(previous);
      expect(h - previous).toBeLessThanOrEqual(steepest * 0.1 + 1e-9);
      previous = h;
    }
  });

  it('stands a 200 m step across the whole plane, 100 m ahead of the poses, constant across the heading', () => {
    const layout = layoutFor('plane', 6);
    const sampler = cliffSampler(layout);
    const view = poseView('eye-2m', domainPreset('plane-100km'));
    const [gx, , gz] = view.ground;
    const along = [Math.sin(view.headingRad), 0, -Math.cos(view.headingRad)];
    const at = (s: number, t = 0) => sampler(gx + s * along[0] + t * along[2] * -1, 0, gz + s * along[2] + t * along[0]);
    expect(at(0)).toBe(0);
    expect(at(CLIFF_AHEAD_M - 15)).toBe(0);
    expect(at(CLIFF_AHEAD_M)).toBeCloseTo(100, 6);
    expect(at(CLIFF_AHEAD_M + 15)).toBe(CLIFF_HEIGHT_M);
    expect(at(30_000)).toBe(CLIFF_HEIGHT_M);
    expect(at(-30_000)).toBe(0);
    for (const t of [-20_000, -3_000, 4_000, 20_000]) expect(at(CLIFF_AHEAD_M, t)).toBeCloseTo(100, 6);
    // Height does not depend on y (the plane is y = 0 but the function is of the 3D point).
    expect(sampler(gx, 50, gz)).toBe(sampler(gx, 0, gz));
  });

  it('stands the same step on a great circle of the 10 km sphere: continuous, the far hemisphere 200 m up', () => {
    const layout = layoutFor('sphere', 6);
    const sampler = cliffSampler(layout);
    const domain = domainPreset('sphere-10km');
    const view = poseView('eye-2m', domain);
    const R = domain.sizeM;
    const norm = Math.hypot(...view.ground);
    const up = view.ground.map((c) => c / norm);
    expect(sampler(up[0] * R, up[1] * R, up[2] * R)).toBe(0);
    // Walk along the great circle through the ground point in the heading direction: the step is 100 m of arc ahead.
    const walk = (angle: number): number => {
      const n = cliffAlong(view, up);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return sampler(R * (c * up[0] + s * n[0]), R * (c * up[1] + s * n[1]), R * (c * up[2] + s * n[2]));
    };
    expect(walk((CLIFF_AHEAD_M - 15) / R)).toBe(0);
    expect(walk(CLIFF_AHEAD_M / R)).toBeCloseTo(100, 1);
    expect(walk((CLIFF_AHEAD_M + 15) / R)).toBe(CLIFF_HEIGHT_M);
    expect(walk(Math.PI / 2)).toBe(CLIFF_HEIGHT_M);
    expect(walk(-Math.PI / 2)).toBe(0);
    expect(walk(Math.PI)).toBe(CLIFF_HEIGHT_M);
    let previous = walk(0);
    let rises = 0;
    for (let metres = 1; metres <= 400; metres++) {
      const h = walk(metres / R);
      expect(Math.abs(h - previous)).toBeLessThanOrEqual(15.1);
      if (h > previous) rises++;
      previous = h;
    }
    expect(rises).toBeGreaterThan(15);
    expect(rises).toBeLessThan(25);
  });

  it('keeps every pose above the ground it looks at, on every source and domain the suite uses', () => {
    for (const { source, domains } of TERRAIN_CASES) {
      for (const id of domains) {
        const domain = domainPreset(id);
        const sizeM = domain.sizeM;
        const layout = layoutFor(domain.kind, 5, domain.warp, sizeM);
        const sampler = bakeSourceFor(source as BakedSourceId, layout, source === 'cell-planet' ? cellPlanetFor(sizeM) : undefined).sampler;
        const height = { id: source, boundM: 0, heightAt: sampler } as unknown as HeightSource;
        for (const pose of POSES) {
          const camera = resolveCamera(poseView(pose, domain), domain, height);
          expect(camera.clearanceM).toBeGreaterThanOrEqual(poseView(pose, domain).altitudeM - 1e-6);
          expect(Number.isFinite(camera.position[0] + camera.position[1] + camera.position[2])).toBeTrue();
        }
      }
    }
  });
});

/** The unit heading direction of the poses at ground direction `up` on a sphere (north cos h + east sin h). */
function cliffAlong(view: ReturnType<typeof poseView>, up: readonly number[]): number[] {
  const reference = Math.abs(up[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map((c) => c / l); };
  const east = unit(cross(reference, up));
  const north = cross(up, east);
  return [0, 1, 2].map((k) => Math.cos(view.headingRad) * north[k] + Math.sin(view.headingRad) * east[k]);
}

describe('Plan 059 biome mix', () => {
  for (const kind of ['plane', 'sphere'] as const) {
    it(`bakes deterministically within bounds on ${kind}`, () => {
      const layout = layoutFor(kind, 6);
      const a = runBake('biome-mix', layout).baked;
      const b = runBake('biome-mix', layout).baked;
      expect(a.texels.every((h, i) => h === b.texels[i] && Number.isFinite(h))).toBeTrue();
      expect(a.minM).toBeGreaterThanOrEqual(-3);
      expect(a.maxM).toBeLessThanOrEqual(kind === 'plane' ? 2000 : 600);
      expect(a.boundM).toBeGreaterThanOrEqual(Math.max(Math.abs(a.minM), Math.abs(a.maxM)));
      if (kind === 'sphere') expectSeamIdentical(a, 6);
      else {
        const sampler = samplerFor('biome-mix', layout);
        for (let i = 0; i <= 64; i++) {
          const p = texelPoint(layout, 0, i, 32);
          expect(a.texels[32 * a.side + i]).toBe(Math.fround(sampler(...p)));
        }
      }
    });
    it(`places meadow, hills, ridges, crater and canyon at their coordinates on ${kind}`, () => {
      const layout = layoutFor(kind, 10);
      const sample = samplerFor('biome-mix', layout);
      const at = (u: number, v: number) => kind === 'plane'
        ? sample(u * layout.sizeM, 0, v * layout.sizeM)
        : sample(layout.sizeM * Math.cos(1.8 * v) * Math.sin(1.8 * u), layout.sizeM * Math.sin(1.8 * v), layout.sizeM * Math.cos(1.8 * v) * Math.cos(1.8 * u));
      const scale = kind === 'plane' ? 2000 : 600;
      expect(Math.abs(at(-0.4, 0.02))).toBeLessThan(4);
      expect(at(-0.2, 0)).toBeGreaterThan(0.01 * scale);
      expect(Math.max(...Array.from({ length: 101 }, (_, i) => at(-0.05 + i * 0.001, 0)))).toBeGreaterThan(0.7 * scale);
      expect(at(0.2, 0)).toBeLessThan(at(0.2, 0.03));
      const centre = 0.055 * Math.sin(24 * 0.4);
      expect(at(0.4, centre)).toBeLessThan(at(0.4, centre + 0.05));
    });
  }

  it('traverses all five region centres on both domains', () => {
    for (const id of ['plane-100km', 'sphere-10km'] as const) {
      const domain = domainPreset(id);
      for (let i = 0; i < 5; i++) {
        const ground = biomePathView(domain, i / 4).ground;
        const u = domain.kind === 'plane' ? ground[0] / domain.sizeM : Math.atan2(ground[0], ground[2]) / 1.8;
        expect(u).toBeCloseTo(-0.4 + 0.2 * i, 10);
      }
    }
  });

  it('lists the two alternating geometry comparisons in v5', () => {
    const suite = LOD_SURFACE_TEST_HISTORY.find((item) => item.id === 'lod-surface-terrain' && item.version === 5)!;
    expect(suite.scenarios.filter((item) => item.id.startsWith('biome-cap-')).map((item) => item.settings.leafCap)).toEqual([1024, 512, 1024, 512]);
    expect(suite.scenarios.filter((item) => item.id.startsWith('biome-cells-')).map((item) => item.settings.patchCells)).toEqual([32, 16, 32, 16]);
    expect(suite.scenarios.some((item) => item.id.startsWith('biome-mix-floor-'))).toBeFalse();
  });

  it('lists both domains, all baseline poses, traversals, targets and the alternating floor cases in v4', () => {
    const suite = LOD_SURFACE_TEST_HISTORY.find((item) => item.id === 'lod-surface-terrain' && item.version === 4)!;
    for (const domain of ['plane-100km', 'sphere-10km']) {
      for (const pose of [...POSES, 'biome-mountain', 'biome-canyon']) expect(suite.scenarios.some((item) => item.id === `biome-mix-${domain}-${pose}`)).toBeTrue();
      expect(suite.scenarios.find((item) => item.id === `biome-mix-${domain}-traverse`)?.settings.motion).toBe('biome-sweep');
    }
    expect(suite.scenarios.filter((item) => item.id.startsWith('biome-mix-floor-')).map((item) => item.settings.cellPixels)).toEqual([2, 4, 2, 4]);
  });
});

describe('Plan 059 CPU twin error metric', () => {
  it('takes nearest-rank percentiles', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([4], 0.95)).toBe(4);
    const values = Array.from({ length: 100 }, (_, n) => 100 - n);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile(values, 1)).toBe(100);
    expect(percentile(values, 0)).toBe(1);
  });

  it('spreads deterministic probes over the faces, none on a texel centre, and maps them back to their lattice points', () => {
    for (const kind of ['plane', 'sphere'] as const) {
      const layout = layoutFor(kind, 10);
      const probes = probeLattice(layout);
      expect(probes).toEqual(probeLattice(layout));
      expect(probes.face.length).toBe(PROBE_COUNT);
      const unit = texelLattice(10);
      for (let n = 0; n < PROBE_COUNT; n++) {
        expect(probes.u[n] % unit).not.toBe(0);
        expect(probes.v[n] % unit).not.toBe(0);
        const p = latticePoint(layout, probes.face[n], probes.u[n], probes.v[n]);
        const back = { face: 0, u: 0, v: 0 };
        latticeOfPosition(layout, p[0], p[1], p[2], back);
        expect(back.face).toBe(probes.face[n]);
        expect(Math.abs(back.u - probes.u[n])).toBeLessThan(0.5);
        expect(Math.abs(back.v - probes.v[n])).toBeLessThan(0.5);
      }
      const perFace = new Set(probes.face);
      expect(perFace.size).toBe(bakeFaces(kind));
    }
  });

  it('subtracts the sampler\'s value from the twin\'s and takes the magnitude', () => {
    const layout = layoutFor('sphere', 4);
    const probes = { ...probeLattice(layout, 6), direct: [1, 2, 3, 4, 5, 6] };
    const errors = twinErrors(probes, (face, _u, _v) => [2, 2, 1, 4, 9, 6][face]);
    expect(errors).toEqual([1, 0, 2, 0, 4, 0]);
  });

  it('is within float32 rounding at texel centres and the interpolation error between them', () => {
    const layout = layoutFor('sphere', 7);
    const sampler = noiseSampler(layout);
    const baked = bakeHeights(layout, sampler);
    const unit = texelLattice(7);
    // Probes placed on texel centres: the twin returns the texel, the texel is the float32 of the sampler.
    const onTexels = { face: [0, 1, 2, 3, 4, 5], u: [3, 17, 60, 101, 5, 128].map((n) => n * unit), v: [9, 40, 33, 2, 127, 64].map((n) => n * unit) };
    const direct = onTexels.face.map((face, n) => {
      const p = latticePoint(layout, face, onTexels.u[n], onTexels.v[n]);
      return sampler(p[0], p[1], p[2]);
    });
    const exact = twinErrors({ ...onTexels, direct }, (face, u, v) => latticeHeightF32(baked, face, u, v));
    for (const error of exact) expect(error).toBeLessThan(1e-4);
    // Off the texels the error is the interpolation error: finite, small against the 300 m amplitude, and not zero.
    const probes = sampleProbes(layout, sampler);
    const errors = twinErrors(probes, (face, u, v) => latticeHeightF32(baked, face, u, v));
    expect(errors.length).toBe(PROBE_COUNT);
    expect(errors.every(Number.isFinite)).toBeTrue();
    expect(Math.max(...errors)).toBeGreaterThan(0);
    expect(percentile(errors, 0.95)).toBeLessThan(0.25 * 300);
  });

  it('shows the cliff\'s stretch: on a coarse texture the bilinear ramp differs from the 20 m one by a large share of the step', () => {
    const layout = layoutFor('plane', 8);
    const sampler = cliffSampler(layout);
    const { baked } = runBake('cliff', layout);
    const view = poseView('eye-2m', domainPreset('plane-100km'));
    const along = [Math.sin(view.headingRad), 0, -Math.cos(view.headingRad)];
    let widest = 0;
    for (let metres = -400; metres <= 400; metres += 2) {
      const x = view.ground[0] + (CLIFF_AHEAD_M + metres) * along[0];
      const z = view.ground[2] + (CLIFF_AHEAD_M + metres) * along[2];
      const where = { face: 0, u: 0, v: 0 };
      latticeOfPosition(layout, x, 0, z, where);
      widest = Math.max(widest, Math.abs(latticeHeightF32(baked, 0, where.u, where.v) - sampler(x, 0, z)));
    }
    expect(widest).toBeGreaterThan(20);
  });
});

describe('Plan 059 suite lod-surface-terrain', () => {
  const history = LOD_SURFACE_TEST_HISTORY;
  const latest = history[history.length - 1];
  /** Terrain v1 as it was shared: the same 36 cases, single-threshold selection. */
  const terrain = history.find((suite) => suite.id === 'lod-surface-terrain' && suite.version === 1)!;

  it('is the last entry after the untouched baseline versions, and a valid history', () => {
    expect(history.map((suite) => `${suite.id}@${suite.version}`)).toEqual([
      'lod-surface-baseline@1', 'lod-surface-baseline@2', 'lod-surface-baseline@3', 'lod-surface-baseline@4', 'lod-surface-terrain@1', 'lod-surface-terrain@2', 'lod-surface-terrain@3', 'lod-surface-terrain@4', 'lod-surface-terrain@5',
    ]);
    expect(() => validateTestHistory(history)).not.toThrow();
    expect(terrain.purpose).toBe('performance');
    expect(latest.id).toBe('lod-surface-terrain');
    expect(latest.purpose).toBe('performance');
  });

  it('groups the terrain v2 sweep cases with the cases of their source and domain', () => {
    const v3 = history.find((suite) => suite.id === 'lod-surface-terrain' && suite.version === 3)!;
    const keys = v3.scenarios.map((scenario) => `${scenario.settings.source}|${scenario.settings.domain}`);
    const runs = keys.filter((key, n) => n === 0 || key !== keys[n - 1]);
    expect(new Set(runs).size).toBe(runs.length);
    expect(v3.scenarios.length).toBe(terrain.scenarios.length + 2);
    for (const scenario of v3.scenarios.filter((item) => item.settings.motion === 'sweep')) {
      expect(sourceSupports(scenario.settings.source as HeightSourceId, domainPreset(scenario.settings.domain as DomainPresetId).kind)).toBeTrue();
    }
  });

  it('has 36 cases: every source on every domain it suits at the five poses, plus one injected-gap control', () => {
    const ids = terrain.scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(36);
    for (const { source, domains } of TERRAIN_CASES.filter((entry) => entry.source !== 'biome-mix')) {
      for (const domain of domains) for (const pose of POSES) expect(ids).toContain(`${source}-${domain}-${pose}`);
    }
    const controls = terrain.scenarios.filter((scenario) => crackExpectation(scenario.settings) === 'some');
    expect(controls.map((scenario) => scenario.id)).toEqual(['control-injected-gap']);
    expect(controls[0].settings.source).toBe('noise');
    for (const scenario of terrain.scenarios) {
      expect(JSON.parse(JSON.stringify(scenario.settings))).toEqual(scenario.settings);
      expect(['cell-planet', 'noise', 'cliff']).toContain(scenario.settings.source);
      const kind = domainPreset(scenario.settings.domain as DomainPresetId).kind;
      expect(sourceSupports(scenario.settings.source as HeightSourceId, kind)).toBeTrue();
    }
  });

  it('groups cases so each source and domain is one run of consecutive cases (one bake each with a two-entry cache)', () => {
    const keys = terrain.scenarios.map((scenario) => `${scenario.settings.source}|${scenario.settings.domain}`);
    const runs = keys.filter((key, n) => n === 0 || key !== keys[n - 1]);
    expect(new Set(runs).size).toBe(runs.length);
    expect(runs.length).toBe(TERRAIN_CASES.filter((entry) => entry.source !== 'biome-mix').reduce((sum, entry) => sum + entry.domains.length, 0));
  });
});

describe('Plan 059 terrain bake: the sources through the shared texture path', () => {
  it('makes a texture source from each terrain bake, with a bound that covers its texels', () => {
    for (const { source, domains } of TERRAIN_CASES) {
      const domain = domainPreset(domains[0]);
      const layout = layoutFor(domain.kind, 4, domain.warp, domain.sizeM);
      const planet = source === 'cell-planet' ? SMALL_PLANET : undefined;
      const { baked } = runBake(source as BakedSourceId, layout, planet);
      const texture = createTextureHeightSource(source as HeightSourceId, baked);
      expect(texture.boundM).toBeGreaterThanOrEqual(Math.max(Math.abs(baked.minM), Math.abs(baked.maxM)));
      texture.dispose();
    }
  });
});
