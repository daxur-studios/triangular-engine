import { NavFlowCache, type NavFlowDirection, type NavFlowField } from './nav-flow';
import { NavGrid } from './nav-grid';
import type { NavUnitClass } from './nav-flags';
import { NavSectorGraph } from './nav-sectors';
import type { NavHeightfield } from './nav-types';

function flatField(width: number, height: number): NavHeightfield {
  return { width, height, cellSize: 1, heights: new Float32Array(width * height).fill(5), waterLevel: 0 };
}

function openGrid(width: number, height: number, maxClearance?: number): NavGrid {
  return NavGrid.fromHeightfield(flatField(width, height), { maxClearance });
}

/** A flat grid with a wall column at `wallX` and open gaps (inclusive row ranges). */
function wallGrid(width: number, height: number, wallX: number, gaps: [number, number][]): NavGrid {
  const grid = openGrid(width, height);
  grid.stampStructure({ x: wallX, y: 0, width: 1, height });
  for (const [a, b] of gaps) grid.clearStructure({ x: wallX, y: a, width: 1, height: b - a + 1 });
  return grid;
}

/**
 * Walks from a cell centre along the sampled direction (step 0.3 cells) until close to the goal.
 * Returns the visited positions; `reached` is false when the walk ran out of steps or lost the field.
 */
function walk(
  field: NavFlowField,
  grid: NavGrid,
  unitClass: NavUnitClass,
  sx: number,
  sy: number,
): { reached: boolean; path: [number, number][] } {
  const out: NavFlowDirection = { x: 0, y: 0 };
  let x = sx + 0.5;
  let y = sy + 0.5;
  const path: [number, number][] = [[x, y]];
  for (let i = 0; i < 2000; i++) {
    if (Math.hypot(x - (field.goalX + 0.5), y - (field.goalY + 0.5)) < 1.5) return { reached: true, path };
    if (!field.sample(x, y, out)) return { reached: false, path };
    x += out.x * 0.3;
    y += out.y * 0.3;
    expect(grid.isPassable(Math.floor(x), Math.floor(y), unitClass)).withContext(`cell at ${x}, ${y}`).toBeTrue();
    path.push([x, y]);
  }
  return { reached: false, path };
}

