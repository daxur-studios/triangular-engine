import { generateIslandHeightfield } from './island-heightfield';
import { NavFlag } from './nav-flags';
import { NavGrid } from './nav-grid';

describe('generateIslandHeightfield', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = generateIslandHeightfield({ size: 96, seed: 7 });
    const b = generateIslandHeightfield({ size: 96, seed: 7 });
    const c = generateIslandHeightfield({ size: 96, seed: 8 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.heights)).not.toEqual(Array.from(c.heights));
  });

  it('makes an island: water at the border, land in the middle', () => {
    const f = generateIslandHeightfield({ size: 256 });
    expect(f.heights[0]).toBeLessThanOrEqual(f.waterLevel ?? 0);
    expect(f.heights[128 * 256 + 128]).toBeGreaterThan(f.waterLevel ?? 0);
    const grid = NavGrid.fromHeightfield(f);
    let land = 0;
    let steep = 0;
    for (let i = 0; i < grid.flags.length; i++) {
      if (!(grid.flags[i] & NavFlag.WATER)) land++;
      if (grid.flags[i] & NavFlag.STEEP) steep++;
    }
    expect(land / grid.flags.length).toBeGreaterThan(0.2);
    expect(land / grid.flags.length).toBeLessThan(0.85);
    expect(steep).toBeGreaterThan(0);
    expect(steep).toBeLessThan(land * 0.5);
  });

  it('builds a 2,048 x 2,048 grid and records the time', () => {
    const t0 = performance.now();
    const f = generateIslandHeightfield({ size: 2048 });
    const t1 = performance.now();
    const grid = NavGrid.fromHeightfield(f);
    const t2 = performance.now();
    grid.stampStructure({ x: 1000, y: 1000, width: 12, height: 8 });
    const t3 = performance.now();
    console.log(
      `[crowd-navigation] 2048x2048: generate ${(t1 - t0).toFixed(0)} ms, ` +
        `build (terrain+flags+cost+clearance) ${(t2 - t1).toFixed(0)} ms, ` +
        `windowed edit ${(t3 - t2).toFixed(2)} ms`,
    );
    expect(grid.cost.length).toBe(2048 * 2048);
    expect(t2 - t1).toBeLessThan(30000);
  }, 120000);
});
