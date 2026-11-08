import { NAV_CLEARANCE_THRESHOLDS, NavFlag } from './nav-flags';
import { NavGrid } from './nav-grid';
import type { NavHeightfield } from './nav-types';

function flatField(width: number, height: number, h = 5): NavHeightfield {
  return { width, height, cellSize: 1, heights: new Float32Array(width * height).fill(h), waterLevel: 0 };
}

function rampField(width: number, height: number, slope: number): NavHeightfield {
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) heights[y * width + x] = 5 + x * slope;
  return { width, height, cellSize: 1, heights, waterLevel: 0 };
}

describe('NavGrid terrain cost', () => {
  it('gives flat ground the base cost and no flags', () => {
    const grid = NavGrid.fromHeightfield(flatField(16, 16));
    const i = 8 * 16 + 8;
    expect(grid.terrain[i]).toBe(16);
    expect(grid.cost[i]).toBe(16);
    expect(grid.flags[i]).toBe(0);
  });

  it('raises the cost with slope, then blocks too-steep cells', () => {
    const gentle = NavGrid.fromHeightfield(rampField(16, 16, 0.2));
    const hilly = NavGrid.fromHeightfield(rampField(16, 16, 0.5));
    const cliff = NavGrid.fromHeightfield(rampField(16, 16, 1.0));
    const i = 8 * 16 + 8;
    expect(gentle.terrain[i]).toBeGreaterThan(16);
    expect(hilly.terrain[i]).toBeGreaterThan(gentle.terrain[i]);
    expect(hilly.terrain[i]).toBeLessThan(255);
    expect(cliff.terrain[i]).toBe(255);
    expect(cliff.flags[i] & NavFlag.STEEP).toBeTruthy();
    expect(cliff.flags[i] & NavFlag.BLOCKED).toBeTruthy();
    expect(cliff.cost[i]).toBe(255);
    expect(hilly.flags[i] & NavFlag.BLOCKED).toBe(0);
  });

  it('blocks water by level and by mask', () => {
    const f = flatField(16, 16);
    f.heights[3 * 16 + 3] = -1;
    const mask = new Uint8Array(16 * 16);
    mask[5 * 16 + 5] = 1;
    const grid = NavGrid.fromHeightfield({ ...f, waterMask: mask });
    for (const [x, y] of [
      [3, 3],
      [5, 5],
    ]) {
      const i = y * 16 + x;
      expect(grid.flags[i] & NavFlag.WATER).toBeTruthy();
      expect(grid.flags[i] & NavFlag.BLOCKED).toBeTruthy();
      expect(grid.terrain[i]).toBe(255);
      expect(grid.isPassable(x, y, 'villager')).toBeFalse();
    }
    expect(grid.isPassable(10, 10, 'villager')).toBeTrue();
  });

  it('recomputes after a terrain edit', () => {
    const f = flatField(24, 24);
    const grid = NavGrid.fromHeightfield(f);
    f.heights[12 * 24 + 12] = -2;
    grid.updateTerrain({ x: 12, y: 12, width: 1, height: 1 });
    expect(grid.flags[12 * 24 + 12] & NavFlag.WATER).toBeTruthy();
    expect(grid.clearance[12 * 24 + 12]).toBe(0);
    expect(grid.flags[12 * 24 + 13] & NavFlag.STEEP).toBeTruthy(); // the pit's wall
    const fresh = NavGrid.fromHeightfield(f);
    expect(Array.from(grid.cost)).toEqual(Array.from(fresh.cost));
    expect(Array.from(grid.clearance)).toEqual(Array.from(fresh.clearance));
  });
});