describe('NavFlowCache field correctness', () => {
  it('points every reached cell downhill and gives blocked cells no direction', () => {
    const grid = openGrid(32, 16);
    grid.stampStructure({ x: 12, y: 2, width: 3, height: 9 }); // a building in the way
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    const cache = new NavFlowCache(graph);
    const field = cache.field(28, 8, 'villager');
    expect(cache.ensure(field, 2, 8).status).toBe('ready');
    const dir: NavFlowDirection = { x: 0, y: 0 };
    let checked = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const has = field.directionAtCell(x, y, dir);
        if (!grid.isPassable(x, y, 'villager')) {
          expect(has).withContext(`blocked ${x},${y}`).toBeFalse();
          expect(field.costAtCell(x, y)).toBe(Infinity);
          continue;
        }
        if (x === 28 && y === 8) {
          expect(field.costAtCell(x, y)).toBe(0);
          expect(has).toBeFalse();
          continue;
        }
        const here = field.costAtCell(x, y);
        expect(here).withContext(`cost ${x},${y}`).toBeLessThan(Infinity);
        expect(has).withContext(`direction ${x},${y}`).toBeTrue();
        // The neighbour best aligned with the direction must be downhill (cost below this cell's).
        let aligned = -Infinity;
        let downhill = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || !grid.isPassable(x + dx, y + dy, 'villager')) continue;
            if (dx !== 0 && dy !== 0 && (!grid.isPassable(x + dx, y, 'villager') || !grid.isPassable(x, y + dy, 'villager'))) {
              continue;
            }
            const dot = (dir.x * dx + dir.y * dy) / Math.hypot(dx, dy);
            if (dot > aligned) {
              aligned = dot;
              downhill = field.costAtCell(x + dx, y + dy) < here;
            }
          }
        }
        expect(downhill).withContext(`direction at ${x},${y} points downhill`).toBeTrue();
        expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(walk(field, grid, 'villager', 2, 8).reached).toBeTrue();
  });

  it('routes each class through the gap it fits', () => {
    // A 2-cell gap (villager only) at rows 3-4 and an 11-cell opening (all but creatures) at rows 12-22.
    const grid = wallGrid(40, 26, 20, [
      [3, 4],
      [12, 22],
    ]);
    const graph = NavSectorGraph.build(grid, { sectorSize: 20 });
    const cache = new NavFlowCache(graph);
    const crossing = (unitClass: NavUnitClass): number => {
      const field = cache.field(36, 4, unitClass);
      expect(cache.ensure(field, 3, 4).status).withContext(unitClass).toBe('ready');
      const { reached, path } = walk(field, grid, unitClass, 3, 4);
      expect(reached).withContext(unitClass).toBeTrue();
      const idx = path.findIndex((p) => p[0] >= 20);
      return path[idx][1];
    };
    expect(crossing('villager')).toBeLessThan(6);
    expect(crossing('catapult')).toBeGreaterThan(11);
    // A creature (clearance 8) fits neither opening.
    const creature = cache.field(36, 4, 'creature');
    expect(cache.ensure(creature, 3, 4).status).toBe('unreachable');
  });

  it('seeds the whole shared edge, so agents do not funnel to the single portal', () => {
    const grid = openGrid(32, 16);
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    expect(graph.portalCount('villager')).toBe(1);
    const cache = new NavFlowCache(graph);
    const field = cache.field(30, 8, 'villager');
    cache.ensure(field, 2, 2);
    const dir: NavFlowDirection = { x: 0, y: 0 };
    // Far from the portal row (7/8) the cells beside the edge still head east, not down to row 8.
    expect(field.directionAtCell(15, 0, dir)).toBeTrue();
    expect(dir.x).toBeGreaterThan(0.6);
    expect(dir.y).toBeLessThan(dir.x);
    expect(field.directionAtCell(15, 15, dir)).toBeTrue();
    expect(dir.x).toBeGreaterThan(0.6);
    expect(dir.y).toBeGreaterThan(-dir.x);
    // The edge cells of the upstream sector are continuous with the downstream sector's.
    expect(field.costAtCell(15, 0)).toBeGreaterThan(field.costAtCell(16, 0));
  });

  it('builds only the corridor sectors', () => {
    const grid = openGrid(128, 128);
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    const cache = new NavFlowCache(graph);
    const field = cache.field(120, 8, 'villager');
    expect(cache.ensure(field, 8, 8).status).toBe('ready');
    expect(field.builtSectors).toBeGreaterThan(0);
    expect(field.builtSectors).toBeLessThan(graph.sectorCount / 4);
    expect(cache.stats.builds).toBe(field.builtSectors);
    expect(cache.recentBuilds.length).toBe(cache.stats.builds);
    expect(cache.stats.totalBuildMs).toBeGreaterThan(0);
  });

  it('refines a sector the corridor leaves and re-enters', () => {
    // A wall splits the top sector in two; the only opening is in the bottom sector, so the route
    // from the west half to the east half goes down and back up.
    const grid = openGrid(16, 32);
    grid.stampStructure({ x: 8, y: 0, width: 1, height: 24 });
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    const cache = new NavFlowCache(graph);
    const path = graph.findAbstractPath(2, 4, 14, 4, 'villager');
    expect(path.sectors).toEqual([0, 1, 0]);
    const field = cache.field(14, 4, 'villager');
    expect(cache.ensure(field, 2, 4).status).toBe('ready');
    const result = walk(field, grid, 'villager', 2, 4);
    expect(result.reached).toBeTrue();
    expect(result.path.some((p) => p[1] > 16)).toBeTrue();
  });
});

describe('NavFlowCache bilinear sampling', () => {
  it('blends the four surrounding cell directions and skips cells without one', () => {
    const grid = openGrid(8, 8);
    const graph = NavSectorGraph.build(grid, { sectorSize: 8 });
    const cache = new NavFlowCache(graph);
    const field = cache.field(7, 7, 'villager');
    cache.ensure(field, 0, 0);
    const e = field.sectors[0]!;
    const set = (x: number, y: number, dx: number, dy: number): void => {
      e.dir[(y * 8 + x) * 2] = dx;
      e.dir[(y * 8 + x) * 2 + 1] = dy;
    };
    set(2, 2, 127, 0);
    set(3, 2, 0, 127);
    set(2, 3, 127, 0);
    set(3, 3, 0, 127);
    const out: NavFlowDirection = { x: 0, y: 0 };
    // At a cell centre the cell's own direction is returned.
    expect(field.sample(2.5, 2.5, out)).toBeTrue();
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.y).toBeCloseTo(0, 5);
    // Midway between the four centres: the average.
    expect(field.sample(3, 3, out)).toBeTrue();
    expect(out.x).toBeCloseTo(0.5, 5);
    expect(out.y).toBeCloseTo(0.5, 5);
    // A quarter of the way along x between cells 2 and 3 on the row y = 2.5.
    expect(field.sample(2.75, 2.5, out)).toBeTrue();
    expect(out.x).toBeCloseTo(0.75, 5);
    expect(out.y).toBeCloseTo(0.25, 5);
    // Dropping one cell's direction renormalises over the rest.
    set(3, 3, 0, 0);
    expect(field.sample(3, 3, out)).toBeTrue();
    expect(out.x).toBeCloseTo(2 / 3, 5);
    expect(out.y).toBeCloseTo(1 / 3, 5);
    // Outside the grid there is nothing to blend.
    expect(field.sample(-3, 4, out)).toBeFalse();
  });
});

