import { DataTexture } from 'three';
import { vec3 } from 'three/tsl';
import { buildCellPlanetWorld, type ICellPlanetWorld } from 'triangular-engine/worldgen';
import { buildShapeOpIndex } from '../shape-ops/op-index';
import { compileShapeOps, shapeOpsBounds, validateShapeOp, type AltitudeBand, type V3 } from '../shape-ops/shape-op';
import {
  bakeCellPlanet, cellBakeDirection, cellBakeNode, cellData, createCellBakeTexture, isMountainCell, sampleCellBake, type CellBake,
} from './cell-bake';
import { multiCellRidges, singleCellMountains } from './shape-programs';

const RADIUS = 64_000;
const SEED = 7;

let world: ICellPlanetWorld;
let bake: CellBake;

beforeAll(() => {
  world = buildCellPlanetWorld({ cellCount: 600, seed: SEED });
  bake = bakeCellPlanet(world, { resolution: 48 });
});

function nearestCell(d: V3): number {
  let best = 0;
  let bestDot = -2;
  for (const cell of world.graph.cells) {
    const dot = cell.center.x * d[0] + cell.center.y * d[1] + cell.center.z * d[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = cell.id;
    }
  }
  return best;
}

describe('cell bake', () => {
  it('has the documented layout and finite values', () => {
    expect(bake.size).toBe(50);
    expect(bake.data.length).toBe(50 * 50 * 6 * 4);
    for (let i = 0; i < bake.data.length; i += 4) {
      expect(Number.isFinite(bake.data[i])).toBeTrue();
      expect(bake.data[i + 1]).toBeGreaterThanOrEqual(-1e-6);
      expect(bake.data[i + 1]).toBeLessThanOrEqual(1 + 1e-6);
      expect(bake.data[i + 2]).toBeGreaterThanOrEqual(bake.data[i] - 1e-3);
    }
  });

  it('reproduces a texel value at the texel centre', () => {
    for (const [face, i, j] of [[0, 10, 20], [3, 1, 1], [5, 48, 30]]) {
      const d = cellBakeDirection(face, ((i - 1 + 0.5) / 48) * 2 - 1, ((j - 1 + 0.5) / 48) * 2 - 1);
      const s = sampleCellBake(bake, d);
      const at = ((face * bake.size + j) * bake.size + i) * 4;
      expect(s.baseHeightM).toBeCloseTo(bake.data[at], 3);
      expect(s.biome).toBeCloseTo(bake.data[at + 1], 5);
      expect(s.maxHeightM).toBeCloseTo(bake.data[at + 2], 3);
    }
  });

  it('blends: some texels sit strictly between the two biomes', () => {
    expect(bake.data.some((_, k) => k % 4 === 1 && bake.data[k] > 0.05 && bake.data[k] < 0.95)).toBeTrue();
  });

  it('has no steps: a small move changes the values by a small amount, across cell borders and face edges', () => {
    let worstHeight = 0;
    let worstBiome = 0;
    const step = 1e-3;
    for (let n = 0; n < 4000; n++) {
      // Golden-spiral directions cover every face, edge and corner.
      const z = 1 - (2 * (n + 0.5)) / 4000;
      const r = Math.sqrt(1 - z * z);
      const a = n * 2.399963229728653;
      const d: V3 = [r * Math.cos(a), r * Math.sin(a), z];
      const e: V3 = [d[0] + step * -Math.sin(a), d[1] + step * Math.cos(a), d[2]];
      const s0 = sampleCellBake(bake, d);
      const s1 = sampleCellBake(bake, e);
      worstHeight = Math.max(worstHeight, Math.abs(s1.baseHeightM - s0.baseHeightM));
      worstBiome = Math.max(worstBiome, Math.abs(s1.biome - s0.biome));
    }
    // The weights are smoothsteps over the blend width (slope at most 1.5 / width, a little more after normalising), so
    // 3 km of cell height difference moves the value by under 2.5 * 3000 / width per radian; a real step would be km.
    expect(worstHeight).toBeLessThan(((2.5 * 3000) / bake.blendRadians) * step);
    expect(worstBiome).toBeLessThan((2.5 / bake.blendRadians) * step);
  });

  it('is continuous across face edges (gutter)', () => {
    const eps = 1e-4;
    for (const t of [-0.8, -0.3, 0.1, 0.6, 0.95]) {
      const lo = sampleCellBake(bake, [1 - eps, t, 0.2]);
      const hi = sampleCellBake(bake, [t, 1 + eps, 0.2]);
      const nearX = sampleCellBake(bake, [1, t, 0.2]);
      expect(Math.abs(nearX.baseHeightM - lo.baseHeightM)).toBeLessThan(5);
      expect(Number.isFinite(hi.baseHeightM)).toBeTrue();
    }
    // Direct seam check: the same point just inside either face of the x/y edge.
    const a = sampleCellBake(bake, [0.7071, 0.7072, 0.1]);
    const b = sampleCellBake(bake, [0.7072, 0.7071, 0.1]);
    expect(Math.abs(a.baseHeightM - b.baseHeightM)).toBeLessThan(5);
  });

  it('agrees with the nearest cell where the blend has no neighbour in reach', () => {
    const data = cellData(world);
    let worst = 0;
    for (let n = 0; n < 200; n++) {
      const z = 1 - (2 * (n + 0.5)) / 200;
      const r = Math.sqrt(1 - z * z);
      const d: V3 = [r * Math.cos(n * 2.4), r * Math.sin(n * 2.4), z];
      const s = sampleCellBake(bake, d);
      worst = Math.max(worst, Math.abs(s.baseHeightM - data.baseHeightM[nearestCell(d)]));
    }
    // Never farther from the nearest cell than the biggest height difference between neighbours.
    expect(worst).toBeLessThan(3000);
  });

  it('builds the TSL twin and its texture', () => {
    const texture = createCellBakeTexture(bake);
    expect(texture instanceof DataTexture).toBeTrue();
    expect(texture.image.width).toBe(bake.size);
    expect(texture.image.height).toBe(bake.size * 6);
    // Constructing the graph exercises every node call; the numbers are checked against the CPU sampler on a GPU in the lab.
    const node = cellBakeNode(texture, bake.resolution, vec3(0.3, 0.5, 0.8));
    expect(node).toBeTruthy();
    expect(node.isNode).toBeTrue();
  });
});