describe('NavGrid layer composition', () => {
  it('lowers cost on roads, with factor 0.4 at full strength', () => {
    const grid = NavGrid.fromHeightfield(rampField(32, 32, 0.3));
    const i = 10 * 32 + 10;
    const before = grid.cost[i];
    grid.paintRoad({ x: 10, y: 10, width: 1, height: 1 });
    expect(grid.flags[i] & NavFlag.ROAD).toBeTruthy();
    expect(grid.cost[i]).toBeLessThan(before);
    expect(grid.cost[i]).toBe(Math.round(grid.terrain[i] * 0.4));
    grid.paintRoad({ x: 10, y: 10, width: 1, height: 1 }, 0);
    expect(grid.cost[i]).toBe(before);
    expect(grid.flags[i] & NavFlag.ROAD).toBe(0);
  });

  it('paints a road line', () => {
    const grid = NavGrid.fromHeightfield(flatField(32, 32));
    grid.paintRoadLine(2, 2, 29, 2, 1);
    expect(grid.cost[2 * 32 + 15]).toBeLessThan(16);
    expect(grid.cost[10 * 32 + 15]).toBe(16);
  });

  it('blocks structures and sets flags, then restores them', () => {
    const grid = NavGrid.fromHeightfield(flatField(32, 32));
    grid.stampStructure({ x: 10, y: 10, width: 4, height: 3 });
    const i = 11 * 32 + 11;
    expect(grid.cost[i]).toBe(255);
    expect(grid.flags[i] & NavFlag.STRUCTURE).toBeTruthy();
    expect(grid.flags[i] & NavFlag.BLOCKED).toBeTruthy();
    expect(grid.clearance[i]).toBe(0);
    expect(grid.clearance[11 * 32 + 14]).toBe(1);
    grid.clearStructure({ x: 10, y: 10, width: 4, height: 3 });
    expect(grid.cost[i]).toBe(16);
    expect(grid.flags[i]).toBe(0);
    expect(grid.clearance[i]).toBe(16);
  });

  it('stamps a masked footprint only on masked cells', () => {
    const grid = NavGrid.fromHeightfield(flatField(16, 16));
    grid.stampStructure({ x: 4, y: 4, width: 2, height: 2, mask: Uint8Array.of(1, 0, 0, 1) });
    expect(grid.structure[4 * 16 + 4]).toBe(255);
    expect(grid.structure[4 * 16 + 5]).toBe(0);
    expect(grid.structure[5 * 16 + 4]).toBe(0);
    expect(grid.structure[5 * 16 + 5]).toBe(255);
  });

  it('toggles a gate and keeps the GATE flag', () => {
    const grid = NavGrid.fromHeightfield(flatField(32, 32));
    const gate = { x: 15, y: 10, width: 2, height: 1 };
    const i = 10 * 32 + 15;
    grid.stampGate(gate);
    expect(grid.flags[i] & NavFlag.GATE).toBeTruthy();
    expect(grid.isPassable(15, 10, 'villager')).toBeFalse();
    grid.setGateOpen(gate, true);
    expect(grid.isPassable(15, 10, 'villager')).toBeTrue();
    expect(grid.flags[i] & NavFlag.GATE).toBeTruthy();
    expect(grid.flags[i] & NavFlag.BLOCKED).toBe(0);
    grid.setGateOpen(gate, false);
    expect(grid.isPassable(15, 10, 'villager')).toBeFalse();
  });

  it('applies territory as a per-faction cost only', () => {
    const grid = NavGrid.fromHeightfield(flatField(16, 16));
    grid.paintTerritory({ x: 4, y: 4, width: 4, height: 4 }, 2);
    const i = 5 * 16 + 5;
    expect(grid.flags[i] & NavFlag.TERRITORY).toBeTruthy();
    expect(grid.cost[i]).toBe(16);
    expect(grid.traversalCost(i, 2)).toBe(16);
    expect(grid.traversalCost(i, 1)).toBe(24);
    expect(grid.traversalCost(i, 0)).toBe(16);
    expect(grid.traversalCost(0, 1)).toBe(16);
  });
});

describe('NavGrid clearance and unit classes', () => {
  it('lets villagers through a 2-cell gap but not catapults or creatures', () => {
    const grid = NavGrid.fromHeightfield(flatField(40, 20));
    grid.stampStructure({ x: 0, y: 0, width: 40, height: 9 });
    grid.stampStructure({ x: 0, y: 11, width: 40, height: 9 });
    for (const y of [9, 10]) {
      expect(grid.clearance[y * 40 + 20]).toBe(1);
      expect(grid.isPassable(20, y, 'villager')).toBeTrue();
      expect(grid.isPassable(20, y, 'catapult')).toBeFalse();
      expect(grid.isPassable(20, y, 'creature')).toBeFalse();
    }
  });

  it('lets catapults through a 6-cell gap but not creatures', () => {
    const grid = NavGrid.fromHeightfield(flatField(40, 20));
    grid.stampStructure({ x: 0, y: 0, width: 40, height: 7 });
    grid.stampStructure({ x: 0, y: 13, width: 40, height: 7 });
    expect(grid.isPassable(20, 9, 'catapult')).toBeTrue();
    expect(grid.isPassable(20, 7, 'catapult')).toBeFalse();
    expect(grid.isPassable(20, 9, 'creature')).toBeFalse();
  });

  it('uses Euclidean distance and the documented thresholds', () => {
    expect(NAV_CLEARANCE_THRESHOLDS).toEqual({ villager: 1, catapult: 3, creature: 8 });
    const grid = NavGrid.fromHeightfield(flatField(40, 40));
    grid.stampStructure({ x: 0, y: 0, width: 1, height: 1 });
    expect(grid.clearance[0 * 40 + 7]).toBe(7);
    expect(grid.clearance[0 * 40 + 8]).toBe(8);
    expect(grid.clearance[6 * 40 + 6]).toBe(8);
    expect(grid.clearance[5 * 40 + 5]).toBe(7);
    expect(grid.isPassable(8, 0, 'creature')).toBeTrue();
    expect(grid.isPassable(7, 0, 'creature')).toBeFalse();
    expect(grid.clearance[30 * 40 + 30]).toBe(grid.maxClearance);
  });

  it('treats out-of-grid cells as not passable', () => {
    const grid = NavGrid.fromHeightfield(flatField(8, 8));
    expect(grid.isPassable(-1, 0, 'villager')).toBeFalse();
    expect(grid.isPassable(8, 0, 'villager')).toBeFalse();
  });

  it('keeps clearance equal to a full recompute after random edits', () => {
    let s = 12345;
    const rnd = (n: number) => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s % n;
    };
    const grid = NavGrid.fromHeightfield(flatField(90, 70));
    for (let k = 0; k < 40; k++) {
      const rect = { x: rnd(95) - 3, y: rnd(75) - 3, width: 1 + rnd(9), height: 1 + rnd(9) };
      const r = rnd(4);
      if (r === 0) grid.clearStructure(rect);
      else if (r === 1) grid.stampGate(rect, rnd(2) === 0);
      else grid.stampStructure(rect);
    }
    const fresh = NavGrid.fromHeightfield(flatField(90, 70));
    fresh.structure.set(grid.structure);
    fresh.flags.set(grid.flags);
    fresh.computeClearance();
    expect(Array.from(grid.clearance)).toEqual(Array.from(fresh.clearance));
  });

  it('validates input sizes', () => {
    expect(() =>
      NavGrid.fromHeightfield({ width: 4, height: 4, cellSize: 1, heights: new Float32Array(3) }),
    ).toThrow();
  });
});