describe('NavFlowCache versions', () => {
  it('drops fields of rebuilt sectors (and fields seeded from them) and rebuilds them lazily', () => {
    const grid = openGrid(48, 16, 2); // a small clearance halo keeps an edit inside one sector
    const graph = NavSectorGraph.build(grid, { sectorSize: 16 });
    const cache = new NavFlowCache(graph);
    const field = cache.field(45, 8, 'villager');
    expect(cache.ensure(field, 2, 8).status).toBe('ready');
    expect(cache.stats.builds).toBe(3);
    expect([...field.sectors].map((s) => s?.version)).toEqual([1, 1, 1]);

    // Wall off the middle sector: its field and the west sector's (seeded from it) go; the goal sector stays.
    const dirty = grid.stampStructure({ x: 24, y: 0, width: 2, height: 16 });
    expect(graph.rebuildSectors(dirty)).toEqual([1]);
    expect(cache.sync()).toBe(2);
    expect(cache.stats.invalidations).toBe(2);
    expect(field.sectors[0]).toBeUndefined();
    expect(field.sectors[1]).toBeUndefined();
    expect(field.sectors[2]).toBeDefined();
    expect(cache.ensure(field, 2, 8).status).toBe('unreachable');

    // Open a gap: the next access rebuilds with the new version.
    const dirty2 = grid.clearStructure({ x: 24, y: 7, width: 2, height: 2 });
    graph.rebuildSectors(dirty2);
    const buildsBefore = cache.stats.builds;
    expect(cache.ensure(field, 2, 8).status).toBe('ready');
    expect(cache.stats.builds - buildsBefore).toBe(2);
    expect(field.sectors[1]!.version).toBe(graph.versions[1]);
    expect(field.sectors[1]!.version).toBeGreaterThan(1);
    expect(walk(field, grid, 'villager', 2, 8).reached).toBeTrue();
  });

  it('counts a request for current fields as a hit', () => {
    const graph = NavSectorGraph.build(openGrid(32, 16), { sectorSize: 16 });
    const cache = new NavFlowCache(graph);
    const field = cache.field(30, 8, 'villager');
    cache.ensure(field, 2, 8);
    const builds = cache.stats.builds;
    expect(cache.ensure(field, 4, 8)).toEqual({ status: 'ready', built: 0 });
    expect(cache.stats.builds).toBe(builds);
    expect(cache.stats.hits).toBe(1);
    expect(cache.field(30, 8, 'villager')).toBe(field);
  });

  it('honours the build budget and continues on the next call', () => {
    const graph = NavSectorGraph.build(openGrid(64, 16), { sectorSize: 16 });
    const cache = new NavFlowCache(graph);
    const field = cache.field(62, 8, 'villager');
    expect(cache.ensure(field, 2, 8, 1)).toEqual({ status: 'partial', built: 1 });
    let guard = 0;
    while (cache.ensure(field, 2, 8, 1).status === 'partial' && guard++ < 10) {
      /* keep going */
    }
    expect(field.builtSectors).toBe(4);
    expect(cache.ensure(field, 2, 8).status).toBe('ready');
  });
});

describe('NavFlowCache LRU limit', () => {
  it('evicts the least recently used sector fields across goals', () => {
    const graph = NavSectorGraph.build(openGrid(64, 16), { sectorSize: 16 });
    const cache = new NavFlowCache(graph, { maxSectorFields: 5 });
    const a = cache.field(62, 8, 'villager');
    cache.ensure(a, 2, 8); // 4 sectors
    const b = cache.field(50, 8, 'villager');
    cache.ensure(b, 60, 8); // 1 sector (the start sits in the goal sector)
    expect(cache.cachedFields).toBe(5);
    expect(cache.stats.evictions).toBe(0);
    cache.touch(a); // a is now newer than b
    const c = cache.field(2, 8, 'villager');
    cache.ensure(c, 20, 8); // sectors 1 and 0: two more fields
    expect(cache.cachedFields).toBe(5);
    expect(cache.stats.evictions).toBe(2);
    expect(b.builtSectors).toBe(0); // b was the oldest
    expect(a.builtSectors).toBe(3);
    expect(c.builtSectors).toBe(2);
    expect(cache.stats.sectorFields).toBe(5);
  });

  it('rebuilds an evicted sector on the next request', () => {
    const graph = NavSectorGraph.build(openGrid(64, 16), { sectorSize: 16 });
    const cache = new NavFlowCache(graph, { maxSectorFields: 2 });
    const field = cache.field(62, 8, 'villager');
    cache.ensure(field, 40, 8);
    expect(cache.cachedFields).toBe(2);
    expect(cache.ensure(field, 4, 8).status).not.toBe('unreachable');
    cache.ensure(field, 4, 8);
    expect(field.sectors[0]).toBeDefined();
    expect(cache.cachedFields).toBe(2);
  });
});