describe('shape programs', () => {
  const band: AltitudeBand = { bottomM: -2000, topM: 6000 };

  it('the example world has mountain cells', () => {
    expect(world.graph.cells.filter((c) => isMountainCell(world, c.id)).length).toBeGreaterThan(2);
  });

  it('single-cell mountains: one valid cone per mountain cell, deterministic', () => {
    const ops = singleCellMountains(world, 1, { radiusM: RADIUS });
    const mountains = world.graph.cells.filter((c) => isMountainCell(world, c.id));
    expect(ops.length).toBe(mountains.length);
    ops.forEach((op) => {
      validateShapeOp(op);
      expect(op.shape.kind).toBe('cone');
    });
    expect(new Set(ops.map((op) => op.id)).size).toBe(ops.length);
    expect(JSON.stringify(singleCellMountains(world, 1, { radiusM: RADIUS }))).toBe(JSON.stringify(ops));
    expect(JSON.stringify(singleCellMountains(world, 2, { radiusM: RADIUS }))).not.toBe(JSON.stringify(ops));
  });

  it('multi-cell ridges: valid paths along mountain cell edges, with craters and discs', () => {
    const ops = multiCellRidges(world, 1, { radiusM: RADIUS });
    expect(ops.length).toBeGreaterThan(0);
    ops.forEach(validateShapeOp);
    const paths = ops.filter((op) => op.shape.kind === 'path');
    expect(paths.length).toBeGreaterThan(0);
    expect(ops.some((op) => op.shape.kind === 'disc')).toBeTrue();
    expect(new Set(ops.map((op) => op.id)).size).toBe(ops.length);
    // Every path point is a corner shared by mountain cells at the body radius.
    for (const op of paths) {
      if (op.shape.kind !== 'path') continue;
      for (const p of op.shape.points) expect(Math.hypot(...p)).toBeCloseTo(RADIUS, 0);
    }
  });

  it('compiles and indexes: tiles list only the ops that reach them', () => {
    for (const program of [singleCellMountains, multiCellRidges]) {
      const ops = program(world, 3, { radiusM: RADIUS });
      const compiled = compileShapeOps(ops, RADIUS);
      expect(compiled.ops.length).toBe(ops.length);
      const index = buildShapeOpIndex(shapeOpsBounds(ops, RADIUS, band), band, 32);
      expect(index.stats.tiles).toBe(6 * 32 * 32);
      expect(index.stats.entries).toBeGreaterThanOrEqual(ops.length);
      expect(index.stats.maxPerTile).toBeLessThan(ops.length);
      // Indexed evaluation equals full evaluation.
      const d: V3 = ops[0].shape.kind === 'cone' ? ops[0].shape.centre : [RADIUS, 0, 0];
      const length = Math.hypot(...d);
      const unitDir: V3 = [d[0] / length, d[1] / length, d[2] / length];
      const p: V3 = [unitDir[0] * (RADIUS + 10), unitDir[1] * (RADIUS + 10), unitDir[2] * (RADIUS + 10)];
      expect(compiled.apply(0, p, 0, index.opsAt(unitDir))).toBe(compiled.apply(0, p));
    }
  });
});
